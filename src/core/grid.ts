import type { Vec3 } from './types.js';

/**
 * Dense voxel grid. 0 means empty; 1-255 index the palette.
 *
 * Dense beats sparse here: a 64^3 grid is 256KB, and every operation we care
 * about (rasterize, flood fill, symmetry compare, erosion) is a tight loop
 * over neighbours rather than a hash lookup.
 */
export class VoxelGrid {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly data: Uint8Array;

  constructor(sx: number, sy: number, sz: number) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.data = new Uint8Array(sx * sy * sz);
  }

  idx(x: number, y: number, z: number): number {
    return x + y * this.sx + z * this.sx * this.sy;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return 0;
    return this.data[this.idx(x, y, z)];
  }

  set(x: number, y: number, z: number, v: number): void {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.idx(x, y, z)] = v;
  }

  /** Only writes where a voxel already exists — used for painting details. */
  paint(x: number, y: number, z: number, v: number): void {
    if (!this.inBounds(x, y, z)) return;
    const i = this.idx(x, y, z);
    if (this.data[i] !== 0) this.data[i] = v;
  }

  count(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== 0) n++;
    return n;
  }

  /** Occupied bounding box, or null when empty. */
  bounds(): { min: Vec3; max: Vec3 } | null {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let z = 0; z < this.sz; z++) {
      for (let y = 0; y < this.sy; y++) {
        for (let x = 0; x < this.sx; x++) {
          if (this.data[this.idx(x, y, z)] === 0) continue;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        }
      }
    }
    if (minX === Infinity) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }

  /** Iterate occupied voxels. */
  forEach(fn: (x: number, y: number, z: number, v: number) => void): void {
    for (let z = 0; z < this.sz; z++) {
      for (let y = 0; y < this.sy; y++) {
        for (let x = 0; x < this.sx; x++) {
          const v = this.data[this.idx(x, y, z)];
          if (v !== 0) fn(x, y, z, v);
        }
      }
    }
  }
}
