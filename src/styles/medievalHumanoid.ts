import { tiersOf, type SizeTier, type StyleProfile } from '../core/style.js';

/**
 * "Medieval Humanoid" — the first style profile.
 *
 * A standing figure that reads as one rectangular prism: the head is the top of
 * the body block, and the face, clothing and arms are painted on rather than
 * built. Chunky, square-footed, small palette, heavy on painted detail.
 *
 * This is one project's style, not the tool's. Copy the file, change the
 * numbers, and register the copy in `index.ts` to chase a different constant for
 * a different game.
 */
export const MEDIEVAL_HUMANOID: StyleProfile = {
  id: 'medieval-humanoid',
  name: 'Medieval Humanoid',
  description:
    'A standing figure that reads as one rectangular prism, with the face and ' +
    'clothing painted onto the block rather than built out of it.',

  // The artist works at 8x18x8; everything else is a clean multiple, so two
  // models standing side by side belong to the same set.
  baseSize: [8, 18, 8],
  scales: [0.5, 1, 1.5, 2],
  squareFootprint: true,

  // A 1-wide line is a legitimate marking; an isolated patch smaller than 2x2
  // is noise. Anything stricter cannot draw a face in the six rows the base
  // body's head band gives it.
  featureRule: 'line1',

  taper: { shrink: 4, stepHeight: 2, chamfer: 1, tip: 2 },

  prismMinPct: 60,
  minAspect: 0.4,
  maxFlatBandPct: 25,
  minPaintContrast: 20,
  minFaceShades: 3,
  bodyFlare: 'none',
  flareStartPct: 40,
  minStepWidth: 4,
  shapes: ['box', 'sphere', 'cylinder', 'cone', 'pyramid'],
};

/**
 * What each rung can carry.
 *
 * The detail a model can hold is set by its voxel count, the same way it is set
 * by canvas size in flat pixel art. A face needs brow, gap, eyes, gap and mouth
 * stacked inside the head band; at the base size that band is six rows, so the
 * features have to be one and two voxels tall and nothing else fits. At double
 * size it is twelve rows and the same face looks starved.
 */
export const MEDIEVAL_HUMANOID_TIERS: SizeTier[] = tiersOf(MEDIEVAL_HUMANOID, [
  {
    label: 'half',
    details: [4, 7],
    face: 'Two single-voxel eyes and nothing else. There is no room for a brow or a mouth.',
    notes:
      'A 4x9x4 body is a token, not a portrait. One flat garment colour, one trim ' +
      'line, one accent. No headwear beyond a single flat cap.',
  },
  {
    label: 'base',
    details: [8, 12],
    face:
      'Brow 1 row, one row of skin, eyes 2 rows, one row of skin, mouth 1 row — ' +
      'exactly the six rows available, so nothing may be thicker.',
    notes:
      'Trim is a single voxel line. Eyes are 2 wide with 2 voxels of skin between ' +
      'them. Headwear is one piece 3-4 tall. One accent colour, used twice at most.',
  },
  {
    label: 'one and a half',
    details: [12, 18],
    face:
      'Brow 1, gap 1, eyes 2, gap 1, nose 1, mouth 1-2 — nine rows, with room to ' +
      'spare for hair or a helmet lip at the top.',
    notes:
      'Trim lines 1-2 voxels. A chest emblem of about 4x5. Headwear one or two ' +
      'pieces, up to 6 tall. Two accent colours.',
  },
  {
    label: 'double',
    details: [18, 26],
    face:
      'Twelve rows: brow, gap, eyes 2-3 tall, gap, nose, gap, mouth, plus hair or ' +
      'a helmet band above and a collar below.',
    notes:
      'This size looks EMPTY if it is painted like the base size. Panels get inner ' +
      'shading, trim gets a highlight beside it, the garment gets folds. A stepped ' +
      'hat can taper in smaller steps here because there are rows to spend.',
  },
]);
