import type { SizeTier, StyleProfile } from '../core/style.js';
import { minMarking } from '../core/style.js';

/**
 * The style's size ladder, written out for the prompt.
 *
 * Voxel count is to voxel art what pixel size is to pixel art: it is the one
 * decision everything else follows from, and models were arriving at 12x24x14,
 * 16x34x16, 18x35x12 — no two on the same scale, so no two looked like they came
 * from the same set.
 *
 * The second half matters as much as the first. How much detail a model can
 * carry is set by its voxel count, so each rung ships its own budget: a face
 * needs brow, gap, eyes, gap and mouth stacked inside a head band that is a
 * third of the body, and what fits in six rows is not what fits in twelve.
 * Asking for the same detail at both ends is how a small model turns to mush and
 * a large one turns out empty.
 */
export function sizeLadderBlock(profile: StyleProfile, tiers: SizeTier[]): string {
  const rows = tiers
    .map((t) => {
      const [w, h, d] = t.size;
      return (
        `  ${`${w}x${h}x${d}`.padEnd(11)} (${t.label}) — head band ${t.headRows} rows, ` +
        `${t.details[0]}-${t.details[1]} painted regions
      FACE: ${t.face}
      ${t.notes}`
      );
    })
    .join('\n\n');

  const mark = minMarking(profile.featureRule);
  const footprint = profile.squareFootprint ? 'Width and depth are always equal.' : '';

  return `=== THE SIZE LADDER ===

Pick the ROOT size from this ladder and use it exactly. Every model in this set
is the base body ${profile.baseSize.join('x')} or a clean multiple of it, so that two models
standing side by side belong to the same set. ${footprint}

${rows}

Choose by how much the request asks for, not by how important the character is:
a plain guard at the base size, a king or a boss at one and a half, a giant or a
showpiece at double. When in doubt, one and a half.

HOW MUCH DETAIL IS SET BY THE SIZE, NOT BY YOUR ENTHUSIASM. The budget above is
what the voxel count can carry. Under it the model reads as empty; over it the
markings collide and turn to noise.

SMALLEST MARKING: a line may be ${mark.line} voxel${mark.line === 1 ? '' : 's'} across as long as it runs
across the form; a patch — an eye, an emblem, a buckle — must be at least
${mark.patch}x${mark.patch}. A single voxel on its own is not detail, it is dirt.`;
}

/** The rung a free-form height sits nearest, for reporting or snapping. */
export function tierNearestHeight(tiers: SizeTier[], height: number): SizeTier {
  return tiers.reduce((best, t) =>
    Math.abs(t.size[1] - height) < Math.abs(best.size[1] - height) ? t : best,
  );
}
