import { readFileSync } from 'node:fs';
import { buildScene } from './core/build.js';
import { validate, formatReport } from './core/validate.js';
import { loadScene } from './core/store.js';

for (const name of process.argv.slice(2)) {
  const scene = loadScene(name);
  console.log(`=== ${name} ===`);
  console.log(formatReport(validate(buildScene(scene), { kind: scene.kind })));
  console.log();
}
