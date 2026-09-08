import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { buildScene } from '../core/build.js';
import { OUT_DIR, listScenes, loadScene, saveScene } from '../core/store.js';
import { formatReport, validate } from '../core/validate.js';
import { writeVox } from '../io/vox.js';
import type { Detail, Part, VoxelScene } from '../core/types.js';

/**
 * Voxel tools for an agent (Claude Code / Codex) over MCP.
 *
 * Two properties matter for cost. Every mutating tool returns a compact
 * validation report, so the agent learns whether it broke the model without a
 * second call or a render. And a scene is only written to disk after it builds,
 * so a bad edit fails loudly instead of corrupting saved state.
 *
 * Nothing may be written to stdout — that channel is the MCP transport.
 */

const vec3 = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
const hex = z.string().regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'expected a hex color like #3a6ea5');
const align = z.enum(['min', 'center', 'max']);
const anchor = z.object({
  to: z.enum(['top', 'bottom', 'left', 'right', 'front', 'back', 'center']),
  alignX: align.optional(),
  alignY: align.optional(),
  alignZ: align.optional(),
});
const shape = z.enum(['box', 'sphere', 'cylinder', 'cone', 'pyramid']);
const region = z.tuple([
  z.number().int(), z.number().int(), z.number().int(),
  z.number().int(), z.number().int(), z.number().int(),
]);

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

/** Build, then report. Throws if the scene is structurally unbuildable. */
function reportFor(scene: VoxelScene, note: string): string {
  const build = buildScene(scene);
  return `${note}\n\n${formatReport(validate(build, { kind: scene.kind, scene }))}`;
}

/**
 * Load, mutate, verify, save. The build runs before the write so a scene on
 * disk always renders.
 */
function applyEdit(name: string, mutate: (s: VoxelScene) => string): string {
  const scene = loadScene(name);
  const note = mutate(scene);
  const out = reportFor(scene, note);
  saveScene(scene);
  return out;
}

const server = new McpServer({ name: 'voxelcreator', version: '0.1.0' });

server.registerTool(
  'list_scenes',
  {
    title: 'List scenes',
    description: 'List every saved voxel scene by name.',
    inputSchema: {},
  },
  async () => {
    const scenes = listScenes();
    return text(scenes.length === 0 ? 'No scenes yet.' : scenes.join('\n'));
  },
);

server.registerTool(
  'create_scene',
  {
    title: 'Create empty scene',
    description:
      'Start a scene from a single root part, for props and objects rather than ' +
      'characters. Add further parts with add_part, anchoring each to a parent.',
    inputSchema: {
      name: z.string(),
      rootId: z.string().describe('Id of the root part, e.g. "body"'),
      size: vec3.describe('Root part size [width, height, depth]'),
      color: hex,
      shape: shape.optional(),
    },
  },
  async ({ name, rootId, size, color, shape: sh }) => {
    const scene: VoxelScene = {
      name,
      root: rootId,
      parts: [{ id: rootId, size, color, ...(sh ? { shape: sh } : {}) }],
      details: [],
    };
    const out = reportFor(scene, `Created scene "${name}" with root part "${rootId}".`);
    saveScene(scene);
    return text(out);
  },
);

server.registerTool(
  'get_scene',
  {
    title: 'Get scene',
    description:
      'Return the full semantic scene as JSON: parts, anchors, colors and ' +
      'details. This is the editable representation — read it before revising.',
    inputSchema: { name: z.string() },
  },
  async ({ name }) => text(JSON.stringify(loadScene(name), null, 2)),
);

server.registerTool(
  'describe_scene',
  {
    title: 'Describe scene',
    description:
      'Compact structural summary: resolved part positions and sizes plus the ' +
      'validation report (connectivity, symmetry, ground contact, thickness). ' +
      'Far cheaper than reading voxels; use this to check your work.',
    inputSchema: { name: z.string() },
  },
  async ({ name }) => {
    const scene = loadScene(name);
    const build = buildScene(scene);
    const lines = build.layout.placed.map(
      (p) =>
        `  ${p.part.id.padEnd(10)} size=[${p.size.join(',')}] pos=[${p.pos.join(',')}]` +
        `${p.mirrored ? ` (mirrors ${p.sourceId})` : ''}`,
    );
    const details = scene.details.map(
      (d) => `  ${(d.id ?? '(unnamed)').padEnd(10)} on ${d.part} ${d.color}${d.mirror ? ' mirrored' : ''}`,
    );
    return text(
      [
        `scene: ${scene.name}   root: ${scene.root}`,
        'parts:',
        ...lines,
        details.length > 0 ? 'details:' : 'details: none',
        ...details,
        '',
        formatReport(validate(build, { kind: scene.kind, scene })),
      ].join('\n'),
    );
  },
);

server.registerTool(
  'set_part',
  {
    title: 'Edit a part',
    description:
      'Change an existing part in place. Only the fields you pass are touched. ' +
      'Because children are anchored to their parent, resizing a part moves ' +
      'whatever hangs off it instead of detaching it — this is the tool to use ' +
      'for revisions like "longer arms" or "bigger head".',
    inputSchema: {
      scene: z.string(),
      id: z.string().describe('Part id, e.g. "arm_r"'),
      size: vec3.optional(),
      color: hex.optional(),
      shape: shape.optional(),
      anchor: anchor.optional(),
      offset: vec3.optional().describe('Nudge in voxels applied after anchoring'),
      hollow: z.boolean().optional(),
    },
  },
  async ({ scene, id, ...patch }) =>
    text(
      applyEdit(scene, (s) => {
        const part = s.parts.find((p) => p.id === id);
        if (!part) {
          throw new Error(`No part "${id}" in "${scene}". Parts: ${s.parts.map((p) => p.id).join(', ')}`);
        }
        const changed: string[] = [];
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) continue;
          (part as unknown as Record<string, unknown>)[k] = v;
          changed.push(k);
        }
        if (changed.length === 0) return `No changes requested for "${id}".`;
        return `Updated ${id}: ${changed.join(', ')}.`;
      }),
    ),
);

