import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScene } from '../core/build.js';
import { OUT_DIR } from '../core/store.js';
import { formatReport } from '../core/validate.js';
import { writeVox } from '../io/vox.js';
import { generate, type Engine } from './agent.js';

/** Usage: npm run generate -- "a fire mage with a staff" [--codex] [--name mage] */
const argv = process.argv.slice(2);
const engine: Engine = argv.includes('--codex') ? 'codex' : 'claude';
const flagValue = (flag: string): { value?: string; idx: number } => {
  const idx = argv.indexOf(flag);
  return { value: idx === -1 ? undefined : argv[idx + 1], idx };
};
const nameFlag = flagValue('--name');
const forFlag = flagValue('--for');
const isItem = argv.includes('--item') || forFlag.idx !== -1;
const consumed = new Set([nameFlag.idx + 1, forFlag.idx + 1].filter((i) => i > 0));
const prompt = argv
  .filter((a, i) => !a.startsWith('--') && !consumed.has(i))
  .join(' ')
  .trim();

if (!prompt) {
  console.error(
    'Usage:\n' +
      '  npm run generate -- "a knight in plate armour" [--codex] [--name knight]\n' +
      '  npm run generate -- "a kite shield" --for knight --name shield\n' +
      '\n--for <character> generates equipment matched to that character\'s ' +
      'palette and scale. --item generates equipment with no reference.',
  );
  process.exit(1);
}

console.log(
  `generating ${isItem ? 'item' : 'character'} with ${engine}: "${prompt}"` +
    (forFlag.value ? ` (for "${forFlag.value}")` : ''),
);
const result = await generate(prompt, {
  engine,
  name: nameFlag.value,
  item: isItem,
  forCharacter: forFlag.value,
});

const build = buildScene(result.scene);
const bytes = writeVox(build.grid, build.palette);
writeFileSync(join(OUT_DIR, `${result.scene.name}.vox`), bytes);

console.log(
  `\n${result.scene.name}  ${build.grid.sx}x${build.grid.sy}x${build.grid.sz}  ` +
    `${build.grid.count()} voxels  ${build.palette.size} colors  ` +
    `${(result.elapsedMs / 1000).toFixed(1)}s`,
);
console.log(`parts: ${result.scene.parts.map((p) => p.id).join(', ')}`);
const u = result.usage;
console.log(`tokens: ${u.inputTokens.toLocaleString()} in (${u.cacheReadTokens.toLocaleString()} cached) / ${u.outputTokens.toLocaleString()} out  ` + `across ${result.attempts} call(s)` + (u.costUsd ? `  ~${u.costUsd.toFixed(3)}` : '') + (u.model ? `  [${u.model}]` : ''));
if (result.attempts > 1) {
  console.log(`\nrepaired after attempt 1 reported:`);
  for (const p of result.repairedProblems) console.log(`  - ${p}`);
}
console.log(`\n${formatReport(result.report)}`);
console.log(`\nsaved scenes/${result.scene.name}.scene.json and out/${result.scene.name}.vox`);
