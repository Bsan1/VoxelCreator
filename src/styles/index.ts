import type { SizeTier, StyleProfile } from '../core/style.js';
import { setAmbientTaper } from '../core/build.js';
import { MEDIEVAL_HUMANOID, MEDIEVAL_HUMANOID_TIERS } from './medievalHumanoid.js';

/**
 * The style registry.
 *
 * One project, one style. Add a profile here to work on a different game with a
 * different constant, and select it with `VOXEL_STYLE=<id>` or by passing the id
 * through — nothing in the generator or the validator should know a style's
 * numbers, only which profile is active.
 */
export interface RegisteredStyle {
  profile: StyleProfile;
  tiers: SizeTier[];
}

export const STYLES: Record<string, RegisteredStyle> = {
  [MEDIEVAL_HUMANOID.id]: { profile: MEDIEVAL_HUMANOID, tiers: MEDIEVAL_HUMANOID_TIERS },
};

export const DEFAULT_STYLE_ID = MEDIEVAL_HUMANOID.id;

// Tapering happens deep inside the voxel rasteriser, far from anything that
// knows which style is active, so the registry pushes it down once on load.
setAmbientTaper(activeStyleProfile().taper);

function activeStyleProfile(): StyleProfile {
  const id = process.env.VOXEL_STYLE || MEDIEVAL_HUMANOID.id;
  return (STYLES[id] ?? STYLES[MEDIEVAL_HUMANOID.id]).profile;
}

/** Look a style up by id, falling back to the default with a clear error. */
export function styleById(id: string): RegisteredStyle {
  const found = STYLES[id];
  if (!found) {
    throw new Error(
      `No style profile "${id}". Available: ${Object.keys(STYLES).join(', ')}`,
    );
  }
  return found;
}

/**
 * The style everything reads from unless told otherwise. Env-selected so a
 * project can pin its own without editing code.
 */
export function activeStyle(): RegisteredStyle {
  return styleById(process.env.VOXEL_STYLE || DEFAULT_STYLE_ID);
}

export { MEDIEVAL_HUMANOID, MEDIEVAL_HUMANOID_TIERS } from './medievalHumanoid.js';
