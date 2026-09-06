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
 * Tapers from the full footprint at the bottom to a point at the top.
 *
 * `round` gives a cone, otherwise a pyramid. Without this a pointed hat had to
 * be faked with a stack of shrinking boxes, and models usually gave up and
 * emitted a plain column instead.
 */
export function fillCone(
  grid: VoxelGrid,
  pos: Vec3,
  size: Vec3,
  color: number,
  round = true,
): void {
  const [px, py, pz] = pos;
  const [sx, sy, sz] = size;
  for (let y = 0; y < sy; y++) {
    // 1 at the base, approaching 0 at the tip. Never fully 0, so the apex
    // keeps a voxel instead of vanishing.
    const t = 1 - (y + 0.5) / sy;
    const halfX = Math.max(0.5, (sx / 2) * t);
    const halfZ = Math.max(0.5, (sz / 2) * t);
    const cx = sx / 2, cz = sz / 2;
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const dx = (x + 0.5 - cx) / halfX;
        const dz = (z + 0.5 - cz) / halfZ;
        const inside = round ? dx * dx + dz * dz <= 1 : Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
        if (inside) grid.set(px + x, py + y, pz + z, color);
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
): void {
  switch (shape) {
    case 'sphere': return fillSphere(grid, pos, size, color);
    case 'cylinder': return fillCylinder(grid, pos, size, color);
    case 'cone': return fillCone(grid, pos, size, color, true);
    case 'pyramid': return fillCone(grid, pos, size, color, false);
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
