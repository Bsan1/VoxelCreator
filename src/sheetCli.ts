import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScene } from './core/build.js';
import { loadScene, OUT_DIR } from './core/store.js';
import { renderContactSheet, type ViewName } from './render/raster.js';

/**
 * `npm run sheet -- a b c d` — several models on one numbered page.
 *
 * The workflow this exists for: generate variants of the same thing with one
 * setting changed, look at them side by side, say which number is right. That
 * is how a style gets settled; describing the options does not work.
 */
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx !== -1 ? args[outIdx + 1] : 'sheet';
const viewIdx = args.indexOf('--view');
const view = (viewIdx !== -1 ? args[viewIdx + 1] : 'three_quarter') as ViewName;
// A missing flag is index -1, so -1 + 1 = 0 passes an "is it a real index?"
// test and silently eats the FIRST scene name. It has now happened three times
// in this repo; only add a flag's value position when the flag is actually there.
const skip = new Set<number>();
for (const idx of [outIdx, viewIdx]) {
  if (idx === -1) continue;
  skip.add(idx);
  skip.add(idx + 1);
}
const names = args.filter((a, i) => !a.startsWith('--') && !skip.has(i));

if (names.length === 0) {
  console.error('usage: npm run sheet -- <scene> [scene...] [--out name] [--view front|three_quarter|side]');
  process.exit(1);
}

const entries = names.map((name) => {
  const build = buildScene(loadScene(name));
  return { grid: build.grid, palette: build.palette };
});

// Tiles shrink as the batch grows: sixteen candidates at 420px each would be a
// 7000px page nobody can take in at once.
const cols =
  names.length <= 4 ? names.length : names.length <= 6 ? 3 : names.length <= 12 ? 4 : Math.ceil(Math.sqrt(names.length));
const tileSize = names.length <= 2 ? 420 : names.length <= 6 ? 340 : names.length <= 12 ? 280 : 240;
const png = renderContactSheet(entries, { cols, size: tileSize, view });
const path = join(OUT_DIR, `${out}.png`);
writeFileSync(path, png);

console.log(`${path}  ${png.length} bytes`);
names.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
