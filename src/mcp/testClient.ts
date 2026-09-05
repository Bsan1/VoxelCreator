import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Exercises the MCP server the way an agent would: create, inspect, revise,
 * attach, export. Run with `npm run test:mcp`.
 */

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/mcp/server.ts'],
});

const client = new Client({ name: 'voxel-test', version: '0.1.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log(`tools (${tools.tools.length}): ${tools.tools.map((t) => t.name).join(', ')}\n`);

async function call(name: string, args: Record<string, unknown>): Promise<void> {
  const res = await client.callTool({ name, arguments: args });
  const body = (res.content as Array<{ type: string; text?: string }>)
    .map((c) => c.text ?? '')
    .join('\n');
  console.log(`── ${name}(${JSON.stringify(args)})`);
  console.log(body.split('\n').map((l) => `   ${l}`).join('\n'));
  console.log();
  if (res.isError) throw new Error(`${name} failed`);
}

// 1. Generate a character.
await call('create_humanoid', {
  name: 'orc',
  head: [10, 9, 9],
  torso: [10, 12, 5],
  arm: [5, 13, 5],
  leg: [5, 11, 5],
  colors: { skin: '#6f8f4f', shirt: '#5a3a28', pants: '#3b2a1e', hair: '#241a12', eyes: '#c8352b' },
});

// 2. Revise proportions — the classic follow-up request.
await call('set_part', { scene: 'orc', id: 'arm_r', size: [5, 16, 5] });

// 3. Attach something new, anchored so it survives later edits.
await call('add_part', {
  scene: 'orc',
  id: 'helmet',
  parent: 'head',
  size: [12, 3, 11],
  color: '#7d7f88',
  anchor: { to: 'top' },
});

// 4. Paint a marking; mirrored so both sides match.
await call('add_detail', {
  scene: 'orc',
  id: 'warpaint',
  part: 'head',
  region: [1, 3, 8, 2, 6, 8],
  color: '#c8352b',
  mirror: true,
});

// 5. Confirm structure, then export.
await call('describe_scene', { name: 'orc' });
await call('export_vox', { name: 'orc' });

await client.close();
