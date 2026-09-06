import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR, SCENES_DIR, listScenes, writeIndex } from './core/store.js';

/**
 * Usage: npm run clean            remove every saved scene and export
 *        npm run clean -- keep a b   remove everything except those
 *
 * Every scene is committed, so git is the undo here.
 */
const keepIdx = process.argv.indexOf('keep');
const keep = new Set(keepIdx === -1 ? [] : process.argv.slice(keepIdx + 1));

const scenes = listScenes();
const doomed = scenes.filter((s) => !keep.has(s));

for (const name of doomed) {
  rmSync(join(SCENES_DIR, `${name}.scene.json`), { force: true });
  for (const ext of ['vox', 'png']) {
    rmSync(join(OUT_DIR, `${name}.${ext}`), { force: true });
  }
  const history = join(SCENES_DIR, '.history', name);
  if (existsSync(history)) rmSync(history, { recursive: true, force: true });
}

// Sweep any exports left behind by scenes that are already gone.
if (existsSync(OUT_DIR)) {
  const alive = new Set(listScenes());
  for (const f of readdirSync(OUT_DIR)) {
    const base = f.replace(/\.(vox|png)$/, '');
    if (base !== f && !alive.has(base)) rmSync(join(OUT_DIR, f), { force: true });
  }
}

writeIndex();
console.log(`removed ${doomed.length} scene(s)${keep.size ? `, kept ${[...keep].join(', ')}` : ''}`);
console.log(`${listScenes().length} left`);
