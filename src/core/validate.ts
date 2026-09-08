import type { VoxelGrid } from './grid.js';
import type { BuildResult } from './build.js';
import type { SceneKind, VoxelScene } from './types.js';
import { nearestTier, tierFor, type SizeTier, type StyleProfile } from './style.js';
import { contrastFloorFor, luminanceOf } from './shading.js';

/**
 * Deterministic structural QA. These checks are what let an agent revise a
 * model without looking at a render: they catch the failures that actually
 * matter (detached limbs, floating specks, a model hovering off the ground)
 * for the cost of a few array scans.
 */

export type Severity = 'pass' | 'warn' | 'fail';

export interface Check {
  id: string;
  severity: Severity;
  message: string;
}

export interface ValidationReport {
  checks: Check[];
  summary: { pass: number; warn: number; fail: number };
  metrics: {
    voxels: number;
    dimensions: [number, number, number];
    components: number;
    largestComponent: number;
    floatingVoxels: number;
    symmetryPct: number;
    paletteSize: number;
    occupancyPct: number;
  };
}

/** Label 6-connected components of occupied voxels. */
function components(grid: VoxelGrid): { count: number; largest: number; floating: number } {
  const seen = new Uint8Array(grid.data.length);
  const stack: number[] = [];
  let count = 0;
  let largest = 0;
  let total = 0;

  const { sx, sy } = grid;
  for (let i = 0; i < grid.data.length; i++) {
    if (grid.data[i] === 0 || seen[i]) continue;
    count++;
    let size = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      size++;
      const x = cur % sx;
      const y = Math.floor(cur / sx) % sy;
      const z = Math.floor(cur / (sx * sy));
      const push = (nx: number, ny: number, nz: number) => {
        if (!grid.inBounds(nx, ny, nz)) return;
        const ni = grid.idx(nx, ny, nz);
        if (seen[ni] || grid.data[ni] === 0) return;
        seen[ni] = 1;
        stack.push(ni);
      };
      push(x + 1, y, z); push(x - 1, y, z);
      push(x, y + 1, z); push(x, y - 1, z);
      push(x, y, z + 1); push(x, y, z - 1);
    }
    total += size;
    if (size > largest) largest = size;
  }
  return { count, largest, floating: total - largest };
}

/** Fraction of voxels whose X-mirror partner is also occupied. */
function symmetryPct(grid: VoxelGrid): number {
  let total = 0;
  let matched = 0;
  grid.forEach((x, y, z) => {
    total++;
    if (grid.get(grid.sx - 1 - x, y, z) !== 0) matched++;
  });
  return total === 0 ? 100 : (matched / total) * 100;
}

