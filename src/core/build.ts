import { DEFAULT_TAPER, type TaperRule } from './style.js';
import { VoxelGrid } from './grid.js';
import { fillShape, hollowRegion } from './primitives.js';
import { layoutScene, type LayoutResult } from './layout.js';
import { normalizeHex, Palette } from './palette.js';
import type { Detail, PlacedPart, VoxelScene } from './types.js';

export interface BuildResult {
  grid: VoxelGrid;
  palette: Palette;
  layout: LayoutResult;
  /**
   * How far the built content was pushed to make room for outward hand edits.
   * Grid coordinate minus this is the layout coordinate an edit is stored in.
   */
  shift: [number, number, number];
}

/**
 * Paint a part-local region onto the grid. Only existing voxels are touched,
 * so a detail can never add floating geometry outside its part.
 */
function applyRegion(
  grid: VoxelGrid,
  pp: PlacedPart,
  region: Detail['region'],
  colorIdx: number,
  flipX: boolean,
): void {
  const [ax0, ay0, az0, ax1, ay1, az1] = region;
  const x0 = Math.min(ax0, ax1), x1 = Math.max(ax0, ax1);
  const y0 = Math.min(ay0, ay1), y1 = Math.max(ay0, ay1);
  const z0 = Math.min(az0, az1), z1 = Math.max(az0, az1);
  const [sx, sy, sz] = pp.size;

  for (let z = z0; z <= z1; z++) {
    if (z < 0 || z >= sz) continue;
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= sy) continue;
      for (let x = x0; x <= x1; x++) {
        const lx = flipX ? sx - 1 - x : x;
        if (lx < 0 || lx >= sx) continue;
        grid.paint(pp.pos[0] + lx, pp.pos[1] + y, pp.pos[2] + z, colorIdx);
      }
    }
  }
}

/**
 * Deterministic scene -> voxels. Same scene in, same grid out: revisions edit
 * the scene and rebuild rather than mutating voxels in place.
 */
/**
 * The taper every build uses unless one is passed in.
 *
 * There are twenty-odd call sites for buildScene — the viewer, the renderer,
 * every CLI, every MCP tool — and threading a style through all of them would
 * leave some of them wired and some not, which is precisely the half-applied
 * style that makes output inconsistent. The style registry sets this once when
 * it loads instead, so a profile swap reaches every build at the same moment.
 */
let ambientTaper: TaperRule = DEFAULT_TAPER;

/** Called by the style registry on load. Not for per-build overrides. */
export function setAmbientTaper(taper: TaperRule): void {
  ambientTaper = taper;
}

export function buildScene(
  scene: VoxelScene,
  opts: { taper?: TaperRule } = {},
): BuildResult {
  const layout = layoutScene(scene);
  const [gx, gy, gz] = layout.size;
  if (gx <= 0 || gy <= 0 || gz <= 0) {
    throw new Error(`Scene "${scene.name}" produced an empty grid`);
  }

  // Hand-added voxels may sit outside the parts' own box — a nose, an ear.
  // Their coordinates are stored in layout space, so the grid grows and the
  // built content shifts to make room, and the stored numbers stay valid when
  // the model is later resized.
  let padX = 0, padY = 0, padZ = 0;
  let extX = gx, extY = gy, extZ = gz;
  for (const [x, y, z] of scene.edits?.added ?? []) {
    padX = Math.max(padX, -x);
    padY = Math.max(padY, -y);
    padZ = Math.max(padZ, -z);
    extX = Math.max(extX, x + 1);
    extY = Math.max(extY, y + 1);
    extZ = Math.max(extZ, z + 1);
  }
  const shift: [number, number, number] = [padX, padY, padZ];
  const grid = new VoxelGrid(extX + padX, extY + padY, extZ + padZ);
  const palette = new Palette();

  const byId = new Map(scene.parts.map((p) => [p.id, p]));

  const shifted = layout.placed.map((pp) => ({
    ...pp,
    pos: [pp.pos[0] + shift[0], pp.pos[1] + shift[1], pp.pos[2] + shift[2]] as [number, number, number],
  }));

  for (const pp of shifted) {
    const source = byId.get(pp.sourceId)!;
    const colorIdx = palette.indexOf(source.color);
    fillShape(grid, source.shape ?? 'box', pp.pos, pp.size, colorIdx, opts.taper ?? ambientTaper);
    if (source.hollow) hollowRegion(grid, pp.pos, pp.size);
  }

  for (const detail of scene.details) {
    if (!byId.has(detail.part)) {
      throw new Error(`Detail targets unknown part: ${detail.part}`);
    }
    const colorIdx = palette.indexOf(detail.color);
    // Applies to the named part and to any part mirroring it, so a detail
    // defined once on the right boot also lands on the left.
    for (const pp of shifted) {
      if (pp.sourceId !== detail.part) continue;
      applyRegion(grid, pp, detail.region, colorIdx, pp.mirrored);
      if (detail.mirror) applyRegion(grid, pp, detail.region, colorIdx, !pp.mirrored);
    }
  }

  // Hand edits go on last, so they win over anything the parts painted.
  if (scene.edits) {
    for (const [x, y, z, hex] of scene.edits.added) {
      grid.set(x + shift[0], y + shift[1], z + shift[2], palette.indexOf(normalizeHex(hex)));
    }
    for (const [x, y, z] of scene.edits.removed) {
      grid.set(x + shift[0], y + shift[1], z + shift[2], 0);
    }
  }

  return { grid, palette, layout: { ...layout, placed: shifted }, shift };
}
