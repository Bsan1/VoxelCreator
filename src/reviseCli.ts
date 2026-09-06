import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScene } from './core/build.js';
import { OUT_DIR, historyFor, revertScene } from './core/store.js';
import { formatReport, validate } from './core/validate.js';
import { writeVox } from './io/vox.js';
import { revise, type Engine } from './generate/agent.js';

/**
 * Usage:
 *   npm run revise -- knight "make the tabard blue and add a shoulder cape"
 *   npm run revise -- knight "..." --as knight_blue   # branch instead of overwrite
 *   npm run revise -- knight --undo                   # step back one revision
 */
const argv = process.argv.slice(2);
const engine: Engine = argv.includes('--codex') ? 'codex' : 'claude';
const flagVal = (f: string) => { const i = argv.indexOf(f); return { v: i === -1 ? undefined : argv[i + 1], i }; };
const boxFlag = flagVal('--boxiness');
const detailFlag = flagVal('--detail');
const asIdx = argv.indexOf('--as');
const saveAs = asIdx === -1 ? undefined : argv[asIdx + 1];
// Guard the -1 case: asIdx + 1 would be 0 and swallow the first argument.
const asValueIdx = asIdx === -1 ? -1 : asIdx + 1;
const consumed = new Set([asValueIdx, boxFlag.i + 1, detailFlag.i + 1].filter((i) => i > 0));
const positional = argv.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
const [sceneName, ...rest] = positional;
const instruction = rest.join(' ').trim();

if (!sceneName) {
  console.error(
    'Usage:\n' +
      '  npm run revise -- <scene> "what to change" [--as newname] [--codex]\n' +
      '  npm run revise -- <scene> --undo',
  );
  process.exit(1);
}

if (argv.includes('--undo')) {
  const scene = revertScene(sceneName);
  const build = buildScene(scene);
  writeFileSync(join(OUT_DIR, `${scene.name}.vox`), writeVox(build.grid, build.palette));
  console.log(`reverted "${sceneName}" to its previous version`);
  console.log(`${historyFor(sceneName).length} earlier version(s) still available`);
  process.exit(0);
}

if (!instruction) {
  console.error('Say what to change, e.g. npm run revise -- knight "make the crest blue"');
  process.exit(1);
}

console.log(`revising "${sceneName}" with ${engine}: "${instruction}"`);
const numOrUndef = (v?: string) => (v === undefined ? undefined : Number(v));
const result = await revise(sceneName, instruction, {
  engine,
  saveAs,
  dials: { boxiness: numOrUndef(boxFlag.v), detail: numOrUndef(detailFlag.v) },
});

const build = buildScene(result.scene);
writeFileSync(join(OUT_DIR, `${result.scene.name}.vox`), writeVox(build.grid, build.palette));

console.log(
  `\n${result.scene.name}  ${build.grid.sx}x${build.grid.sy}x${build.grid.sz}  ` +
    `${build.grid.count()} voxels  ${build.palette.size} colors  ` +
    `${(result.elapsedMs / 1000).toFixed(1)}s`,
);
console.log(`parts: ${result.scene.parts.map((p) => p.id).join(', ')}`);
if (result.applied.length > 0) {
  console.log('edits:');
  for (const e of result.applied) console.log(`  ${e}`);
}
const u = result.usage;
console.log(`tokens: ${u.inputTokens.toLocaleString()} in (${u.cacheReadTokens.toLocaleString()} cached) / ${u.outputTokens.toLocaleString()} out  ` + `across ${result.attempts} call(s)` + (u.costUsd ? `  ~${u.costUsd.toFixed(3)}` : '') + (u.model ? `  [${u.model}]` : ''));
if (result.attempts > 1) {
  console.log('\nrepaired after attempt 1 reported:');
  for (const p of result.repairedProblems) console.log(`  - ${p}`);
}
console.log(`\n${formatReport(validate(build, { kind: result.scene.kind }))}`);
if (!saveAs) console.log(`\nundo with: npm run revise -- ${sceneName} --undo`);
