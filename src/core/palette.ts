import type { Hex } from './types.js';

export interface Rgba { r: number; g: number; b: number; a: number; }

export function parseHex(hex: Hex): Rgba {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) throw new Error(`Bad hex color: ${hex}`);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: 255,
  };
}

export function normalizeHex(hex: Hex): string {
  const { r, g, b } = parseHex(hex);
  const to = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Assigns palette slots 1-255 on demand. .vox stores one byte per voxel, so
 * 255 distinct colors is a hard ceiling — we surface that as an error rather
 * than silently dropping colors.
 */
export class Palette {
  private map = new Map<string, number>();
  private list: string[] = [];

  indexOf(hex: Hex): number {
    const key = normalizeHex(hex);
    const existing = this.map.get(key);
    if (existing !== undefined) return existing;
    if (this.list.length >= 255) {
      throw new Error(`Palette overflow: more than 255 distinct colors (adding ${key})`);
    }
    this.list.push(key);
    const idx = this.list.length; // 1-based
    this.map.set(key, idx);
    return idx;
  }

  get size(): number { return this.list.length; }

  colors(): string[] { return [...this.list]; }

  /** 256 RGBA entries; voxel index i maps to entry i-1 per the .vox spec. */
  toRgbaTable(): Rgba[] {
    const out: Rgba[] = [];
    for (const hex of this.list) out.push(parseHex(hex));
    while (out.length < 256) out.push({ r: 0, g: 0, b: 0, a: 0 });
    return out;
  }
}
