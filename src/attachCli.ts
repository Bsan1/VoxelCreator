import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScene } from './core/build.js';
import { attachItem, socketsFor } from './core/compose.js';
import { OUT_DIR, loadScene, saveScene } from './core/store.js';
import { formatReport, validate } from './core/validate.js';
import { writeVox } from './io/vox.js';

/**
 * Usage: npm run attach -- <character> <item> <socket> [--name combined]
 *
 * Writes a new combined scene; the character and item scenes are left alone,
 * so one sword can be attached to several characters.
 */
const argv = process.argv.slice(2);
const nameIdx = argv.indexOf('--name');
const outName = nameIdx === -1 ? undefined : argv[nameIdx + 1];
const positional = argv.filter((a, i) => !a.startsWith('--') && i !== nameIdx + 1);
const [charName, itemName, socketId] = positional;

if (!charName || !itemName) {
  console.error('Usage: npm run attach -- <character> <item> <socket> [--name combined]');
  process.exit(1);
}

const character = loadScene(charName);
const item = loadScene(itemName);

if (!socketId) {
  console.error(
    `Pick a socket. "${charName}" exposes: ${socketsFor(character).map((s) => s.id).join(', ')}`,
  );
  process.exit(1);
}

const combined = attachItem(character, item, socketId);
if (outName) combined.name = outName;

const build = buildScene(combined);
const report = validate(build, { kind: combined.kind, scene: combined });
saveScene(combined);
writeFileSync(join(OUT_DIR, `${combined.name}.vox`), writeVox(build.grid, build.palette));

console.log(
  `${combined.name}  ${build.grid.sx}x${build.grid.sy}x${build.grid.sz}  ` +
    `${build.grid.count()} voxels  ${build.palette.size} colors`,
);
console.log(`attached "${itemName}" to "${charName}" at ${socketId}`);
console.log(`\n${formatReport(report)}`);
console.log(`\nsaved scenes/${combined.name}.scene.json and out/${combined.name}.vox`);
