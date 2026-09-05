import { VoxelGrid } from './grid.js';
import { Palette } from './palette.js';
import { fillShape, hollowRegion } from './primitives.js';
import { layoutScene, type LayoutResult } from './layout.js';
import type { Detail, PlacedPart, VoxelScene } from './types.js';

export interface BuildResult {
  grid: VoxelGrid;
  palette: Palette;
  layout: LayoutResult;
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
export function buildScene(scene: VoxelScene): BuildResult {
  const layout = layoutScene(scene);
  const [gx, gy, gz] = layout.size;
  if (gx <= 0 || gy <= 0 || gz <= 0) {
    throw new Error(`Scene "${scene.name}" produced an empty grid`);
  }
  const grid = new VoxelGrid(gx, gy, gz);
  const palette = new Palette();

  const byId = new Map(scene.parts.map((p) => [p.id, p]));

  for (const pp of layout.placed) {
    const source = byId.get(pp.sourceId)!;
    const colorIdx = palette.indexOf(source.color);
    fillShape(grid, source.shape ?? 'box', pp.pos, pp.size, colorIdx);
    if (source.hollow) hollowRegion(grid, pp.pos, pp.size);
  }

  for (const detail of scene.details) {
    if (!byId.has(detail.part)) {
      throw new Error(`Detail targets unknown part: ${detail.part}`);
    }
    const colorIdx = palette.indexOf(detail.color);
    // Applies to the named part and to any part mirroring it, so a detail
    // defined once on the right boot also lands on the left.
    for (const pp of layout.placed) {
      if (pp.sourceId !== detail.part) continue;
      applyRegion(grid, pp, detail.region, colorIdx, pp.mirrored);
      if (detail.mirror) applyRegion(grid, pp, detail.region, colorIdx, !pp.mirrored);
    }
  }

  return { grid, palette, layout };
}
