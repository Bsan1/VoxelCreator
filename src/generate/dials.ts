/**
 * The two art-direction dials.
 *
 * Saying "more boxy" or "more detail" in a prompt does nothing measurable: the
 * model reads it as a mood and the structural checks do not move, so nothing
 * enforces it. Each dial here drives BOTH the wording the model gets and the
 * threshold it is checked against — which is what makes turning it up actually
 * change the output rather than just the instruction.
 */
export interface StyleDials {
  /** 0 = free silhouette, 100 = a near-pure rectangular prism. */
  boxiness: number;
  /** 0 = flat blocks of colour, 100 = densely painted and trimmed. */
  detail: number;
}

export const DEFAULT_DIALS: StyleDials = { boxiness: 65, detail: 50 };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function normalizeDials(d?: Partial<StyleDials>): StyleDials {
  return {
    boxiness: clamp(d?.boxiness ?? DEFAULT_DIALS.boxiness),
    detail: clamp(d?.detail ?? DEFAULT_DIALS.detail),
  };
}

/**
 * Minimum share of its bounding box a character must fill.
 *
 * 30% at the loose end still rejects a spidery figure; 82% at the tight end
 * still admits a hat and one step, which a hard 90% would not.
 */
export function prismMinPct(dials: StyleDials): number {
  return Math.round(30 + dials.boxiness * 0.52);
}

/** How many painted regions the model is asked for, and checked against. */
export function detailTarget(dials: StyleDials): { min: number; aim: number } {
  const aim = Math.round(3 + (dials.detail / 100) * 19); // 3 at 0, ~22 at 100
  return { min: Math.max(1, Math.round(aim * 0.6)), aim };
}

/** The art-direction paragraph injected into the generation prompt. */
export function describeDials(dials: StyleDials): string {
  const { boxiness, detail } = dials;
  const fill = prismMinPct(dials);
  const { aim } = detailTarget(dials);

  const silhouette =
    boxiness >= 85
      ? `ALMOST A PURE BOX. Deviate only where the concept is meaningless without
it. At most one shallow step, and protrusions no deeper than 2 voxels. Say
everything else with paint.`
      : boxiness >= 65
        ? `STRONGLY BOXY. One mass. A stepped profile only when the concept has that
silhouette (a flared gown), one or two small protrusions for named features
(a hat brim, a crest), relief panels for trim.`
        : boxiness >= 40
          ? `MOSTLY BOXY. The main mass still reads as one block, but you may step the
profile and add several protrusions where they help the concept read —
shoulders, a hood, a snout, a tail stub.`
          : `LOOSELY BOXY. Keep a single dominant mass so it still reads as one figure,
but shape it freely: multiple steps, pronounced protrusions and layered
volumes are all fine.`;

  const detailText =
    detail >= 80
      ? `RICHLY DETAILED. Aim for about ${aim} painted regions. Layer them: a base
colour, a mid-tone garment, then thin bright trim lines picking out collar,
cuffs, belt, hem and seams. Add an emblem or pattern on the chest. Use relief
panels (a part 1-2 voxels deep laid on a face) for the belt, collar and any
plate, so the detail catches light instead of being flat.`
      : detail >= 45
        ? `MODERATELY DETAILED. Aim for about ${aim} painted regions: face, hair or
helmet, garment, a belt, trim at collar and hem, footwear. One or two relief
panels for the pieces that should stand proud.`
        : detail >= 20
          ? `RESTRAINED. Aim for about ${aim} painted regions — the face and the few
shapes that define the character. Leave large areas as flat colour.`
          : `MINIMAL. About ${aim} painted regions, nothing more. Big flat planes of
colour; let the silhouette carry it.`;

  return `=== ART DIRECTION ===

SILHOUETTE (boxiness ${boxiness}/100)
${silhouette}

Your model will be measured: it must fill at least ${fill}% of its own bounding
box. A solid box is 100%; a figure with limbs sticking out is about 40%.

DETAIL (${detail}/100)
${detailText}

Painted regions are cheap and they are what makes a model look designed.
Extra parts are expensive and they break the silhouette. When you want more
detail, paint more — do not build more.`;
}
