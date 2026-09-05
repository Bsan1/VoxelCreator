import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScene } from '../core/build.js';
import { saveScene, snapshotScene } from '../core/store.js';
import { formatReport, validate, type ValidationReport } from '../core/validate.js';
import type { SceneKind, VoxelScene } from '../core/types.js';
import { buildPrompt, buildRepairPrompt } from './prompt.js';
import { buildItemPrompt, describeCharacter } from './itemPrompt.js';
import { loadScene } from '../core/store.js';
import { extractJsonObject, sceneToSpec, specToScene, type GenSpec } from './spec.js';
import { applyOps, type RevisionOp } from './patch.js';
import { buildPatchRepairPrompt, buildRevisePrompt } from './revisePrompt.js';

/**
 * Generation runs through the user's own Claude Code or Codex CLI over stdin,
 * so it uses their existing subscription — no API key, nothing to configure.
 */
export type Engine = 'claude' | 'codex';

export interface GenerateResult {
  /** Token usage summed across every CLI call this took. */
  usage: CallUsage;
  scene: VoxelScene;
  spec: GenSpec;
  report: ValidationReport;
  engine: Engine;
  elapsedMs: number;
  raw: string;
  /** 1 when the first attempt was accepted, 2 when a correction pass ran. */
  attempts: number;
  /** Problems the first attempt had, whether or not the repair fixed them. */
  repairedProblems: string[];
  /** Edits applied, when the model answered with an op list. */
  applied: string[];
}

interface Attempt {
  spec: GenSpec;
  /** Edits applied, when the reply was an op list. */
  applied: string[];
  scene: VoxelScene;
  report: ValidationReport;
  problems: string[];
  raw: string;
}

const isWindows = process.platform === 'win32';

/**
 * These calls are pure text completions — the model writes JSON, it never needs
 * to read a file or run a command. Leaving Claude Code's tools enabled ships
 * their whole schema set in the prompt for nothing, which measured at roughly
 * 15k tokens per call.
 */
const TOOLS_OFF =
  'Bash Read Write Edit Glob Grep WebFetch WebSearch NotebookEdit TodoWrite ' +
  'Task BashOutput KillShell SlashCommand';

/**
 * Run the CLI from an empty scratch directory rather than the project.
 *
 * Claude Code auto-discovers CLAUDE.md and .mcp.json from its working
 * directory, so running in the project shipped this repo's own instructions and
 * all ten MCP tool schemas along with every generation — about 4k tokens of
 * context that has nothing to do with writing a voxel spec.
 */
const LEAN_DIR = join(tmpdir(), 'voxelcreator-cli');

function ensureLeanDir(): string {
  mkdirSync(LEAN_DIR, { recursive: true });
  return LEAN_DIR;
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd?: number;
  model?: string;
}

export interface CliResult {
  text: string;
  usage?: CallUsage;
}

function commandFor(engine: Engine, model?: string): { cmd: string; args: string[] } {
  // The prompt goes in on stdin: it is far longer than a Windows command line
  // will take as an argument.
  if (engine === 'claude') {
    const args = ['-p', '--output-format', 'json', '--disallowed-tools', TOOLS_OFF];
    if (model) args.push('--model', model);
    return { cmd: isWindows ? 'claude.exe' : 'claude', args };
  }
  const args = ['exec', '-'];
  if (model) args.push('--model', model);
  return { cmd: isWindows ? 'codex.cmd' : 'codex', args };
}

