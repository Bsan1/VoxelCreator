import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildScene } from '../core/build.js';
import { formatReport, validate } from '../core/validate.js';
import { specToScene } from '../generate/spec.js';
import { REFERENCES } from '../generate/reference.js';

/**
 * Exercises the MCP server the way the agent does: create a root, step and cap
 * it, revise a proportion, paint the face and the garment, then inspect and
 * export. Run with `npm run test:mcp`.
 *
 * It builds a house-style figure on purpose — one prism, a stepped skirt, a
 * painted face, no bare stretches — so a clean report at the end also checks
 * that the validator still passes work which follows the rules.
 */

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/mcp/server.ts'],
});

const client = new Client({ name: 'voxel-test', version: '0.1.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log(`tools (${tools.tools.length}): ${tools.tools.map((t) => t.name).join(', ')}\n`);

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await client.callTool({ name, arguments: args });
  const body = (res.content as Array<{ type: string; text?: string }>)
    .map((c) => c.text ?? '')
    .join('\n');
  console.log(`── ${name}(${JSON.stringify(args)})`);
  console.log(body.split('\n').map((l) => `   ${l}`).join('\n'));
  console.log();
  if (res.isError) throw new Error(`${name} failed`);
  return body;
}

// The worked example that goes into every generation prompt has to be a model
// the generator would be right to copy. Validate it here rather than in its own
// script: a reference that quietly stops scoring clean would degrade every
// generation and nothing else would notice.
for (const ref of REFERENCES) {
  const refScene = specToScene(structuredClone(ref.spec));
  const refReport = validate(buildScene(refScene), {
    kind: refScene.kind,
    detailCount: refScene.details.length,
    detailMin: 10,
    scene: refScene,
  });
  console.log(`── reference example: ${ref.id}`);
  console.log(formatReport(refReport).split('\n').map((l) => `   ${l}`).join('\n'));
  console.log();
  if (refReport.summary.warn > 0 || refReport.summary.fail > 0) {
    console.error(`The prompt reference "${ref.id}" no longer passes its own checks.`);
    process.exit(1);
  }
}

const SCENE = 'mcp_test_figure';
const SKIN = '#c99a68';
const DARK = '#1b1b22';
const CLOTH = '#3f5d8a';
const TRIM = '#c9a227';

// 1. The whole figure starts as one box.
await call('create_scene', { name: SCENE, rootId: 'body', size: [12, 24, 12], color: CLOTH });

// 2. A stepped skirt below and a hat above — the only shape deviations the
//    house style allows. Every centred part keeps the body's even width, or it
//    would land half a voxel off centre.
await call('add_part', {
  scene: SCENE, id: 'skirt', parent: 'body',
  size: [14, 8, 14], color: CLOTH, anchor: { to: 'bottom' },
});
await call('add_part', {
  scene: SCENE, id: 'hat_brim', parent: 'body',
  size: [14, 1, 14], color: DARK, anchor: { to: 'top' }, offset: [0, -1, 0],
});
await call('add_part', {
  scene: SCENE, id: 'hat_crown', parent: 'hat_brim',
  size: [10, 5, 10], color: DARK, anchor: { to: 'top' },
});

// 3. Revising a proportion is the classic follow-up: the skirt and the hat are
//    anchored, so they ride along instead of detaching.
await call('set_part', { scene: SCENE, id: 'body', size: [12, 28, 12] });

// 4. Paint, against the revised size. The face goes on first and the garment
//    covers the drop below it, which is what `face` and `flat_band` measure.
const paint = (id: string, part: string, region: number[], color: string, mirror = false) =>
  call('add_detail', { scene: SCENE, id, part, region, color, mirror });

await paint('face', 'body', [0, 19, 11, 11, 27, 11], SKIN);
await paint('brow', 'body', [1, 26, 11, 10, 26, 11], DARK);
await paint('eye_r', 'body', [7, 23, 11, 8, 24, 11], DARK, true);
await paint('mouth', 'body', [5, 21, 11, 6, 21, 11], DARK);
await paint('collar', 'body', [0, 18, 0, 11, 18, 11], TRIM);
await paint('emblem', 'body', [4, 10, 11, 7, 16, 11], TRIM);
await paint('belt', 'body', [0, 6, 0, 11, 7, 11], DARK);
await paint('sleeve_r', 'body', [0, 8, 0, 0, 17, 11], DARK, true);
await paint('skirt_seam', 'skirt', [0, 6, 0, 13, 6, 13], DARK);
await paint('skirt_fold', 'skirt', [0, 3, 0, 13, 3, 13], DARK);
await paint('skirt_hem', 'skirt', [0, 0, 0, 13, 1, 13], TRIM);
await paint('crown_band', 'hat_crown', [0, 0, 0, 9, 0, 9], TRIM);

// 5. Removing a detail must leave the rest of the paint alone.
await paint('scratch', 'body', [0, 0, 11, 11, 0, 11], DARK);
await call('remove_detail', { scene: SCENE, id: 'scratch' });

// 6. Confirm structure, then export.
const report = await call('describe_scene', { name: SCENE });
await call('export_vox', { name: SCENE });

await client.close();

// The figure above follows the house style, so it should pass. A warning means
// either it drifted or a check regressed, and either is worth failing over.
if (/(?:WARN|FAIL)\s+[1-9]/.test(report)) {
  console.error('Structural checks did not come back clean — see the report above.');
  process.exit(1);
}
console.log('MCP round trip clean.');
