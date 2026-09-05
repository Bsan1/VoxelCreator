import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VoxelScene } from './types.js';

/**
 * Scenes live as JSON on disk. That is deliberate: it is the state an agent
 * revises between turns, it survives restarts, and the viewer can watch it.
 *
 * Paths resolve from this module rather than the process cwd, so the MCP
 * server writes to the same place no matter where the host agent launches it.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCENES_DIR = join(ROOT, 'scenes');
export const OUT_DIR = join(ROOT, 'out');

function ensureDirs(): void {
  for (const d of [SCENES_DIR, OUT_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

const safeName = (name: string): string => {
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!clean) throw new Error(`Unusable scene name: ${JSON.stringify(name)}`);
  return clean;
};

export const scenePath = (name: string): string =>
  join(SCENES_DIR, `${safeName(name)}.scene.json`);

const HISTORY_DIR = join(SCENES_DIR, '.history');

export function saveScene(scene: VoxelScene): string {
  ensureDirs();
  const path = scenePath(scene.name);
  writeFileSync(path, JSON.stringify(scene, null, 2));
  writeIndex();
  return path;
}

/**
 * Snapshot the current version before overwriting it. Revision is iterative and
 * an instruction can make a model worse, so every revise keeps an undo step.
 */
export function snapshotScene(name: string): void {
  const path = scenePath(name);
  if (!existsSync(path)) return;
  const dir = join(HISTORY_DIR, safeName(name));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${Date.now()}.scene.json`), readFileSync(path, 'utf8'));
}

/** Most recent snapshot first. */
export function historyFor(name: string): string[] {
  const dir = join(HISTORY_DIR, safeName(name));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.scene.json'))
    .sort()
    .reverse()
    .map((f) => join(dir, f));
}

/** Restore the previous version, consuming that snapshot. Returns it. */
export function revertScene(name: string): VoxelScene {
  const [latest] = historyFor(name);
  if (!latest) throw new Error(`No earlier version of "${name}" to revert to`);
  const scene = JSON.parse(readFileSync(latest, 'utf8')) as VoxelScene;
  writeFileSync(scenePath(name), JSON.stringify(scene, null, 2));
  rmSync(latest);
  writeIndex();
  return scene;
}

export function loadScene(name: string): VoxelScene {
  const path = scenePath(name);
  if (!existsSync(path)) throw new Error(`No scene named "${name}" (looked in ${path})`);
  return JSON.parse(readFileSync(path, 'utf8')) as VoxelScene;
}

export function listScenes(): string[] {
  ensureDirs();
  return readdirSync(SCENES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.scene.json'))
    .map((e) => e.name)
    .map((f) => f.replace(/\.scene\.json$/, ''))
    .sort();
}

/** Manifest the viewer reads to populate its scene list. */
export function writeIndex(): void {
  ensureDirs();
  const scenes = listScenes();
  writeFileSync(
    join(SCENES_DIR, 'index.json'),
    JSON.stringify({ scenes, updated: Date.now() }, null, 2),
  );
}