/** Pull the reply and the token usage out of `claude -p --output-format json`. */
function parseClaudeJson(out: string): CliResult {
  try {
    const j = JSON.parse(out) as {
      result?: string;
      total_cost_usd?: number;
      modelUsage?: Record<string, unknown>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };
    if (typeof j.result !== 'string') return { text: out };
    const u = j.usage ?? {};
    return {
      text: j.result,
      usage: {
        inputTokens:
          (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        costUsd: j.total_cost_usd,
        model: j.modelUsage ? Object.keys(j.modelUsage)[0] : undefined,
      },
    };
  } catch {
    // Fall back to treating the whole reply as text.
    return { text: out };
  }
}

function runCli(
  engine: Engine,
  prompt: string,
  timeoutMs: number,
  model?: string,
): Promise<CliResult> {
  const { cmd, args } = commandFor(engine, model);
  return new Promise((resolve, reject) => {
    // Only .cmd shims need a shell; spawning the .exe directly avoids passing
    // unescaped arguments through cmd.exe.
    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: cmd.endsWith('.cmd'),
      cwd: ensureLeanDir(),
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${engine} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) =>
      reject(new Error(`Could not run "${cmd}". Is ${engine} installed and on PATH? ${e.message}`)),
    );
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${engine} exited ${code}: ${err.trim() || out.trim()}`));
      else resolve(engine === 'claude' ? parseClaudeJson(out) : { text: out });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Exposed so the repair-path test can drive the CLI directly. */
export const runCliForTest = runCli;

/**
 * Turn a reply into a validated candidate, or throw with a usable message.
 *
 * Two reply shapes are accepted. A revision normally answers with an edit list
 * (`{"ops": [...]}`) applied to `base`; a first generation, and any correction
 * pass, answers with a whole spec. Accepting both means the repair loop needs
 * no special case.
 */
function evaluate(
  raw: string,
  opts: { name?: string; kind?: SceneKind; base?: VoxelScene } = {},
): Attempt {
  const json = extractJsonObject(raw);
  let scene: VoxelScene;
  let applied: string[] = [];

  if (Array.isArray((json as { ops?: unknown }).ops)) {
    if (!opts.base) throw new Error('Got an edit list but there is no model to apply it to');
    const patched = applyOps(opts.base, (json as { ops: RevisionOp[] }).ops);
    scene = patched.scene;
    applied = patched.applied;
    if (opts.name) scene.name = opts.name;
  } else {
    const spec = json as unknown as GenSpec;
    if (opts.name) spec.name = opts.name;
    if (opts.kind) spec.kind = opts.kind;
    scene = specToScene(spec);
  }

  const report = validate(buildScene(scene), { kind: scene.kind }); // throws before anything is saved
  const problems = report.checks
    .filter((c) => c.severity !== 'pass')
    .map((c) => `${c.id}: ${c.message}`);
  return { spec: sceneToSpec(scene), scene, report, problems, raw, applied };
}

/**
 * Prompt in, saved scene out.
 *
 * When the first attempt trips a structural check, its own defect list is fed
 * back for one correction pass. The checks are deterministic and name the part
 * at fault, so this costs one extra CLI call rather than a render or a vision
 * round trip — and it is skipped entirely when the model gets it right.
 */
export async function generate(
  userPrompt: string,
  opts: {
    engine?: Engine;
    timeoutMs?: number;
    name?: string;
    repairs?: number;
    /** Generate a piece of equipment instead of a character. */
    item?: boolean;
    /** Name of a saved character the item is being made for. */
    forCharacter?: string;
    /** Override the CLI model, e.g. "haiku" for cheap edits. */
    model?: string;
  } = {},
): Promise<GenerateResult> {
  const engine = opts.engine ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const maxRepairs = opts.repairs ?? 1;
  const started = Date.now();
  const kind: SceneKind = opts.item || opts.forCharacter ? 'item' : 'character';
  const characterBlock = opts.forCharacter
    ? describeCharacter(loadScene(opts.forCharacter))
    : undefined;

  const initial =
    kind === 'item' ? buildItemPrompt(userPrompt, characterBlock) : buildPrompt(userPrompt);
  const run = await runWithRepair(userPrompt, initial, {
    engine,
    timeoutMs,
    maxRepairs,
    name: opts.name,
    kind,
    model: opts.model,
  });

  saveScene(run.best.scene);
  return {
    scene: run.best.scene,
    spec: run.best.spec,
    report: run.best.report,
    engine,
    elapsedMs: Date.now() - started,
    raw: run.best.raw,
    attempts: run.attempts,
    repairedProblems: run.firstProblems,
    usage: run.usage,
    applied: run.best.applied,
  };
}

/**
 * Apply a change to an existing model.
 *
 * The current scene is fed back as the starting point, so everything the artist
 * already accepted survives — this is what separates a revision from rolling
 * the dice again on the original prompt. The previous version is snapshotted
 * first, so a bad instruction is one `revert` away.
 */
export async function revise(
  sceneName: string,
  instruction: string,
  opts: {
    engine?: Engine;
    timeoutMs?: number;
    repairs?: number;
    saveAs?: string;
    model?: string;
  } = {},
): Promise<GenerateResult> {
  const engine = opts.engine ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const maxRepairs = opts.repairs ?? 1;
  const started = Date.now();

  const current = loadScene(sceneName);
  const kind = current.kind ?? 'character';
  const outName = opts.saveAs ?? sceneName;

  const initial = buildRevisePrompt(
    JSON.stringify(sceneToSpec(current), null, 2),
    instruction,
    kind,
  );
  const run = await runWithRepair(`revise "${sceneName}": ${instruction}`, initial, {
    engine,
    timeoutMs,
    maxRepairs,
    name: outName,
    kind,
    model: opts.model,
    base: current,
    instruction,
  });

  // Only snapshot when overwriting; saving under a new name leaves the
  // original scene untouched anyway.
  if (outName === sceneName) snapshotScene(sceneName);
  saveScene(run.best.scene);

  return {
    scene: run.best.scene,
    spec: run.best.spec,
    report: run.best.report,
    engine,
    elapsedMs: Date.now() - started,
    raw: run.best.raw,
    attempts: run.attempts,
    repairedProblems: run.firstProblems,
    usage: run.usage,
    applied: run.best.applied,
  };
}

/**
 * Run a prompt, and if the result trips a structural check, feed its own defect
 * list back for up to `maxRepairs` correction passes. Shared by generation and
 * revision so both get the same guarantees.
 */
async function runWithRepair(
  taskDescription: string,
  initialPrompt: string,
  opts: {
    engine: Engine;
    timeoutMs: number;
    maxRepairs: number;
    name?: string;
    kind: SceneKind;
    model?: string;
    /** Scene an edit list applies to, when revising. */
    base?: VoxelScene;
    /** Original instruction, so a revision repair can restate the goal. */
    instruction?: string;
  },
): Promise<{ best: Attempt; attempts: number; firstProblems: string[]; usage: CallUsage }> {
  const { engine, timeoutMs, maxRepairs, name, kind, model, base, instruction } = opts;

  // A revision repairs by producing a better edit list, not by restating the
  // whole model — asking for a full spec here invites it to change things
  // nobody asked about, and costs an order of magnitude more output.
  const revising = Boolean(base && instruction);
  const baseSpecJson = base ? JSON.stringify(sceneToSpec(base), null, 2) : '';
  const repairPrompt = (failedOutput: string, problems: string[]): string =>
    revising
      ? buildPatchRepairPrompt(baseSpecJson, instruction!, problems)
      : buildRepairPrompt(taskDescription, failedOutput, problems);

  const totals: CallUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
  let best: Attempt | undefined;
  let lastPrompt = initialPrompt;
  let firstProblems: string[] = [];

  for (let attempt = 1; attempt <= maxRepairs + 1; attempt++) {
    const call = await runCli(engine, lastPrompt, timeoutMs, model);
    const raw = call.text;
    if (call.usage) {
      totals.inputTokens += call.usage.inputTokens;
      totals.outputTokens += call.usage.outputTokens;
      totals.cacheReadTokens += call.usage.cacheReadTokens;
      totals.costUsd = (totals.costUsd ?? 0) + (call.usage.costUsd ?? 0);
      totals.model = call.usage.model ?? totals.model;
    }

    let candidate: Attempt;
    try {
      candidate = evaluate(raw, { name, kind, base });
    } catch (e) {
      // Unparsable or unbuildable. Retry with the error as the defect list;
      // if there are no retries left, surface it rather than saving nothing.
      const message = e instanceof Error ? e.message : String(e);
      if (attempt > maxRepairs) {
        if (best) return { best, attempts: attempt, firstProblems, usage: totals };
        throw new Error(`${engine} did not return a buildable model: ${message}`);
      }
      lastPrompt = repairPrompt(raw.slice(0, 4000), [
        `the JSON could not be built: ${message}`,
      ]);
      continue;
    }

    if (attempt === 1) firstProblems = candidate.problems;
    // Keep whichever attempt has fewer structural problems.
    if (!best || candidate.problems.length < best.problems.length) best = candidate;
    if (candidate.problems.length === 0) return { best: candidate, attempts: attempt, firstProblems, usage: totals };
    if (attempt > maxRepairs) break;

    lastPrompt = repairPrompt(
      JSON.stringify(candidate.spec, null, 2),
      candidate.problems,
    );
  }

  return { best: best!, attempts: maxRepairs + 1, firstProblems, usage: totals };
}

export { formatReport };
