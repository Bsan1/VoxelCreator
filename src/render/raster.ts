import { shadeFor } from '../core/shading.js';
import type { VoxelGrid } from '../core/grid.js';
import type { Palette } from '../core/palette.js';
import { parseHex } from '../core/palette.js';
import { encodePng } from './png.js';

/**
 * Orthographic voxel renderer, in software.
 *
 * The generator needs to SEE what it built — every quality failure so far was
 * obvious on sight and invisible in JSON. A ray per pixel stepped through the
 * grid is fast enough at these sizes (a 40^3 model at 320px is a few million
 * steps) and needs no GPU, no browser and no native module.
 */

export type ViewName = 'front' | 'three_quarter' | 'side';

interface View {
  /** Direction the camera looks along, in grid space. */
  dir: [number, number, number];
  up: [number, number, number];
}

const VIEWS: Record<ViewName, View> = {
  front: { dir: [0, 0, -1], up: [0, 1, 0] },
  three_quarter: { dir: [-0.75, -0.45, -1], up: [0, 1, 0] },
  side: { dir: [-1, 0, 0], up: [0, 1, 0] },
};

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Step a ray through the grid, returning the first solid voxel and the face it
 * was entered through. Standard Amanatides-Woo traversal.
 */
function trace(
  grid: VoxelGrid,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
): { v: number; nx: number; ny: number; nz: number } | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tdX = Math.abs(1 / (dx || 1e-9));
  const tdY = Math.abs(1 / (dy || 1e-9));
  const tdZ = Math.abs(1 / (dz || 1e-9));
  let tmX = ((dx > 0 ? x + 1 - ox : ox - x) || 1e-9) * tdX;
  let tmY = ((dy > 0 ? y + 1 - oy : oy - y) || 1e-9) * tdY;
  let tmZ = ((dz > 0 ? z + 1 - oz : oz - z) || 1e-9) * tdZ;

  let nx = 0, ny = 0, nz = 0;
  const limit = (grid.sx + grid.sy + grid.sz) * 3;
  for (let i = 0; i < limit; i++) {
    if (grid.inBounds(x, y, z)) {
      const v = grid.get(x, y, z);
      if (v !== 0) return { v, nx, ny, nz };
    }
    if (tmX < tmY && tmX < tmZ) {
      x += stepX; tmX += tdX; nx = -stepX; ny = 0; nz = 0;
    } else if (tmY < tmZ) {
      y += stepY; tmY += tdY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; tmZ += tdZ; nx = 0; ny = 0; nz = -stepZ;
    }
    // Once past the far side there is nothing left to hit.
    if (
      (stepX > 0 ? x > grid.sx : x < -1) ||
      (stepY > 0 ? y > grid.sy : y < -1) ||
      (stepZ > 0 ? z > grid.sz : z < -1)
    ) {
      break;
    }
  }
  return null;
}

export interface RenderOptions {
  size?: number;
  view?: ViewName;
  /** Background, as RGB. Defaults to whichever of light/dark the model is not. */
  bg?: [number, number, number];
}

/**
 * Pick a background the model can be seen against.
 *
 * A fixed dark background made a near-black figure vanish into it: the render
 * showed a face and a collar floating in the void, and the visual pass reads
 * these renders, so it was being asked to critique an image where most of the
 * model was invisible. Contrast against the palette instead.
 */
function backdropFor(colours: Array<{ r: number; g: number; b: number }>): [number, number, number] {
  if (colours.length === 0) return [18, 20, 24];
  let sum = 0;
  for (const c of colours) sum += 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const mean = sum / colours.length;
  // Mid greys either side of the middle, so neither end of a palette is lost.
  return mean < 128 ? [176, 178, 184] : [40, 42, 48];
}

/** Raw RGBA for one view. Both the single render and the sheet build on this. */
function renderRgba(grid: VoxelGrid, palette: Palette, opts: RenderOptions = {}): Uint8Array {
  const size = opts.size ?? 320;
  const view = VIEWS[opts.view ?? 'three_quarter'];

  const colours = palette.colors().map(parseHex);
  const bg = opts.bg ?? backdropFor(colours);
  const forward = norm(view.dir);
  const right = norm(cross(forward, view.up));
  const up = norm(cross(right, forward));

  // Frame the whole model whatever the angle, with a small margin.
  const centre = [grid.sx / 2, grid.sy / 2, grid.sz / 2];
  const extent = Math.hypot(grid.sx, grid.sy, grid.sz) * 0.5;
  const scale = (2 * extent * 1.08) / size;
  const back = extent * 2;

  const out = new Uint8Array(size * size * 4);
  // Lambert from over the viewer's shoulder, plus a floor bounce, so the three
  // cube faces read as distinct values.
  // Lighting lives in core/shading.ts: the validator measures its contrast
  // rules against this exact model, so the two cannot be allowed to drift apart.

  for (let py = 0; py < size; py++) {
    const sy = (size / 2 - py - 0.5) * scale;
    for (let px = 0; px < size; px++) {
      const sx = (px + 0.5 - size / 2) * scale;
      const ox = centre[0] + right[0] * sx + up[0] * sy - forward[0] * back;
      const oy = centre[1] + right[1] * sx + up[1] * sy - forward[1] * back;
      const oz = centre[2] + right[2] * sx + up[2] * sy - forward[2] * back;

      const hit = trace(grid, ox, oy, oz, forward[0], forward[1], forward[2]);
      const i = (py * size + px) * 4;
      if (!hit) {
        out[i] = bg[0]; out[i + 1] = bg[1]; out[i + 2] = bg[2]; out[i + 3] = 255;
        continue;
      }
      const c = colours[hit.v - 1] ?? { r: 255, g: 0, b: 255, a: 255 };
      const shade = shadeFor(hit.nx, hit.ny, hit.nz);
      out[i] = Math.min(255, Math.round(c.r * shade));
      out[i + 1] = Math.min(255, Math.round(c.g * shade));
      out[i + 2] = Math.min(255, Math.round(c.b * shade));
      out[i + 3] = 255;
    }
  }
  return out;
}

