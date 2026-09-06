import { formatReport } from './core/validate.js';
import { visualPass } from './generate/agent.js';

/** Usage: npm run look -- <scene> "what it was meant to be" */
const [name, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const intent = rest.join(' ').trim();

if (!name) {
  console.error('Usage: npm run look -- <scene> "what it was meant to be"');
  process.exit(1);
}

console.log(`rendering "${name}" and looking at it…`);
const r = await visualPass(name, intent || name, {
  engine: process.argv.includes('--codex') ? 'codex' : 'claude',
});

console.log(`\nrender: ${r.imagePath}`);
if (r.rejected) {
  console.log('its edits broke the model, so they were discarded:');
  for (const p of r.rejected) console.log('  ' + p);
} else if (r.applied.length === 0) {
  console.log('nothing changed — it judged the model good enough as it stands');
} else {
  console.log('edits it made after looking:');
  for (const e of r.applied) console.log(`  ${e}`);
}
if (r.usage) {
  console.log(
    `\ntokens: ${r.usage.inputTokens.toLocaleString()} in / ${r.usage.outputTokens.toLocaleString()} out` +
      (r.usage.costUsd ? `  ~$${r.usage.costUsd.toFixed(3)}` : ''),
  );
}
console.log(`\n${formatReport(r.report)}`);
