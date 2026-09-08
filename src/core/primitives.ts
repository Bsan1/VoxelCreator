import { DEFAULT_TAPER, type TaperRule } from './style.js';
import { VoxelGrid } from './grid.js';
import type { ShapeKind, Vec3 } from './types.js';

/** Fill an axis-aligned box. pos is the min corner, size the extent. */
export function fillBox(grid: VoxelGrid, pos: Vec3, size: Vec3, color: number): void {
  const [px, py, pz] = pos;
  const [sx, sy, sz] = size;
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        grid.set(px + x, py + y, pz + z, color);
      }
    }
  }
}

/** Ellipsoid inscribed in the box, so callers place every shape the same way. */
export function fillSphere(grid: VoxelGrid, pos: Vec3, size: Vec3, color: number): void {
  const [px, py, pz] = pos;
  const [sx, sy, sz] = size;
  const rx = sx / 2, ry = sy / 2, rz = sz / 2;
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        // Sample voxel centres so odd and even sizes both stay symmetric.
        const dx = (x + 0.5 - rx) / rx;
        const dy = (y + 0.5 - ry) / ry;
        const dz = (z + 0.5 - rz) / rz;
        if (dx * dx + dy * dy + dz * dz <= 1) grid.set(px + x, py + y, pz + z, color);
      }
    }
  }
}

/** Cylinder inscribed in the box, running along +Y. */
export function fillCylinder(grid: VoxelGrid, pos: Vec3, size: Vec3, color: number): void {
  const [px, py, pz] = pos;
  const [sx, sy, sz] = size;
  const rx = sx / 2, rz = sz / 2;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const dx = (x + 0.5 - rx) / rx;
      const dz = (z + 0.5 - rz) / rz;
      if (dx * dx + dz * dz > 1) continue;
      for (let y = 0; y < sy; y++) grid.set(px + x, py + y, pz + z, color);
    }
  }
}

/**
 * A tapering stack of layers — a hat, a crown, a roof.
 *
 * The obvious implementation, an ellipse test per layer against a continuously
 * shrinking radius, is wrong for voxel art and looked it. On a 12x8x12 wizard
 * hat it produced layer widths 16, 10, 8, 6, 6, 4, 2 — steps of 6, 2, 2, 0, 2,
 * 2 — and each layer was a fresh circle rasterisation, so two layers of the
 * same width had different corners bitten out of them. Pixel art calls this a
 * jaggie: every step in a staircase has to follow a rule, and there was no rule
 * here. The notches read as dirt on the silhouette.
 *
 * So the taper is a deliberate ladder instead: a constant number of layers per
 * step, and a constant width lost at each step, both derived so the ladder
 * reaches the tip exactly. Rounding is a fixed one-voxel chamfer applied at the
 * same width everywhere, not a per-layer rasterisation — the same corner
 * treatment on every layer of the same width is what stops the noise.
 */
export function fillCone(
  grid: VoxelGrid,
  pos: Vec3,
  size: Vec3,
  color: number,
  round = true,
  taper: TaperRule = DEFAULT_TAPER,
): void {
  const [px, py, pz] = pos;
  const [sx, sy, sz] = size;
  if (sx <= 0 || sy <= 0 || sz <= 0) return;

  // The tip keeps 2 voxels where there is room for it: a single-voxel apex is
  // an orphan pixel, which is the other half of the same problem.
  const tip = Math.min(sx, sz) >= 4 ? taper.tip : 1;
  const span = Math.max(sx, sz) - tip;

  // Two layers per step is the shortest step that still reads as a step. The
  // ladder is then capped so it never asks for more steps than the width can
  // pay for.
  const maxSteps = Math.max(1, Math.floor(span / taper.shrink));
  const steps = Math.max(1, Math.min(Math.floor(sy / taper.stepHeight) || 1, maxSteps));
  const perStep = sy / steps;
  // Even, so the shrink stays symmetric about the centre line. The profile asks
  // for a step width; it is widened only when the ladder could not reach the tip.
  const shrink =
    span <= 0 ? 0 : Math.max(taper.shrink, 2 * Math.ceil(span / (2 * steps)));

  for (let y = 0; y < sy; y++) {
    const step = Math.min(steps - 1, Math.floor(y / perStep));
    const w = Math.max(tip, sx - shrink * step);
    const d = Math.max(tip, sz - shrink * step);
    const x0 = Math.floor((sx - w) / 2);
    const z0 = Math.floor((sz - d) / 2);
    // One voxel off each corner, and only once the layer is wide enough that
    // losing a corner still leaves a face. Applied by width, so every layer of
    // a given width is chamfered identically.
    const chamfer = round && w >= 6 && d >= 6 ? taper.chamfer : 0;

    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        if (chamfer) {
          const nearX = Math.min(x, w - 1 - x);
          const nearZ = Math.min(z, d - 1 - z);
          if (nearX + nearZ < chamfer) continue;
        }
        grid.set(px + x0 + x, py + y, pz + z0 + z, color);
      }
    }
  }
}

export function fillShape(
  grid: VoxelGrid,
  shape: ShapeKind,
  pos: Vec3,
  size: Vec3,
  color: number,
  taper: TaperRule = DEFAULT_TAPER,
): void {
  switch (shape) {
    case 'sphere': return fillSphere(grid, pos, size, color);
    case 'cylinder': return fillCylinder(grid, pos, size, color);
    case 'cone': return fillCone(grid, pos, size, color, true, taper);
    case 'pyramid': return fillCone(grid, pos, size, color, false, taper);
    default: return fillBox(grid, pos, size, color);
  }
}

/** Clear interior voxels of a region, leaving a one-voxel shell. */
export function hollowRegion(grid: VoxelGrid, pos: Vec3, size: Vec3): void {
  const [px, py, pz] = pos;
  const [sx, sy, sz] = size;
  if (sx < 3 || sy < 3 || sz < 3) return;
  for (let z = 1; z < sz - 1; z++) {
    for (let y = 1; y < sy - 1; y++) {
      for (let x = 1; x < sx - 1; x++) {
        grid.set(px + x, py + y, pz + z, 0);
      }
    }
  }
}