export function renderView(
  grid: VoxelGrid,
  palette: Palette,
  opts: RenderOptions = {},
): Uint8Array {
  const size = opts.size ?? 320;
  return encodePng(size, size, renderRgba(grid, palette, opts));
}

/** Front and three-quarter side by side, which is enough to judge a figure. */
export function renderSheet(grid: VoxelGrid, palette: Palette, size = 320): Uint8Array {
  const views: ViewName[] = ['front', 'three_quarter'];
  const tiles = views.map((view) => renderRgba(grid, palette, { size, view }));
  const w = size * tiles.length;
  const sheet = new Uint8Array(w * size * 4);
  tiles.forEach((tile, t) => {
    for (let y = 0; y < size; y++) {
      const src = y * size * 4;
      const dst = (y * w + t * size) * 4;
      sheet.set(tile.subarray(src, src + size * 4), dst);
    }
  });
  return encodePng(w, size, sheet);
}

/**
 * A 3x5 bitmap digit, so a contact sheet can number its tiles.
 *
 * Comparing four variants is useless if you cannot say which one you meant, and
 * dragging in a font for ten glyphs would be worse than drawing them.
 */
const DIGITS: readonly string[][] = [
  ['111', '101', '101', '101', '111'],
  ['010', '110', '010', '010', '111'],
  ['111', '001', '111', '100', '111'],
  ['111', '001', '111', '001', '111'],
  ['101', '101', '111', '001', '001'],
  ['111', '100', '111', '001', '111'],
  ['111', '100', '111', '101', '111'],
  ['111', '001', '001', '001', '001'],
  ['111', '101', '111', '101', '111'],
  ['111', '101', '111', '001', '111'],
];

function stampNumber(
  buf: Uint8Array,
  bufW: number,
  x0: number,
  y0: number,
  value: number,
  scale: number,
  rgb: [number, number, number],
): void {
  const glyphs = String(value).split('').map((c) => DIGITS[Number(c)]);
  let cursor = x0;
  for (const glyph of glyphs) {
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy][gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = cursor + gx * scale + sx;
            const py = y0 + gy * scale + sy;
            const i = (py * bufW + px) * 4;
            if (i < 0 || i + 3 >= buf.length) continue;
            buf[i] = rgb[0];
            buf[i + 1] = rgb[1];
            buf[i + 2] = rgb[2];
            buf[i + 3] = 255;
          }
        }
      }
    }
    cursor += 4 * scale;
  }
}

export interface ContactEntry {
  grid: VoxelGrid;
  palette: Palette;
}

/**
 * Several models on one page, numbered, for choosing between variants.
 *
 * Settling a style by describing the options does not work — it was tried twice
 * and did not land either time. Rendering four versions of the same thing with
 * one setting changed and pointing at the one that is right does work, and this
 * is the tool for it.
 *
 * Every tile is framed independently, so a model that is genuinely bigger does
 * not shrink the others; the comparison is about shape and paint, not scale.
 */
export function renderContactSheet(
  entries: ContactEntry[],
  opts: { size?: number; cols?: number; view?: ViewName } = {},
): Uint8Array {
  const size = opts.size ?? 300;
  const cols = Math.max(1, opts.cols ?? Math.min(entries.length, 4));
  const rows = Math.ceil(entries.length / cols);
  const w = size * cols;
  const h = size * rows;
  const sheet = new Uint8Array(w * h * 4);

  // A neutral page, so tiles with different backdrops still sit on one ground.
  for (let i = 0; i < w * h; i++) {
    sheet[i * 4] = 150;
    sheet[i * 4 + 1] = 152;
    sheet[i * 4 + 2] = 158;
    sheet[i * 4 + 3] = 255;
  }

  entries.forEach((entry, index) => {
    const tile = renderRgba(entry.grid, entry.palette, {
      size,
      view: opts.view ?? 'three_quarter',
    });
    const cx = (index % cols) * size;
    const cy = Math.floor(index / cols) * size;
    for (let y = 0; y < size; y++) {
      const src = y * size * 4;
      const dst = ((cy + y) * w + cx) * 4;
      sheet.set(tile.subarray(src, src + size * 4), dst);
    }
    stampNumber(sheet, w, cx + 10, cy + 10, index + 1, 3, [20, 20, 24]);
  });

  return encodePng(w, h, sheet);
}
