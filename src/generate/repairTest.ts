import { buildScene } from '../core/build.js';
import { formatReport, validate } from '../core/validate.js';
import { buildRepairPrompt } from './prompt.js';
import { extractJson, specToScene, type GenSpec } from './spec.js';
import { runCliForTest } from './agent.js';

/**
 * Exercises the correction pass on a deliberately broken spec, since a good
 * generation never triggers it. The staff here is 24 tall off a 12-tall arm, so
 * it reaches well below the feet — exactly the defect that made the first
 * fire mage look like it floated.
 *
 * Run with `npm run test:repair`.
 */
const BROKEN: GenSpec = {
  name: 'repair_probe',
  root: { id: 'body', size: [10, 26, 8], color: '#4a3a8c' },
  parts: [
    {
      id: 'staff',
      size: [2, 24, 2], // too thin in two axes, and hung downward it reaches past the base
      color: '#6b4a2f',
      parent: 'body',
      anchor: { to: 'right', alignY: 'min' },
      offset: [0, -14, 0],
    },
  ],
};

const before = validate(buildScene(specToScene(BROKEN)));
const problems = before.checks
  .filter((c) => c.severity !== 'pass')
  .map((c) => `${c.id}: ${c.message}`);

console.log('BEFORE');
console.log(formatReport(before));
if (problems.length === 0) {
  console.error('\nProbe is no longer broken — update it so the repair path stays covered.');
  process.exit(1);
}

console.log('\nrunning correction pass…');
const call = await runCliForTest('claude', buildRepairPrompt(
  'a wizard with a wooden staff',
  JSON.stringify(BROKEN, null, 2),
  problems,
), 240_000);
const raw = call.text;

const repaired = specToScene(extractJson(raw));
const after = validate(buildScene(repaired));

console.log('\nAFTER');
console.log(formatReport(after));

const fixed = after.checks.filter((c) => c.severity !== 'pass').length;
const staff = repaired.parts.find((p) => p.id === 'staff');
console.log(`\nstaff is now ${staff ? JSON.stringify(staff.size) : 'MISSING'} (was [2,24,2])`);
console.log(fixed === 0 ? 'repair pass fixed every problem' : `${fixed} problem(s) remain`);
process.exit(fixed === 0 ? 0 : 1);
