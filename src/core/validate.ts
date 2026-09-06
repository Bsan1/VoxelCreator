import type { VoxelGrid } from './grid.js';
import type { BuildResult } from './build.js';
import type { SceneKind } from './types.js';

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
  for (const p of build.layout.placed) {
    const centreY = p.pos[1] + p.size[1] / 2;
    if (centreY >= bodyTop) continue; // headwear
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

  const PRISM_MIN_PCT = opts.prismMinPct ?? 60;
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

  // A tall narrow block reads as a monument, not a character. Voxel figures
  // need to be chunky — this is the proportion failure that no amount of
  // painted detail can rescue.
  const MIN_ASPECT = 0.4;
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
