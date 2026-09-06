import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScene } from './core/build.js';
import { OUT_DIR, loadScene } from './core/store.js';
import { renderSheet } from './render/raster.js';

/** Usage: npm run render -- <scene> */
for (const name of process.argv.slice(2)) {
  const { grid, palette } = buildScene(loadScene(name));
  const png = renderSheet(grid, palette, 320);
  const path = join(OUT_DIR, `${name}.png`);
  writeFileSync(path, png);
  console.log(`${path}  ${png.length} bytes  (front + 3/4)`);
}
