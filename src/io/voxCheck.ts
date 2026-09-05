import { readFileSync } from 'node:fs';

/**
 * Minimal .vox reader used to verify our writer. Parses the chunk tree and
 * reports what a consumer like MagicaVoxel would see.
 */
export interface VoxCheck {
  version: number;
  size: [number, number, number];
  voxelCount: number;
  paletteEntries: number;
  usedIndices: number[];
  firstColors: string[];
}

export function checkVox(path: string): VoxCheck {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== 'VOX ') throw new Error(`Bad magic: ${JSON.stringify(magic)}`);
  const version = dv.getInt32(4, true);

  let size: [number, number, number] = [0, 0, 0];
  let voxelCount = 0;
  const usedIndices = new Set<number>();
  let paletteEntries = 0;
  const firstColors: string[] = [];

  // Walk chunks; MAIN has no content, so its children follow immediately.
  let off = 8;
  const end = buf.length;
  while (off + 12 <= end) {
    const id = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
    const contentSize = dv.getInt32(off + 4, true);
    const childrenSize = dv.getInt32(off + 8, true);
    const content = off + 12;

    if (id === 'MAIN') {
      if (contentSize !== 0) throw new Error('MAIN should have no content');
      if (content + childrenSize !== end) {
        throw new Error(`MAIN children size ${childrenSize} does not reach EOF`);
      }
      off = content; // descend
      continue;
    }
    if (id === 'SIZE') {
      size = [
        dv.getInt32(content, true),
        dv.getInt32(content + 4, true),
        dv.getInt32(content + 8, true),
      ];
    } else if (id === 'XYZI') {
      voxelCount = dv.getInt32(content, true);
      if (contentSize !== 4 + voxelCount * 4) {
        throw new Error(`XYZI size mismatch: ${contentSize} vs ${4 + voxelCount * 4}`);
      }
      for (let i = 0; i < voxelCount; i++) {
        const b = content + 4 + i * 4;
        const [x, y, z, ci] = [buf[b], buf[b + 1], buf[b + 2], buf[b + 3]];
        if (ci === 0) throw new Error(`Voxel ${i} uses reserved colour index 0`);
        if (x >= size[0] || y >= size[1] || z >= size[2]) {
          throw new Error(`Voxel ${i} at (${x},${y},${z}) is outside SIZE ${size.join('x')}`);
        }
        usedIndices.add(ci);
      }
    } else if (id === 'RGBA') {
      if (contentSize !== 1024) throw new Error(`RGBA must be 1024 bytes, got ${contentSize}`);
      paletteEntries = 256;
      for (let i = 0; i < 8; i++) {
        const b = content + i * 4;
        const hex = [buf[b], buf[b + 1], buf[b + 2]]
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('');
        firstColors.push(`#${hex}`);
      }
    }
    off = content + contentSize + childrenSize;
  }

  return {
    version,
    size,
    voxelCount,
    paletteEntries,
    usedIndices: [...usedIndices].sort((a, b) => a - b),
    firstColors,
  };
}

if (process.argv[2]) {
  const r = checkVox(process.argv[2]);
  console.log(`version:        ${r.version}`);
  console.log(`size (vox XYZ): ${r.size.join(' x ')}   [Z is up in .vox]`);
  console.log(`voxels:         ${r.voxelCount}`);
  console.log(`palette:        ${r.paletteEntries} entries`);
  console.log(`used indices:   ${r.usedIndices.join(', ')}`);
  console.log(`first colors:   ${r.firstColors.join(' ')}`);
  console.log('\nOK: chunk tree, bounds, and palette indices all valid.');
}
