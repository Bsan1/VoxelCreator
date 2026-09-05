import type { VoxelGrid } from '../core/grid.js';
import type { Palette } from '../core/palette.js';

/**
 * MagicaVoxel .vox writer (version 150, single model).
 *
 * Layout: "VOX " + version, then a MAIN chunk whose children are SIZE, XYZI
 * and RGBA. Every chunk is id(4) + contentBytes(int32) + childBytes(int32).
 * Voxel coordinates are one byte each, which caps a model at 256^3.
 *
 * Two details the spec is easy to trip over:
 *  - .vox is Z-up while we work Y-up, so (x, y, z) is written as (x, z, y).
 *  - voxel colour index i refers to RGBA entry i-1, so palette slot 1 is the
 *    first entry in the table.
 */

const MAX_DIM = 256;

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private len = 0;

  bytes(b: Uint8Array): void {
    this.chunks.push(b);
    this.len += b.length;
  }

  ascii(s: string): void {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    this.bytes(b);
  }

  int32(n: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, n, true);
    this.bytes(b);
  }

  get length(): number { return this.len; }

  concat(): Uint8Array {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

function chunk(id: string, content: Uint8Array, children: Uint8Array = new Uint8Array(0)): Uint8Array {
  const w = new ByteWriter();
  w.ascii(id);
  w.int32(content.length);
  w.int32(children.length);
  w.bytes(content);
  w.bytes(children);
  return w.concat();
}

export function writeVox(grid: VoxelGrid, palette: Palette): Uint8Array {
  // .vox axes: x stays, our Y (up) becomes vox Z, our Z (depth) becomes vox Y.
  const vx = grid.sx, vy = grid.sz, vz = grid.sy;
  if (vx > MAX_DIM || vy > MAX_DIM || vz > MAX_DIM) {
    throw new Error(
      `Model is ${grid.sx}x${grid.sy}x${grid.sz}; .vox caps each axis at ${MAX_DIM}`,
    );
  }

  const sizeW = new ByteWriter();
  sizeW.int32(vx);
  sizeW.int32(vy);
  sizeW.int32(vz);
  const sizeChunk = chunk('SIZE', sizeW.concat());

  const voxels: number[] = [];
  let count = 0;
  grid.forEach((x, y, z, v) => {
    voxels.push(x & 0xff, z & 0xff, y & 0xff, v & 0xff);
    count++;
  });
  if (count === 0) throw new Error('Refusing to write an empty .vox model');

  const xyziW = new ByteWriter();
  xyziW.int32(count);
  xyziW.bytes(Uint8Array.from(voxels));
  const xyziChunk = chunk('XYZI', xyziW.concat());

  const rgbaW = new ByteWriter();
  for (const c of palette.toRgbaTable()) {
    rgbaW.bytes(Uint8Array.from([c.r, c.g, c.b, c.a]));
  }
  const rgbaChunk = chunk('RGBA', rgbaW.concat());

  const childrenW = new ByteWriter();
  childrenW.bytes(sizeChunk);
  childrenW.bytes(xyziChunk);
  childrenW.bytes(rgbaChunk);
  const main = chunk('MAIN', new Uint8Array(0), childrenW.concat());

  const out = new ByteWriter();
  out.ascii('VOX ');
  out.int32(150);
  out.bytes(main);
  return out.concat();
}
