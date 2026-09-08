import type { ShapeKind } from './types.js';

/**
 * A style profile: the constants that make a set of models look like one set.
 *
 * The house style used to be written into the code — a fixed base size, a fixed
 * boxiness threshold, one reference model, taper numbers buried in the cone
 * primitive. That is the wrong shape for what this tool is for. The point of
 * locking a style down is to get consistent output **for one project**; the next
 * project wants a different constant, and it should be able to have one without
 * editing the generator.
 *
 * So everything that decides how a model looks lives here, in a profile that can
 * be swapped. Nothing in `validate`, `prompt` or the primitives may hard-code a
 * style number any more — it reads one from the active profile instead.
 *
 * A profile is deliberately opinionated. Two profiles are not meant to be
 * compatible: a chunky prism style and, say, a tall detailed style will disagree
 * about size, silhouette, detail budget and palette, and that disagreement is
 * the whole feature.
 */

/**
 * How small a painted marking is allowed to be.
 *
 * Pixel art's actual rule is narrower than "no single pixels": an orphan pixel
 * is one **not connected to a cluster of the same colour**, and a connected
 * 1-wide line is a legitimate technique. The three settings are the three
 * readings of that, and the choice is measurable rather than a matter of taste —
 * a face needs brow, gap, eyes, gap and mouth stacked inside the head band, so
 * `min2` needs eight rows and simply does not fit a head band of six.
 */
export type FeatureRule =
  /** Anything goes, including isolated single voxels. Most detail, most noise. */
  | 'free'
  /** A 1-wide line is fine; a patch must be at least 2x2. The pixel-art rule. */
  | 'line1'
  /** Nothing smaller than 2 in any direction. No noise, but no small faces. */
  | 'min2';

/** One rung of the size ladder, with the detail the voxel count can carry. */
export interface SizeTier {
  scale: number;
  size: [number, number, number];
  label: string;
  /** Rows in the head third, which is what a face has to fit inside. */
  headRows: number;
  /** Painted regions this size can carry without starving or crowding. */
  details: [number, number];
  /** What the face can be at this size, in one line. */
  face: string;
  /** Everything else the size allows or forbids. */
  notes: string;
}

/** How a tapering form — a hat, a crown, a roof — steps in. */
export interface TaperRule {
  /** Voxels lost from the width at each step. Even, so it stays centred. */
  shrink: number;
  /** Layers before the next step. Two is the shortest that reads as a step. */
  stepHeight: number;
  /** Voxels taken off each corner, or 0 for a hard square step. */
  chamfer: number;
  /** Voxels left at the tip. 1 is an orphan; 2 reads. */
  tip: number;
}

/** Used when no profile is supplied — the "Prism" settings. */
export const DEFAULT_TAPER: TaperRule = { shrink: 4, stepHeight: 2, chamfer: 1, tip: 2 };

export interface StyleProfile {
  id: string;
  name: string;
  /** One line on what this style is for. */
  description: string;

  /** The body every other size is a multiple of. */
  baseSize: [number, number, number];
  /** Multiples offered, smallest first. */
  scales: number[];
  /** Width must equal depth. */
  squareFootprint: boolean;

  featureRule: FeatureRule;
  taper: TaperRule;

  /** Minimum share of its bounding box a character body must fill, 0-100. */
  prismMinPct: number;
  /** Minimum width-to-height ratio before a body reads as a pillar. */
  minAspect: number;
  /** Longest run of one flat unpainted colour, as a share of the height. */
  maxFlatBandPct: number;
  /** Colour distance below which a marking is invisible against its surface. */
  minPaintContrast: number;
  /** Distinct colours the head band needs before it reads as a face. */
  minFaceShades: number;
  /**
   * Whether the body may widen on its way down at all.
   *
   * "none" is not a limitation, it is the house position: a robe is painted, not
   * built. Every stepped attempt measured worse than a straight one — the flare
   * adds width the ladder's proportions cannot absorb, and a figure at aspect
   * 0.59 reads as a barrel where the same figure at 0.40 reads as a person.
   * Cloth is conveyed with vertical value bands instead, which is how flat pixel
   * art has always done it.
   *
   * "stepped" allows a flare, and then flareStartPct and minStepWidth govern it.
   */
  bodyFlare: 'none' | 'stepped';
  /** Only read when bodyFlare is "stepped": where the widening may begin. */
  flareStartPct: number;
  /**
   * Smallest width change a step may make. A step exposes a top face, the
   * brightest surface the renderer makes, so a change of 2 leaves a one-voxel
   * band of it — a single-voxel cluster of the highest-contrast value there is.
   */
  minStepWidth: number;
  /** Shapes the style permits at all. */
  shapes: ShapeKind[];
}

/** The tiers of a profile, derived from its base size and scales. */
export function tiersOf(profile: StyleProfile, copy: Partial<SizeTier>[] = []): SizeTier[] {
  return profile.scales.map((scale, i) => {
    const size: [number, number, number] = [
      Math.round(profile.baseSize[0] * scale),
      Math.round(profile.baseSize[1] * scale),
      Math.round(profile.baseSize[2] * scale),
    ];
    return {
      scale,
      size,
      label: copy[i]?.label ?? `x${scale}`,
      headRows: Math.round(size[1] / 3),
      details: copy[i]?.details ?? [8, 12],
      face: copy[i]?.face ?? '',
      notes: copy[i]?.notes ?? '',
    };
  });
}

/** The rung a size sits on exactly, or undefined when it is off the ladder. */
export function tierFor(tiers: SizeTier[], size: readonly number[]): SizeTier | undefined {
  return tiers.find((t) => t.size[0] === size[0] && t.size[1] === size[1] && t.size[2] === size[2]);
}

/** The rung nearest a height, for snapping or for reporting the closest fit. */
export function nearestTier(tiers: SizeTier[], height: number): SizeTier {
  return tiers.reduce((best, t) =>
    Math.abs(t.size[1] - height) < Math.abs(best.size[1] - height) ? t : best,
  );
}

/**
 * The smallest painted marking a profile allows, as [thin axis, other axis].
 * A line may be 1 across as long as it runs; a patch must be 2 both ways.
 */
export function minMarking(rule: FeatureRule): { line: number; patch: number } {
  switch (rule) {
    case 'free':
      return { line: 1, patch: 1 };
    case 'line1':
      return { line: 1, patch: 2 };
    case 'min2':
      return { line: 2, patch: 2 };
  }
}
