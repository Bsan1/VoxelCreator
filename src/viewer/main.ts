import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildScene, type BuildResult } from '../core/build.js';
import { parseHex } from '../core/palette.js';
import { validate } from '../core/validate.js';
import { writeVox } from '../io/vox.js';
import type { VoxelScene } from '../core/types.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const app = $('app');
const modelsEl = $('models');
const statsEl = $('stats');
const partsEl = $('parts');
const errEl = $('err');
const tagsEl = $('tags');
const liveDot = $('live');
const btnSingle = $<HTMLButtonElement>('modeSingle');
const btnAll = $<HTMLButtonElement>('modeAll');
const btnDownload = $<HTMLButtonElement>('wide');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#14161a');

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 4000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2620, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(30, 50, 35);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fb6ff, 0.5);
fill.position.set(-30, 18, -25);
scene.add(fill);

const ground = new THREE.GridHelper(400, 100, 0x39404e, 0x252a33);
scene.add(ground);

const modelRoot = new THREE.Group();
scene.add(modelRoot);

const CUBE = new THREE.BoxGeometry(1, 1, 1);
const MATERIAL = new THREE.MeshLambertMaterial();

type Mode = 'single' | 'all';
type Loaded = { raw: string; scene: VoxelScene };

let mode: Mode = 'single';
let names: string[] = [];
let current = '';
const loaded = new Map<string, Loaded>();

/** Screen-space name tags, used when several models share the scene. */
let tags: Array<{ el: HTMLDivElement; pos: THREE.Vector3 }> = [];
let framing = { center: new THREE.Vector3(), radius: 20 };
let camPreset: 'front' | 'three' | 'side' | 'top' | 'gallery' = 'three';

/**
 * Build one model's instanced mesh. Fully enclosed voxels are skipped: they
 * cannot be seen, and dropping them keeps the instance count near surface area
 * rather than volume.
 */
function meshFor(build: BuildResult): { mesh: THREE.InstancedMesh; drawn: number } {
  const { grid, palette } = build;
  const colors = palette.colors().map((hex) => {
    const { r, g, b } = parseHex(hex);
    return new THREE.Color(r / 255, g / 255, b / 255);
  });

  const visible: Array<[number, number, number, number]> = [];
  grid.forEach((x, y, z, v) => {
    const enclosed =
      grid.get(x + 1, y, z) !== 0 && grid.get(x - 1, y, z) !== 0 &&
      grid.get(x, y + 1, z) !== 0 && grid.get(x, y - 1, z) !== 0 &&
      grid.get(x, y, z + 1) !== 0 && grid.get(x, y, z - 1) !== 0;
    if (!enclosed) visible.push([x, y, z, v]);
  });

  const mesh = new THREE.InstancedMesh(CUBE, MATERIAL, visible.length);
  const m = new THREE.Matrix4();
  const ox = -grid.sx / 2, oz = -grid.sz / 2;
  visible.forEach(([x, y, z, v], i) => {
    m.makeTranslation(x + 0.5 + ox, y + 0.5, z + 0.5 + oz);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, colors[v - 1] ?? new THREE.Color(1, 0, 1));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, drawn: visible.length };
}

function clearModels(): void {
  for (const child of [...modelRoot.children]) {
    modelRoot.remove(child);
    if (child instanceof THREE.InstancedMesh) child.dispose();
  }
  for (const t of tags) t.el.remove();
  tags = [];
}

const costLine = (u?: { outputTokens: number; inputTokens: number; costUsd?: number }) =>
  u
    ? ` · ${(u.inputTokens / 1000).toFixed(0)}k in / ${u.outputTokens.toLocaleString()} out` +
      (u.costUsd ? ` · $${u.costUsd.toFixed(3)}` : '')
    : '';

const row = (k: string, v: string) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;

function addTag(name: string, pos: THREE.Vector3): void {
  const el = document.createElement('div');
  el.className = 'tag';
  el.textContent = name;
  tagsEl.appendChild(el);
  tags.push({ el, pos });
}

