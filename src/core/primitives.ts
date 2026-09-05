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