export function validate(
  build: BuildResult,
  opts: {
    requireGround?: boolean;
    kind?: SceneKind;
    /** Minimum bounding-box fill, from the boxiness dial. Defaults to 60. */
    prismMinPct?: number;
    /** Painted-region count and the floor the detail dial asks for. */
    detailCount?: number;
    detailMin?: number;
    /** Exact body size the artist asked for, if any. */
    requestedSize?: [number, number, number];
    /** The scene itself, for checks that need the painted details, not voxels. */
    scene?: VoxelScene;
    /**
     * The active style profile. Every threshold below used to be a constant in
     * this file, which meant one project's taste was compiled into the tool.
     * They come from the profile now; without one the style checks stand down
     * rather than quietly applying somebody else's numbers.
     */
    profile?: StyleProfile;
    tiers?: SizeTier[];
  } = {},
): ValidationReport {
  const { grid, palette } = build;
  const checks: Check[] = [];
  const voxels = grid.count();
  const comp = components(grid);
  const sym = symmetryPct(grid);
  const volume = grid.sx * grid.sy * grid.sz;

  // Stance and silhouette rules describe a standing character. A sword is
  // legitimately a thin slab that never touches the floor, so it is judged only
  // on the checks that apply to any model.
  const kind = opts.kind ?? 'character';
  const isCharacter = kind === 'character';
  // An assembly still stands on the floor, but equipment is meant to protrude.
  const standsOnGround = kind !== 'item';

  const add = (id: string, severity: Severity, message: string) =>
    checks.push({ id, severity, message });

  if (voxels === 0) add('non_empty', 'fail', 'Model contains no voxels');
  else add('non_empty', 'pass', `${voxels} voxels`);

  if (comp.count === 1) {
    add('connectivity', 'pass', 'All voxels form one connected body');
  } else {
    add(
      'connectivity',
      'fail',
      `${comp.count} disconnected components; ${comp.floating} voxels are detached from the main body`,
    );
  }

  // Ground contact: something must occupy the bottom layer, or the model floats.
  let touchesGround = false;
  for (let z = 0; z < grid.sz && !touchesGround; z++) {
    for (let x = 0; x < grid.sx; x++) {
      if (grid.get(x, 0, z) !== 0) { touchesGround = true; break; }
    }
  }
  if (opts.requireGround === false || !standsOnGround) {
    add('ground_contact', 'pass', 'Ground contact not required for this model');
  } else if (touchesGround) {
    add('ground_contact', 'pass', 'Model rests on the ground plane');
  } else {
    add('ground_contact', 'warn', 'Nothing touches the ground plane; model appears to float');
  }

  // Informational only. Asymmetry is often deliberate (a staff, a single
  // pauldron); the `centering` check below is the one that catches the
  // accidental kind, and warning twice just adds noise to a correction pass.
  add('symmetry', 'pass', `Bilateral symmetry ${sym.toFixed(1)}%`);

  if (palette.size <= 255) add('palette', 'pass', `${palette.size} colors`);
  else add('palette', 'fail', `${palette.size} colors exceeds the 255 the .vox format allows`);

  // A part meant to sit on the centre line has to straddle the symmetry plane,
  // and cannot when its width parity differs from its parent's, because
  // centring floors to the grid. Only parts whose whole ancestry is centred
  // count: something hanging off an arm (a staff, a shield) is legitimately
  // off-centre and must not be reported.
  const placedById = new Map(build.layout.placed.map((p) => [p.part.id, p]));
  const centredCache = new Map<string, boolean>();
  const expectedCentred = (id: string): boolean => {
    const cached = centredCache.get(id);
    if (cached !== undefined) return cached;
    centredCache.set(id, false); // breaks cycles while resolving
    const pp = placedById.get(id);
    let result = false;
    if (pp) {
      const part = pp.part;
      if (!part.parent && !part.mirrorOf) result = true; // the root
      else if (part.mirrorOf) result = false; // half of a pair
      else {
        const anchor = part.anchor ?? { to: 'top' as const };
        const onCentreLine =
          anchor.to !== 'left' &&
          anchor.to !== 'right' &&
          (anchor.alignX ?? 'center') === 'center' &&
          (part.offset?.[0] ?? 0) === 0;
        result = onCentreLine && expectedCentred(part.parent!);
      }
    }
    centredCache.set(id, result);
    return result;
  };

  const offCentre = build.layout.placed
    .filter((p) => expectedCentred(p.part.id))
    .filter((p) => 2 * p.pos[0] + p.size[0] !== build.layout.mirrorPlaneX2)
    .map((p) => {
      const parentId = p.part.parent;
      const parentWidth = parentId ? placedById.get(parentId)?.size[0] : undefined;
      return parentWidth !== undefined && (parentWidth % 2) !== (p.size[0] % 2)
        ? `${p.part.id} (width ${p.size[0]}) cannot centre in ${parentId} (width ${parentWidth}) — give them the same odd/even parity`
        : `${p.part.id} sits off the symmetry plane`;
    });
  if (offCentre.length === 0) add('centering', 'pass', 'Central parts straddle the symmetry plane');
  else add('centering', 'warn', offCentre.join('; '));

  // How close the model stays to a single rectangular prism. A solid box scores
  // 100%; a figure with separated limbs scores around 40%. This is the check
  // that keeps the house style — the silhouette is meant to read as one mass,
  // stepped where the concept needs it, not as an articulated puppet.
  // The prism rule describes the BODY, not what sits on its head. A pointed
  // hat, a crest or a plume is supposed to have its own shape, so the fill is
  // measured only up to the top of the root mass — everything above that is
  // headwear and is exempt.
  const rootPlaced = build.layout.placed.find((p) => !p.part.parent && !p.part.mirrorOf);
  const bodyTop = rootPlaced ? rootPlaced.pos[1] + rootPlaced.size[1] : grid.sy;

  // The box is defined by the BODY PARTS, not by whatever voxels happen to sit
  // below the head line. A hat brim sunk a voxel into the head would otherwise
  // widen the body's bounding box and make a solid torso score 40%.
  let bodyMinX = Infinity, bodyMaxX = -Infinity, bodyMinZ = Infinity, bodyMaxZ = -Infinity;
  // Headwear is whatever sits at the top of the body. Classifying it by its
  // CENTRE was wrong: the prompt tells the model to sink a hat brim into the
  // head with a negative offset, which puts the brim's centre just below the
  // head line, so it counted as torso. A 16-wide brim on a 12-wide body then
  // widened the body box and scored a perfectly solid prism at 58% — the check
  // punishing the exact construction the prompt asks for. Classify by where a
  // part starts, allowing for that sink.
  const HEADWEAR_SINK = 2;
  for (const p of build.layout.placed) {
    if (p.part.parent && p.pos[1] >= bodyTop - HEADWEAR_SINK) continue; // headwear
    bodyMinX = Math.min(bodyMinX, p.pos[0]);
    bodyMaxX = Math.max(bodyMaxX, p.pos[0] + p.size[0] - 1);
    bodyMinZ = Math.min(bodyMinZ, p.pos[2]);
    bodyMaxZ = Math.max(bodyMaxZ, p.pos[2] + p.size[2] - 1);
  }

  let bodyVoxels = 0;
  if (bodyMinX !== Infinity) {
    for (let y = 0; y < Math.min(bodyTop, grid.sy); y++) {
      for (let z = bodyMinZ; z <= bodyMaxZ; z++) {
        for (let x = bodyMinX; x <= bodyMaxX; x++) {
          if (grid.get(x, y, z) !== 0) bodyVoxels++;
        }
      }
    }
  }
  const bodyVolume =
    bodyMinX === Infinity
      ? 0
      : (bodyMaxX - bodyMinX + 1) * Math.min(bodyTop, grid.sy) * (bodyMaxZ - bodyMinZ + 1);

  const PRISM_MIN_PCT = opts.prismMinPct ?? opts.profile?.prismMinPct ?? 60;
  const fillPct = bodyVolume > 0 ? (bodyVoxels / bodyVolume) * 100 : (voxels / volume) * 100;
  if (!isCharacter) {
    add(
      'prism_fidelity',
      'pass',
      kind === 'assembly'
        ? 'Equipment is expected to break the silhouette'
        : 'Silhouette rules apply to characters only',
    );
  } else if (fillPct >= PRISM_MIN_PCT) {
    add('prism_fidelity', 'pass', `Fills ${fillPct.toFixed(0)}% of its bounding box`);
  } else {
    add(
      'prism_fidelity',
      'warn',
      `The body fills only ${fillPct.toFixed(0)}% of its bounding box (want ` +
        `${PRISM_MIN_PCT}%+). The main mass has strayed too far from a rectangular ` +
        'prism — merge or remove parts that stick out of the torso, and paint that ' +
        'detail on instead. Headwear is not counted, so this is about the body.',
    );
  }

  // When the artist gave exact dimensions, those win: the proportion guard is
  // a fallback for when nobody said, and it must not argue with a stated size.
  if (opts.requestedSize && rootPlaced) {
    const want = opts.requestedSize;
    const got = rootPlaced.size;
    if (want[0] === got[0] && want[1] === got[1] && want[2] === got[2]) {
      add('requested_size', 'pass', `Body is the requested ${want.join('x')}`);
    } else {
      add(
        'requested_size',
        'warn',
        `The body is ${got.join('x')} but ${want.join('x')} was asked for. ` +
          'Set the root part to exactly that size and move the painted regions to match.',
      );
    }
  } else {
    add('requested_size', 'pass', 'No size was requested');
  }

  // A body wider than it is deep is a slab: it reads head-on and falls apart
  // from every other angle, and every part stacked on it inherits the error.
  if (!isCharacter || !rootPlaced) {
    add('square_base', 'pass', 'Footprint rules apply to characters only');
  } else if (rootPlaced.size[0] === rootPlaced.size[2]) {
    add('square_base', 'pass', `Footprint is square (${rootPlaced.size[0]}x${rootPlaced.size[2]})`);
  } else {
    add(
      'square_base',
      'warn',
      `Body footprint is ${rootPlaced.size[0]} wide by ${rootPlaced.size[2]} deep. ` +
        'Make them equal — a slab body looks wrong from any angle but the front.',
    );
  }

  // Does the head read as a head?
  //
  // The prompt has asked for a painted face since the postbox complaints, but
  // nothing measured it, so a model could ship with a bare block on top and
  // still pass every check — which is exactly what happened. One colour across
  // the whole head band means no face, no hair, nothing.
  if (!isCharacter || !rootPlaced) {
    add('face', 'pass', 'Face rules apply to characters only');
  } else {
    const top = rootPlaced.pos[1] + rootPlaced.size[1];
    const headBottom = Math.max(0, top - Math.round(rootPlaced.size[1] / 3));
    const shades = new Set<number>();
    for (let y = headBottom; y < Math.min(top, grid.sy); y++) {
      for (let z = rootPlaced.pos[2]; z < rootPlaced.pos[2] + rootPlaced.size[2]; z++) {
        for (let x = rootPlaced.pos[0]; x < rootPlaced.pos[0] + rootPlaced.size[0]; x++) {
          const v = grid.get(x, y, z);
          if (v !== 0) shades.add(v);
        }
      }
    }
    if (shades.size >= (opts.profile?.minFaceShades ?? 3)) {
      add('face', 'pass', `Head band uses ${shades.size} colours`);
    } else {
      add(
        'face',
        'warn',
        `The head band (y ${headBottom}-${top}) uses only ${shades.size} colour(s), so there ` +
          'is no face on it. Paint the head area — skin or helmet across it, then eyes, ' +
          'brow and mouth inside that — before any clothing detail.',
      );
    }
  }

  // Is any stretch of the figure a featureless slab?
  //
  // The complaint that keeps coming back is that a model "looks like a
  // postbox", and this is what that means numerically: a long run of rows in
  // one flat colour with nothing painted on it. Checks for silhouette, base and
  // face all pass on such a model, because none of them look at the middle. The
  // measure is deliberately about the whole figure rather than any one part, so
  // it catches an unpainted torso, an unpainted skirt or an unpainted hat alike.
  if (!isCharacter) {
    add('flat_band', 'pass', 'Flat-band rule applies to characters only');
  } else {
    const shadesPerRow: number[] = [];
    const onlyShade: number[] = [];
    let filledRows = 0;
    for (let y = 0; y < grid.sy; y++) {
      const seen = new Set<number>();
      for (let z = 0; z < grid.sz; z++) {
        for (let x = 0; x < grid.sx; x++) {
          const v = grid.get(x, y, z);
          if (v !== 0) seen.add(v);
        }
      }
      shadesPerRow.push(seen.size);
      onlyShade.push(seen.size === 1 ? [...seen][0] : -1);
      if (seen.size > 0) filledRows++;
    }

    let longest = 0;
    let from = 0;
    let to = -1;
    let runStart = -1;
    let runShade = -1;
    for (let y = 0; y < grid.sy; y++) {
      const shade = onlyShade[y];
      if (shade === -1) {
        runStart = -1;
        runShade = -1;
        continue;
      }
      if (shade !== runShade) {
        runStart = y;
        runShade = shade;
      }
      const len = y - runStart + 1;
      if (len > longest) {
        longest = len;
        from = runStart;
        to = y;
      }
    }

    // A quarter of the figure is generous: a plain skirt or a plain hat crown
    // stays under it, an undecorated torso does not.
    const limit = Math.max(4, Math.round((filledRows * (opts.profile?.maxFlatBandPct ?? 25)) / 100));
    if (longest <= limit) {
      add('flat_band', 'pass', `Longest flat run is ${longest} rows (limit ${limit})`);
    } else {
      add(
        'flat_band',
        'warn',
        `Rows y ${from}-${to} are ${longest} rows of one flat colour with nothing ` +
          `painted on them, out of ${filledRows} — the figure reads as a blank slab ` +
          `there. Paint that stretch: a belt, a seam, a shaded panel, a change of ` +
          `garment colour. Do not fix this by adding parts.`,
      );
    }
  }
  // A tall narrow block reads as a monument, not a character. Voxel figures
  // need to be chunky — this is the proportion failure that no amount of
  // painted detail can rescue.
  const MIN_ASPECT = opts.profile?.minAspect ?? 0.4;
  if (!isCharacter || !rootPlaced || opts.requestedSize) {
    add('proportion', 'pass', 'Proportion is the artist\'s call here');
  } else {
    const [rw, rh] = rootPlaced.size;
    const aspect = rw / rh;
    if (aspect >= MIN_ASPECT) {
      add('proportion', 'pass', `Body is ${rw}x${rh}, aspect ${aspect.toFixed(2)}`);
    } else {
      add(
        'proportion',
        'warn',
        `Body is ${rw} wide by ${rh} tall (aspect ${aspect.toFixed(2)}, want ` +
          `${MIN_ASPECT}+). That is too narrow and reads as a pillar — widen it to ` +
          `at least ${Math.ceil(rh * MIN_ASPECT)} or shorten it.`,
      );
    }
  }

  // A model that narrows to a point at the bottom looks like it is balancing or
  // floating once placed in a scene. Comparing the base against the widest
  // cross-section catches that without needing to know which part is "legs".
  const areaAt = (y: number): number => {
    let n = 0;
    for (let z = 0; z < grid.sz; z++) {
      for (let x = 0; x < grid.sx; x++) if (grid.get(x, y, z) !== 0) n++;
    }
    return n;
  };
  let maxArea = 0;
  for (let y = 0; y < grid.sy; y++) maxArea = Math.max(maxArea, areaAt(y));
  // The base has to read as one solid footing. Splitting it into two blocks
  // turns the figure into a puppet with legs, which is exactly what this style
  // avoids — feet belong on the surface as paint, not as separate masses.
  const baseIslands = (): number => {
    const seen = new Uint8Array(grid.sx * grid.sz);
    const at = (x: number, z: number) => x + z * grid.sx;
    let islands = 0;
    for (let z = 0; z < grid.sz; z++) {
      for (let x = 0; x < grid.sx; x++) {
        if (grid.get(x, 0, z) === 0 || seen[at(x, z)]) continue;
        islands++;
        const stack = [[x, z]];
        seen[at(x, z)] = 1;
        while (stack.length > 0) {
          const [cx, cz] = stack.pop()!;
          for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
            if (nx < 0 || nz < 0 || nx >= grid.sx || nz >= grid.sz) continue;
            if (seen[at(nx, nz)] || grid.get(nx, 0, nz) === 0) continue;
            seen[at(nx, nz)] = 1;
            stack.push([nx, nz]);
          }
        }
      }
    }
    return islands;
  };
  const islands = standsOnGround ? baseIslands() : 1;
  if (!standsOnGround) {
    add('solid_base', 'pass', 'Base rules apply to characters only');
  } else if (islands <= 1) {
    add('solid_base', 'pass', 'The model stands on one solid base');
  } else {
    add(
      'solid_base',
      'warn',
      `The base is split into ${islands} separate blocks. This style has no separate ` +
        'legs — merge them into one footing and paint the boots on instead.',
    );
  }

  const baseArea = areaAt(0);
  const basePct = maxArea === 0 ? 0 : (baseArea / maxArea) * 100;
  if (!standsOnGround) {
    add('base_footprint', 'pass', 'Base rules apply to characters only');
  } else if (basePct >= 25) {
    add('base_footprint', 'pass', `Base is ${basePct.toFixed(0)}% of the widest layer`);
  } else {
    add(
      'base_footprint',
      'warn',
      `The bottom layer is only ${basePct.toFixed(0)}% of the widest layer, so the model ` +
        'tapers to a point and will look unstable. Something thin reaches below the main mass.',
    );
  }

  // Thin in ONE axis is a relief panel — a raised belt or collar, which is how
  // detail is supposed to be added. Thin in two axes is a stick, which reads as
  // noise. Only the second is worth warning about.
  const MIN_THICKNESS = 3;
  const sticks = build.layout.placed.filter(
    (p) => p.size.filter((d) => d < MIN_THICKNESS).length >= 2,
  );
  if (sticks.length === 0) {
    add('thickness', 'pass', 'No part is thin in more than one axis');
  } else {
    add(
      'thickness',
      'warn',
      `Thin in two or more axes, will read as noise: ` +
        sticks.map((p) => `${p.part.id} [${p.size.join('x')}]`).join(', '),
    );
  }

  // What makes the detail dial real. Without a check, "more detail" is a mood
  // the model can ignore; with one, falling short is a defect the correction
  // pass has to answer for.
  if (opts.detailMin === undefined || opts.detailCount === undefined) {
    add('detail_density', 'pass', 'No detail target set for this model');
  } else if (opts.detailCount >= opts.detailMin) {
    add('detail_density', 'pass', `${opts.detailCount} painted regions`);
  } else {
    add(
      'detail_density',
      'warn',
      `Only ${opts.detailCount} painted regions, and this model was asked for at ` +
        `least ${opts.detailMin}. Add painted detail — trim at the collar, belt and ` +
        'hem, an emblem, seams — rather than adding parts.',
    );
  }

  // Can the paint actually be seen?
  //
  // detail_density counts painted regions, and a model can satisfy it while
  // painting nothing visible: one came back with 21 details in a palette of
  // eight near-blacks, trim at #0a0a0a laid on a body at #161616. Every check
  // passed and the figure read as a plain black slab. Counting work is not the
  // same as measuring whether the work registers, so measure it — each detail
  // against the surface it is actually laid on, which means replaying a part's
  // details in order rather than comparing against the part colour, because the
  // eyes go on the face patch and not on the body.
  if (!opts.scene) {
    add('contrast', 'pass', 'Scene not supplied, paint contrast not measured');
  } else {
    const scene = opts.scene;
    const partById = new Map(scene.parts.map((q) => [q.id, q]));
    // Luminance-weighted RGB distance. The renderer shades a cube's three
    // visible faces across roughly 55-100% brightness, so a marking below that
    // spread is lost to shading before anyone reads it as a marking.
    // Not one threshold but one per surface. A marking has to beat the range
    // that surface already covers just from which way its faces point, and that
    // range scales with the surface: about 18 on a deep red, about 74 on
    // polished steel. A fixed 20 passed markings on light armour that were
    // simply invisible.
    const FLOOR = opts.profile?.minPaintContrast ?? 20;
    const thresholdFor = (hex: string): number => {
      const [r8, g8, b8] = rgbOf(hex);
      return contrastFloorFor(luminanceOf(r8, g8, b8), FLOOR);
    };
    const rgbOf = (hex: string): [number, number, number] => {
      const n = parseInt(hex.replace(/^#/, ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const distance = (a: string, b: string): number => {
      const [ar, ag, ab] = rgbOf(a);
      const [br, bg, bb] = rgbOf(b);
      const dr = ar - br;
      const dg = ag - bg;
      const db = ab - bb;
      return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
    };

    // Part-local surface colour, built up as details are replayed. A mirrored
    // twin shares its source's colours, so one pass per source part is enough.
    const surface = new Map<string, Map<string, string>>();
    const faint: Array<{ id: string; on: string; d: number }> = [];

    for (const detail of scene.details) {
      const part = partById.get(detail.part);
      if (!part) continue;
      const [psx, psy, psz] = part.size;
      const painted = surface.get(part.id) ?? new Map<string, string>();
      surface.set(part.id, painted);

      const [ax0, ay0, az0, ax1, ay1, az1] = detail.region;
      const x0 = Math.max(0, Math.min(ax0, ax1));
      const x1 = Math.min(psx - 1, Math.max(ax0, ax1));
      const y0 = Math.max(0, Math.min(ay0, ay1));
      const y1 = Math.min(psy - 1, Math.max(ay0, ay1));
      const z0 = Math.max(0, Math.min(az0, az1));
      const z1 = Math.min(psz - 1, Math.max(az0, az1));

      // How a marking reads is set by the surface it covers most of, so weight
      // by area rather than taking the best or worst single voxel.
      const beneath = new Map<string, number>();
      for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const key = `${x},${y},${z}`;
            const under = painted.get(key) ?? part.color;
            beneath.set(under, (beneath.get(under) ?? 0) + 1);
            painted.set(key, detail.color);
          }
        }
      }
      if (beneath.size === 0) continue;

      // How much of the marking disappears? Averaging the distance across the
      // region hid the failure it was meant to catch: hair painted #1c1c1c over
      // a #161616 head vanishes across three quarters of its area, but the
      // quarter that clips the face patch pulled the mean up and it scored as
      // fine. Judge a marking by the share of it that cannot be seen.
      let total = 0;
      let lost = 0;
      for (const [under, n] of beneath) {
        total += n;
        if (distance(detail.color, under) < thresholdFor(under)) lost += n;
      }
      const dominant = [...beneath.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const lostPct = total > 0 ? lost / total : 0;
      if (lostPct > 0.5) {
        faint.push({ id: detail.id ?? '(unnamed)', on: dominant, d: lostPct });
      }
    }

    const paintedCount = scene.details.length;
    // One deliberately subtle marking is fine; a palette with no range is not.
    const allowed = Math.max(1, Math.floor(paintedCount * 0.25));
    if (paintedCount === 0) {
      add('contrast', 'pass', 'No painted details to measure');
    } else if (faint.length <= allowed) {
      add(
        'contrast',
        'pass',
        `${paintedCount - faint.length} of ${paintedCount} painted regions read against their surface`,
      );
    } else {
      const worst = faint
        .sort((a, b) => b.d - a.d)
        .slice(0, 5)
        .map((f) => `${f.id} (${Math.round(f.d * 100)}% lost on ${f.on})`)
        .join(', ');
      add(
        'contrast',
        'warn',
        `${faint.length} of ${paintedCount} painted regions mostly disappear into ` +
          `the surface they are painted on (${worst}). How far apart two colours ` +
          `must be depends on the SURFACE: a marking on a near-black garment needs ` +
          `about 20, one on skin or polished steel needs 70 or more, because a lit ` +
          `surface already covers that much range on its own. Recolour the ones ` +
          `listed so each is clearly lighter than, or a clearly different hue from, ` +
          `what it sits on. Do not answer this by adding more detail.`,
      );
    }
  }

  // Is the body on the size ladder?
  //
  // Voxel count is to voxel art what pixel size is to pixel art, and models were
  // arriving at 12x24x14, 16x34x16, 18x35x12 — no two on the same scale, so no
  // two looked like they came from the same set. Unlike everything else in this
  // file this is not a matter of taste, it is a number, which is exactly why it
  // is worth checking rather than only asking for.
  if (!isCharacter || !rootPlaced || opts.requestedSize || !opts.profile || !opts.tiers) {
    add('size_ladder', 'pass', 'Ladder applies to characters with a free size and a style');
  } else {
    const s = rootPlaced.size;
    const exact = tierFor(opts.tiers, s);
    if (exact) {
      add('size_ladder', 'pass', `${s.join('x')} is the "${exact.label}" rung`);
    } else {
      const near = nearestTier(opts.tiers, s[1]);
      add(
        'size_ladder',
        'warn',
        `Body is ${s.join('x')}, which is not on the house size ladder. Use ` +
          `${near.size.join('x')} (the "${near.label}" rung) instead — every model is ` +
          `the base ${opts.profile.baseSize.join('x')} or a clean multiple of it, so two of ` +
          `them side by side belong to the same set. Width and depth must match.`,
      );
    }
  }

  // Does a flared garment read as cloth or as a plinth?
  //
  // A robe hangs from the shoulders and gathers weight downward, so it widens
  // from about the waist and reaches its widest at the hem. Sixteen generated
  // robes put ALL of their widening in the bottom sixth of the figure, in one
  // hard step, and every one of them read as a figure standing on a base.
  //
  // The step size matters as much as where it starts. A step exposes a TOP face,
  // which is the brightest surface the renderer produces; a width change of 2
  // leaves exactly one voxel of it, which is a single-voxel cluster of the
  // highest-contrast value on the model — an orphan pixel in the worst place.
  if (!isCharacter || !rootPlaced || !opts.profile) {
    add('flare', 'pass', 'Flare rules apply to characters with a style');
  } else {
    // Stop short of the head line for the same reason prism_fidelity does: the
    // prompt tells the model to sink a hat brim into the head, so the brim's
    // bottom row sits inside the body's own range and a 16-wide brim on a
    // 12-wide body looked exactly like a flare.
    const bodyRows = Math.max(1, Math.min(bodyTop - HEADWEAR_SINK, grid.sy));
    const widths: number[] = [];
    for (let y = 0; y < bodyRows; y++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let z = 0; z < grid.sz; z++) {
        for (let x = 0; x < grid.sx; x++) {
          if (grid.get(x, y, z) === 0) continue;
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
      }
      widths.push(hi < lo ? 0 : hi - lo + 1);
    }
    const filled = widths.filter((w) => w > 0);
    const torso = filled.length > 0 ? Math.min(...filled) : 0;
    const widest = filled.length > 0 ? Math.max(...filled) : 0;
    const startPct = opts.profile.flareStartPct;
    const minStep = opts.profile.minStepWidth;

    if (widest === torso) {
      add('flare', 'pass', 'Straight silhouette, no flare to judge');
    } else if (opts.profile.bodyFlare === 'none') {
      // Measured, not asserted: every stepped robe came out at aspect 0.49-0.59
      // and read as a barrel, while the straight figures sit at 0.40-0.44 and
      // read as people. The ladder's proportions have no width to spare, so the
      // garment is conveyed in paint.
      add(
        'flare',
        'warn',
        `The body widens ${torso} to ${widest} on its way down. This style does not ` +
          'build flared garments — the width pushes the silhouette out of proportion ' +
          'and it reads as a plinth or a barrel. Keep the body a straight prism and ' +
          'paint the robe instead: vertical bands of a darker and a lighter shade of ' +
          'the garment colour read as folds, with a darker band at the hem.',
      );
    } else {
      // The highest row still wider than the torso is where the drape begins.
      let begins = 0;
      for (let y = 0; y < bodyRows; y++) if (widths[y] > torso) begins = y;
      const beginsPct = Math.round(((begins + 1) / bodyRows) * 100);
      const rungs = [...new Set(filled)].sort((a, b) => a - b);
      const steps: number[] = [];
      for (let i = 1; i < rungs.length; i++) steps.push(rungs[i] - rungs[i - 1]);
      const meanStep = steps.length > 0 ? Math.min(...steps) : 0;

      const problems: string[] = [];
      if (beginsPct < startPct) {
        problems.push(
          `it only starts at ${beginsPct}% of the body height and should start at ` +
            `${startPct}% or higher — a garment widens from the waist, not from the ankles`,
        );
      }
      if (steps.length < 2) {
        problems.push(
          'it gets there in one step, and one step is a ledge — spread it over two ' +
            'or more so the silhouette slopes',
        );
      }
      if (meanStep > 0 && meanStep < minStep) {
        problems.push(
          `its narrowest step changes the width by ${meanStep}, under the ${minStep} ` +
            'minimum — a 2-voxel step leaves a one-voxel band of the brightest value ' +
            'on the model, which reads as a stray line rather than as form',
        );
      }

      if (problems.length === 0) {
        add(
          'flare',
          'pass',
          `Flare begins at ${beginsPct}% over ${steps.length} steps (${rungs.join(' to ')})`,
        );
      } else {
        add(
          'flare',
          'warn',
          `The silhouette widens ${rungs.join(' to ')} but ${problems.join('; and ')}.`,
        );
      }
    }
  }

  const maxAxis = Math.max(grid.sx, grid.sy, grid.sz);
  if (maxAxis <= 256) add('vox_limits', 'pass', `Largest axis ${maxAxis} fits the .vox 256 cap`);
  else add('vox_limits', 'fail', `Largest axis ${maxAxis} exceeds the .vox 256 cap`);

  const summary = {
    pass: checks.filter((c) => c.severity === 'pass').length,
    warn: checks.filter((c) => c.severity === 'warn').length,
    fail: checks.filter((c) => c.severity === 'fail').length,
  };

  return {
    checks,
    summary,
    metrics: {
      voxels,
      dimensions: [grid.sx, grid.sy, grid.sz],
      components: comp.count,
      largestComponent: comp.largest,
      floatingVoxels: comp.floating,
      symmetryPct: Number(sym.toFixed(1)),
      paletteSize: palette.size,
      occupancyPct: Number(((voxels / volume) * 100).toFixed(1)),
    },
  };
}

/** Compact text form — this is what an agent reads instead of raw voxels. */
export function formatReport(r: ValidationReport): string {
  const icon = (s: Severity) => (s === 'pass' ? 'PASS' : s === 'warn' ? 'WARN' : 'FAIL');
  const lines = [
    `PASS ${r.summary.pass}  WARN ${r.summary.warn}  FAIL ${r.summary.fail}`,
    `size ${r.metrics.dimensions.join('x')}  voxels ${r.metrics.voxels}  colors ${r.metrics.paletteSize}  symmetry ${r.metrics.symmetryPct}%`,
    '',
  ];
  for (const c of r.checks) {
    if (c.severity === 'pass') continue;
    lines.push(`${icon(c.severity)}  ${c.id}: ${c.message}`);
  }
  if (r.summary.warn === 0 && r.summary.fail === 0) lines.push('All structural checks passed.');
  return lines.join('\n');
}