function renderSingle(): void {
  const entry = loaded.get(current);
  if (!entry) return;
  const build = buildScene(entry.scene);
  const { mesh, drawn } = meshFor(build);
  clearModels();
  modelRoot.add(mesh);

  const { grid, palette, layout } = build;
  const report = validate(build, { kind: entry.scene.kind });
  const problems = report.checks.filter((c) => c.severity !== 'pass');

  framing = {
    center: new THREE.Vector3(0, grid.sy / 2, 0),
    radius: Math.max(grid.sx, grid.sy, grid.sz) * 0.72,
  };

  statsEl.innerHTML = [
    row('model', entry.scene.name),
    row('size', `${grid.sx} × ${grid.sy} × ${grid.sz}`),
    row('voxels', `${grid.count()}`),
    row('drawn', `${drawn}`),
    row('colors', `${palette.size}`),
    row('symmetry', `${report.metrics.symmetryPct}%`),
    row('checks', problems.length === 0 ? 'all clean' : `${problems.length} warning(s)`),
  ].join('');

  partsEl.innerHTML =
    layout.placed
      .map((p) => {
        const cls = p.mirrored ? ' class="mir"' : '';
        return `<div${cls}>${p.part.id.padEnd(11, ' ')}[${p.size.join('×')}]</div>`;
      })
      .join('') +
    problems.map((c) => `<div style="color:#ffb4b8">${c.id}: ${c.message}</div>`).join('');

  partsEl.hidden = false;
  statsEl.hidden = false;
}

function renderAll(): void {
  clearModels();
  const builds = names
    .map((n) => ({ name: n, entry: loaded.get(n) }))
    .filter((b): b is { name: string; entry: Loaded } => Boolean(b.entry))
    .map((b) => ({ name: b.name, build: buildScene(b.entry.scene) }));
  if (builds.length === 0) return;

  // A single row stops being readable past a handful of models, so wrap into a
  // roughly square grid. Rows are viewed from above (see the "gallery" camera)
  // rather than head-on, which is what stops the front row hiding the rest.
  const cellW = Math.max(...builds.map((b) => b.build.grid.sx)) + 6;
  const cellD = Math.max(...builds.map((b) => b.build.grid.sz)) + 10;
  const cols = Math.min(5, Math.ceil(Math.sqrt(builds.length)));
  const rows = Math.ceil(builds.length / cols);
  const originX = -((cols - 1) * cellW) / 2;
  const originZ = -((rows - 1) * cellD) / 2;

  let maxH = 0;
  builds.forEach(({ name, build }, i) => {
    const { mesh } = meshFor(build);
    const cx = originX + (i % cols) * cellW;
    const cz = originZ + Math.floor(i / cols) * cellD;
    mesh.position.set(cx, 0, cz);
    modelRoot.add(mesh);
    maxH = Math.max(maxH, build.grid.sy);
    addTag(name, new THREE.Vector3(cx, build.grid.sy + 3, cz));
  });

  framing = {
    center: new THREE.Vector3(0, maxH / 3, 0),
    radius: Math.max((cols * cellW) / 2, (rows * cellD) / 2, maxH * 0.7),
  };

  statsEl.innerHTML = [
    row('models', `${builds.length}`),
    row('voxels', `${builds.reduce((n, b) => n + b.build.grid.count(), 0)}`),
    row('tallest', `${maxH}`),
  ].join('');
  partsEl.innerHTML = '';
  partsEl.hidden = true;
}

function rerender(): void {
  try {
    if (mode === 'single') renderSingle();
    else renderAll();
    applyCamera(camPreset);
    clearError();
  } catch (e) {
    showError(e);
  }
}

/**
 * Width the control panel occupies. The camera renders a frustum this much
 * wider than the canvas and shows only the right part of it, which pushes the
 * model clear of the panel instead of hiding it underneath.
 */
const PANEL_OPEN_W = 296;
let panelWidth = PANEL_OPEN_W;

function updateProjection(): void {
  camera.aspect = (innerWidth + panelWidth) / innerHeight;
  camera.setViewOffset(innerWidth + panelWidth, innerHeight, 0, 0, innerWidth, innerHeight);
  camera.updateProjectionMatrix();
}