server.registerTool(
  'add_part',
  {
    title: 'Add a part',
    description:
      'Attach a new part to an existing one — a helmet, weapon, ear, tail, wheel. ' +
      'Anchor it to a parent face rather than using absolute coordinates so it ' +
      'stays attached when the parent changes. Set mirrorOf instead of parent to ' +
      'create the mirrored twin of another part.',
    inputSchema: {
      scene: z.string(),
      id: z.string(),
      size: vec3,
      color: hex,
      parent: z.string().optional().describe('Parent part id (omit only when using mirrorOf)'),
      anchor: anchor.optional().describe('Defaults to { to: "top" }'),
      offset: vec3.optional(),
      shape: shape.optional(),
      mirrorOf: z.string().optional().describe('Make this part the mirror image of the named part'),
      hollow: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ scene, ...part }) =>
    text(
      applyEdit(scene, (s) => {
        if (s.parts.some((p) => p.id === part.id)) {
          throw new Error(`Part "${part.id}" already exists in "${scene}"`);
        }
        if (!part.parent && !part.mirrorOf) {
          throw new Error(`Part "${part.id}" needs either a parent or mirrorOf`);
        }
        s.parts.push(part as Part);
        return `Added part ${part.id}${part.parent ? ` to ${part.parent}` : ` mirroring ${part.mirrorOf}`}.`;
      }),
    ),
);

server.registerTool(
  'remove_part',
  {
    title: 'Remove a part',
    description:
      'Delete a part, anything anchored to it, anything mirroring it, and its details.',
    inputSchema: { scene: z.string(), id: z.string() },
  },
  async ({ scene, id }) =>
    text(
      applyEdit(scene, (s) => {
        if (s.root === id) throw new Error(`Cannot remove the root part "${id}"`);
        if (!s.parts.some((p) => p.id === id)) throw new Error(`No part "${id}" in "${scene}"`);

        // Cascade so we never leave a part pointing at a missing parent.
        const doomed = new Set<string>([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const p of s.parts) {
            if (doomed.has(p.id)) continue;
            if ((p.parent && doomed.has(p.parent)) || (p.mirrorOf && doomed.has(p.mirrorOf))) {
              doomed.add(p.id);
              grew = true;
            }
          }
        }
        s.parts = s.parts.filter((p) => !doomed.has(p.id));
        s.details = s.details.filter((d) => !doomed.has(d.part));
        return `Removed ${[...doomed].join(', ')}.`;
      }),
    ),
);

server.registerTool(
  'add_detail',
  {
    title: 'Paint a region',
    description:
      'Paint a box-shaped region in part-local coordinates. Only existing voxels ' +
      'are recolored, so a detail can never add floating geometry. Use this for ' +
      'faces, clothing, trim and markings rather than adding thin parts. Local ' +
      'coordinates run from [0,0,0] to size-1; the front face is at max Z. ' +
      'Set mirror to paint the X-mirrored region too (eyes, pockets).',
    inputSchema: {
      scene: z.string(),
      id: z.string().describe('Detail id, e.g. "visor"'),
      part: z.string().describe('Part to paint on'),
      region: region.describe('[x0,y0,z0,x1,y1,z1] inclusive, in part-local voxels'),
      color: hex,
      mirror: z.boolean().optional(),
    },
  },
  async ({ scene, ...detail }) =>
    text(
      applyEdit(scene, (s) => {
        if (!s.parts.some((p) => p.id === detail.part)) {
          throw new Error(`No part "${detail.part}" in "${scene}"`);
        }
        s.details = s.details.filter((d) => d.id !== detail.id);
        s.details.push(detail as Detail);
        return `Painted ${detail.id} on ${detail.part}.`;
      }),
    ),
);

server.registerTool(
  'remove_detail',
  {
    title: 'Remove a painted region',
    description: 'Delete a detail by id.',
    inputSchema: { scene: z.string(), id: z.string() },
  },
  async ({ scene, id }) =>
    text(
      applyEdit(scene, (s) => {
        const before = s.details.length;
        s.details = s.details.filter((d) => d.id !== id);
        if (s.details.length === before) throw new Error(`No detail "${id}" in "${scene}"`);
        return `Removed detail ${id}.`;
      }),
    ),
);

server.registerTool(
  'export_vox',
  {
    title: 'Export .vox',
    description:
      'Write the scene to out/<name>.vox for MagicaVoxel, VoxEdit or any .vox consumer.',
    inputSchema: { name: z.string() },
  },
  async ({ name }) => {
    const scene = loadScene(name);
    const build = buildScene(scene);
    const bytes = writeVox(build.grid, build.palette);
    const path = join(OUT_DIR, `${name}.vox`);
    writeFileSync(path, bytes);
    return text(
      `Wrote ${path} (${bytes.length} bytes, ${build.grid.count()} voxels, ` +
        `${build.palette.size} colors).\n\n${formatReport(validate(build, { kind: scene.kind, scene }))}`,
    );
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('voxelcreator MCP server ready\n');
