import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScene } from './core/build.js';
import { OUT_DIR, loadScene, saveScene } from './core/store.js';
import { writeVox } from './io/vox.js';
import type { Part, VoxelScene } from './core/types.js';

/**
 * The same body wearing three different hats, so a silhouette can be picked by
 * looking rather than from a written description. Authored directly — no model
 * call — because the point is to compare shapes, not to generate anything.
 *
 * Run with `npm run hats`.
 */
const BASE = 'buyucu8';
const base = loadScene(BASE);
const body = base.parts.find((p) => p.id === base.root)!;
const [bw, bh, bd] = body.size;
const HAT = '#2f3f66';
const TRIM = '#c9a227';

/** Everything on the base except its headwear, so only the hat differs. */
const bodyOnly = (): VoxelScene => ({
  ...structuredClone(base),
  parts: structuredClone(base.parts).filter((p) => !/hat|brim|cone|tip/.test(p.id)),
});

const variants: Array<{ name: string; note: string; hat: Part[] }> = [
  {
    name: 'hat_a_tall',
    note: 'narrow brim, tall pointed cone — classic wizard',
    hat: [
      { id: 'brim', size: [bw + 2, 1, bd + 2], color: HAT, parent: body.id, anchor: { to: 'top' } },
      {
        id: 'cone',
        size: [bw - 2, Math.round(bh * 0.34), bd - 2],
        color: HAT,
        shape: 'cone',
        parent: 'brim',
        anchor: { to: 'top' },
      },
    ],
  },
  {
    name: 'hat_b_squat',
    note: 'wider brim, short cone — what it makes today',
    hat: [
      { id: 'brim', size: [bw + 2, 2, bd + 2], color: HAT, parent: body.id, anchor: { to: 'top' } },
      {
        id: 'cone',
        size: [bw - 4, Math.round(bh * 0.2), bd - 4],
        color: HAT,
        shape: 'cone',
        parent: 'brim',
        anchor: { to: 'top' },
      },
      {
        id: 'tip',
        size: [4, 2, 4],
        color: HAT,
        shape: 'cone',
        parent: 'cone',
        anchor: { to: 'top' },
      },
    ],
  },
  {
    name: 'hat_c_hood',
    note: 'no brim — a hood the body width, framing the face',
    hat: [
      {
        id: 'hood',
        size: [bw, Math.round(bh * 0.22), bd],
        color: HAT,
        parent: body.id,
        anchor: { to: 'top' },
        offset: [0, -2, 0],
      },
      {
        id: 'peak',
        size: [bw - 4, 3, bd - 4],
        color: HAT,
        shape: 'pyramid',
        parent: 'hood',
        anchor: { to: 'top' },
      },
    ],
  },
];

for (const v of variants) {
  const scene = bodyOnly();
  scene.name = v.name;
  scene.parts.push(...v.hat);
  // A stripe on the brim so the hat reads as a hat and not as roofing.
  if (v.hat.some((p) => p.id === 'brim')) {
    scene.details.push({ id: 'band', part: 'brim', region: [0, 0, 0, bw + 1, 0, bd + 1], color: TRIM });
  }
  const build = buildScene(scene);
  saveScene(scene);
  writeFileSync(join(OUT_DIR, `${v.name}.vox`), writeVox(build.grid, build.palette));
  console.log(
    `${v.name.padEnd(14)} ${String(build.grid.sx).padStart(2)}x${build.grid.sy}x${build.grid.sz}  ${v.note}`,
  );
}
console.log(`\nSame ${bw}x${bh}x${bd} body on all three — only the hat differs.`);