function applyCamera(preset: typeof camPreset): void {
  camPreset = preset;
  const dirs: Record<typeof camPreset, THREE.Vector3> = {
    front: new THREE.Vector3(0, 0.28, 1),
    three: new THREE.Vector3(0.85, 0.55, 1),
    side: new THREE.Vector3(1, 0.28, 0),
    top: new THREE.Vector3(0, 1, 0.0001),
    // Steep enough that a grid of models reads as a grid, not a queue.
    gallery: new THREE.Vector3(0, 0.95, 1),
  };
  const dir = dirs[preset].clone().normalize();

  // Fit against the strip of canvas left clear of the panel, not the whole
  // frustum — otherwise the view offset pushes the model's edges out of sight.
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const usableAspect = Math.max(0.35, (innerWidth - panelWidth) / innerHeight);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * usableAspect);
  const dist =
    Math.max(framing.radius / Math.sin(vFov / 2), framing.radius / Math.sin(hFov / 2)) * 1.08;

  camera.position.copy(framing.center).addScaledVector(dir, dist);
  controls.target.copy(framing.center);
  controls.update();
}

function showError(e: unknown): void {
  errEl.hidden = false;
  errEl.textContent = e instanceof Error ? e.message : String(e);
  liveDot.style.background = '#e5534b';
}

function clearError(): void {
  errEl.hidden = true;
  liveDot.style.background = '#3ecf8e';
}

/**
 * The list folds away. It grows without limit as models accumulate, and an
 * always-open column of twenty names pushes everything else off the panel.
 */
let modelsFolded = false;

function syncModelsFold(): void {
  modelsEl.hidden = modelsFolded;
  $('modelsChevron').textContent = modelsFolded ? '▸' : '▾';
  $('modelCount').textContent = names.length ? String(names.length) : '';
}

function renderModelButtons(): void {
  modelsEl.innerHTML = names
    .map((n) => `<button data-model="${n}"${n === current && mode === 'single' ? ' class="on"' : ''}>${n}</button>`)
    .join('');
  syncModelsFold();
}

$('modelsLabel').addEventListener('click', () => {
  modelsFolded = !modelsFolded;
  syncModelsFold();
});


modelsEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  const name = btn?.dataset.model;
  if (!name) return;
  current = name;
  mode = 'single';
  syncModeButtons();
  renderModelButtons();
  rerender();
});

document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => {
  b.addEventListener('click', () => applyCamera(b.dataset.cam as typeof camPreset));
});

function syncModeButtons(): void {
  btnSingle.classList.toggle('on', mode === 'single');
  btnAll.classList.toggle('on', mode === 'all');
  btnDownload.hidden = mode !== 'single';
  syncReviseTarget();
}

btnSingle.addEventListener('click', () => {
  mode = 'single';
  syncModeButtons();
  renderModelButtons();
  rerender();
});

btnAll.addEventListener('click', async () => {
  mode = 'all';
  // Looking down on the grid so no row hides behind another.
  camPreset = 'gallery';
  syncModeButtons();
  renderModelButtons();
  await Promise.all(names.map((n) => fetchScene(n)));
  rerender();
});

btnDownload.addEventListener('click', () => {
  const entry = loaded.get(current);
  if (!entry) return;
  try {
    const build = buildScene(entry.scene);
    const bytes = writeVox(build.grid, build.palette);
    // Copy into a plainly-owned buffer so the Blob accepts it.
    const buf = new Uint8Array(bytes.length);
    buf.set(bytes);
    const url = URL.createObjectURL(new Blob([buf.buffer], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entry.scene.name}.vox`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    showError(e);
  }
});

/** Returns true when the scene changed on disk since we last saw it. */
async function fetchScene(name: string): Promise<boolean> {
  const res = await fetch(`/scenes/${name}.scene.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${res.status} loading ${name}`);
  const raw = await res.text();
  if (loaded.get(name)?.raw === raw) return false;
  loaded.set(name, { raw, scene: JSON.parse(raw) as VoxelScene });
  return true;
}

/** Poll so an agent's edits appear without a manual refresh. */
async function poll(): Promise<void> {
  try {
    const res = await fetch(`/scenes/index.json?t=${Date.now()}`);
    if (!res.ok) return;
    const { scenes } = (await res.json()) as { scenes: string[] };

    const listChanged = scenes.join(',') !== names.join(',');
    names = scenes;
    if (!current || !names.includes(current)) current = names[0] ?? '';
    if (listChanged) renderModelButtons();
    if (!current) return;

    const watch = mode === 'all' ? names : [current];
    const changed = await Promise.all(watch.map((n) => fetchScene(n)));
    if (listChanged || changed.some(Boolean)) rerender();
    clearError();
  } catch (e) {
    showError(e);
  }
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  updateProjection();
  applyCamera(camPreset);
});

// ---- Generation ----------------------------------------------------------

const promptEl = $<HTMLTextAreaElement>('prompt');
const engineEl = $<HTMLSelectElement>('engine');
const genBtn = $<HTMLButtonElement>('genClaude');
const genStatus = $('genStatus');

function setStatus(text: string, kind: '' | 'good' | 'bad' = ''): void {
  genStatus.hidden = false;
  genStatus.className = kind;
  genStatus.textContent = text;
}

async function runGeneration(): Promise<void> {
  const prompt = promptEl.value.trim();
  if (!prompt) {
    // Returning silently here made the button look broken: the placeholder
    // reads as pre-filled text, so an empty box does not look empty.
    setStatus('Type what you want first — the grey text is only a placeholder.', 'bad');
    promptEl.focus();
    return;
  }

  genBtn.disabled = true;
  const started = Date.now();
  // The CLI takes a minute or two; keep a running clock so it never looks hung.
  const tick = setInterval(
    () => setStatus(`generating… ${Math.round((Date.now() - started) / 1000)}s`),
    500,
  );

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        engine: engineEl.value,
        answers: answerPairs(),
        size: requestedSize(),
      }),
    });
    const data = (await res.json()) as {
      name?: string; elapsedMs?: number; parts?: string[]; warnings?: string[];
      attempts?: number; repaired?: string[]; error?: string;
      usage?: { outputTokens: number; inputTokens: number; costUsd?: number; model?: string };
    };
    clearInterval(tick);
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);

    qaEl.hidden = true;
    current = data.name!;
    mode = 'single';
    syncModeButtons();
    await poll();
    renderModelButtons();

    const secs = ((data.elapsedMs ?? 0) / 1000).toFixed(0);
    const fixed = (data.attempts ?? 1) > 1 ? ` · repaired ${data.repaired?.length ?? 0}` : '';
    const warn = data.warnings?.length ? `\n${data.warnings.join('\n')}` : '';
    setStatus(
      `${data.name} · ${data.parts?.length ?? 0} parts · ${secs}s${fixed}${costLine(data.usage)}${warn}`,
      data.warnings?.length ? '' : 'good',
    );
  } catch (e) {
    clearInterval(tick);
    setStatus(e instanceof Error ? e.message : String(e), 'bad');
  } finally {
    genBtn.disabled = false;
  }
}

// ---- Ask before building --------------------------------------------------

/**
 * A one-line prompt underspecifies a model and the generator fills the gaps
 * generically. Answering a few targeted questions first is what turns "a
 * wizard" into something specific enough to build well.
 */
interface Question {
  id: string;
  q: string;
  options: string[];
}

const askBtn = $<HTMLButtonElement>('askBtn');
const buildBtn = $<HTMLButtonElement>('buildBtn');
const qaEl = $('qa');
const qaListEl = $('qaList');

let questions: Question[] = [];
/** Question id -> chosen or typed answer. */
const answers = new Map<string, string>();

function renderQuestions(): void {
  qaListEl.innerHTML = questions
    .map(
      (q, i) => `
      <div class="q" data-q="${i}">
        <p>${escapeHtml(q.q)}</p>
        <div class="qopts">
          ${q.options
            .map(
              (o, j) =>
                `<button class="qopt" data-q="${i}" data-o="${j}">${escapeHtml(o)}</button>`,
            )
            .join('')}
        </div>
        <input data-q="${i}" placeholder="or write your own" />
      </div>`,
    )
    .join('');
  qaEl.hidden = false;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

qaListEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.qopt');
  if (!btn) return;
  const qi = Number(btn.dataset.q);
  const oi = Number(btn.dataset.o);
  const q = questions[qi];
  const picked = q.options[oi];
  // Clicking the chosen option again clears it, so a question can be skipped.
  const already = answers.get(q.id) === picked;
  if (already) answers.delete(q.id);
  else answers.set(q.id, picked);

  qaListEl
    .querySelectorAll<HTMLElement>(`.qopt[data-q="${qi}"]`)
    .forEach((b) => b.classList.toggle('on', !already && b === btn));
  const input = qaListEl.querySelector<HTMLInputElement>(`input[data-q="${qi}"]`);
  if (input && !already) input.value = '';
});

qaListEl.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.tagName !== 'INPUT') return;
  const qi = Number(input.dataset.q);
  const q = questions[qi];
  if (input.value.trim()) answers.set(q.id, input.value.trim());
  else answers.delete(q.id);
  qaListEl
    .querySelectorAll<HTMLElement>(`.qopt[data-q="${qi}"]`)
    .forEach((b) => b.classList.remove('on'));
});

async function runQuestions(): Promise<void> {
  const prompt = promptEl.value.trim();
  if (!prompt) {
    setStatus('Type what you want first — the grey text is only a placeholder.', 'bad');
    promptEl.focus();
    return;
  }
  askBtn.disabled = true;
  const started = Date.now();
  const tick = setInterval(
    () => setStatus(`thinking of questions… ${Math.round((Date.now() - started) / 1000)}s`),
    500,
  );
  try {
    const res = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, engine: engineEl.value }),
    });
    const data = (await res.json()) as {
      questions?: Question[];
      usage?: { outputTokens: number; inputTokens: number; costUsd?: number };
      error?: string;
    };
    clearInterval(tick);
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
    questions = data.questions ?? [];
    answers.clear();
    renderQuestions();
    setStatus(`${questions.length} questions${costLine(data.usage)}`, '');
  } catch (e) {
    clearInterval(tick);
    setStatus(e instanceof Error ? e.message : String(e), 'bad');
  } finally {
    askBtn.disabled = false;
  }
}

/** The answers travel to the generator as plain question/answer pairs. */
function answerPairs(): Array<{ q: string; a: string }> {
  return questions
    .filter((q) => answers.has(q.id))
    .map((q) => ({ q: q.q, a: answers.get(q.id)! }));
}

// ---- Body dimensions ------------------------------------------------------

/**
 * Exact voxel dimensions for the body. Left empty the model picks, and the
 * proportion guard applies; filled in, the artist's numbers win outright and
 * that guard steps aside.
 */
const sizeW = $<HTMLInputElement>('sizeW');
const sizeH = $<HTMLInputElement>('sizeH');
const sizeD = $<HTMLInputElement>('sizeD');

function requestedSize(): [number, number, number] | undefined {
  const n = [sizeW, sizeH, sizeD].map((el) => Number(el.value));
  if (n.some((v) => !Number.isFinite(v) || v < 4)) return undefined;
  return n as [number, number, number];
}

$<HTMLButtonElement>('sizeClear').addEventListener('click', () => {
  sizeW.value = '';
  sizeH.value = '';
  sizeD.value = '';
});

askBtn.addEventListener('click', () => void runQuestions());
buildBtn.addEventListener('click', () => void runGeneration());
genBtn.addEventListener('click', () => {
  questions = [];
  answers.clear();
  qaEl.hidden = true;
  void runGeneration();
});

// ---- Revision -------------------------------------------------------------

const revisePromptEl = $<HTMLTextAreaElement>('revisePrompt');
const reviseBtn = $<HTMLButtonElement>('reviseBtn');
const undoBtn = $<HTMLButtonElement>('undoBtn');
const reviseStatus = $('reviseStatus');
const reviseTarget = $('reviseTarget');
const reviseLabel = $('reviseLabel');

function setReviseStatus(text: string, kind: '' | 'good' | 'bad' = ''): void {
  reviseStatus.hidden = false;
  reviseStatus.className = kind;
  reviseStatus.textContent = text;
}

/** Revision always acts on the model currently selected in Single mode. */
function syncReviseTarget(): void {
  const active = mode === 'single' && current;
  reviseTarget.textContent = active ? current : '';
  reviseLabel.style.opacity = active ? '1' : '0.5';
  reviseBtn.disabled = !active;
  undoBtn.disabled = !active;
}

async function postRevise(body: Record<string, unknown>, label: string): Promise<void> {
  reviseBtn.disabled = true;
  undoBtn.disabled = true;
  const started = Date.now();
  const tick = setInterval(
    () => setReviseStatus(`${label}… ${Math.round((Date.now() - started) / 1000)}s`),
    500,
  );
  try {
    const res = await fetch('/api/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scene: current, engine: engineEl.value, ...body }),
    });
    const data = (await res.json()) as {
      name?: string; elapsedMs?: number; parts?: string[]; warnings?: string[];
      attempts?: number; repaired?: string[]; reverted?: boolean; error?: string;
      applied?: string[];
      usage?: { outputTokens: number; inputTokens: number; costUsd?: number; model?: string };
    };
    clearInterval(tick);
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);

    lastRawFor(current);
    await poll();

    if (data.reverted) {
      setReviseStatus(`${data.name} reverted to its previous version`, 'good');
      return;
    }
    const secs = ((data.elapsedMs ?? 0) / 1000).toFixed(0);
    const fixed = (data.attempts ?? 1) > 1 ? ` · repaired ${data.repaired?.length ?? 0}` : '';
    const warn = data.warnings?.length ? `\n${data.warnings.join('\n')}` : '';
    setReviseStatus(
      `${data.name} · ${secs}s${fixed}${costLine(data.usage)}` +
        (data.applied?.length ? `\n${data.applied.join('\n')}` : '') +
        warn,
      data.warnings?.length ? '' : 'good',
    );
    revisePromptEl.value = '';
  } catch (e) {
    clearInterval(tick);
    setReviseStatus(e instanceof Error ? e.message : String(e), 'bad');
  } finally {
    syncReviseTarget();
  }
}

/** Drop the cached copy so the next poll rebuilds from the new file. */
function lastRawFor(name: string): void {
  loaded.delete(name);
}

reviseBtn.addEventListener('click', () => {
  const instruction = revisePromptEl.value.trim();
  if (!current) {
    setReviseStatus('Pick a model first.', 'bad');
    return;
  }
  if (!instruction) {
    setReviseStatus('Say what to change — the grey text is only a placeholder.', 'bad');
    revisePromptEl.focus();
    return;
  }
  void postRevise({ instruction }, 'revising');
});

undoBtn.addEventListener('click', () => {
  if (!current) return;
  void postRevise({ undo: true }, 'reverting');
});

revisePromptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    reviseBtn.click();
  }
});
promptEl.addEventListener('keydown', (e) => {
  // Enter submits; Shift+Enter for a newline.
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void runGeneration();
  }
});

// Folding the panel hands its width back to the camera, which matters most in
// gallery mode where the models need every pixel.
const panelEl = $('panel');
const panelBody = $('body');
const collapseBtn = $<HTMLButtonElement>('collapse');
collapseBtn.addEventListener('click', () => {
  const folded = panelEl.classList.toggle('folded');
  panelBody.hidden = folded;
  collapseBtn.textContent = folded ? '▶' : '◀';
  collapseBtn.title = folded ? 'Show panel' : 'Hide panel';
  panelWidth = folded ? 60 : PANEL_OPEN_W;
  updateProjection();
  applyCamera(camPreset);
});

updateProjection();
syncModeButtons();
void poll();
setInterval(() => void poll(), 500);

const projected = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  // Keep name tags pinned above their models.
  for (const t of tags) {
    projected.copy(t.pos).project(camera);
    const visible = projected.z < 1;
    t.el.style.display = visible ? 'block' : 'none';
    if (!visible) continue;
    t.el.style.left = `${((projected.x + 1) / 2) * innerWidth}px`;
    t.el.style.top = `${((-projected.y + 1) / 2) * innerHeight}px`;
  }
});
