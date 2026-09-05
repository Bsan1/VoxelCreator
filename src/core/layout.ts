import type { Align, Anchor, Part, PlacedPart, Vec3, VoxelScene } from './types.js';

function alignOn(parentMin: number, parentSize: number, childSize: number, a: Align | undefined): number {
  switch (a ?? 'center') {
    case 'min': return parentMin;
    case 'max': return parentMin + parentSize - childSize;
    default: return parentMin + Math.floor((parentSize - childSize) / 2);
  }
}

/**
 * Position a child against a parent face. Anchoring rather than absolute
 * coordinates is what keeps parts attached through a revision: change the
 * torso height and the head, arms and legs follow instead of detaching.
 */
function anchorTo(parentPos: Vec3, parentSize: Vec3, childSize: Vec3, anchor: Anchor): Vec3 {
  const [px, py, pz] = parentPos;
  const [psx, psy, psz] = parentSize;
  const [csx, csy, csz] = childSize;
  let x: number, y: number, z: number;

  switch (anchor.to) {
    case 'top':
      y = py + psy;
      x = alignOn(px, psx, csx, anchor.alignX);
      z = alignOn(pz, psz, csz, anchor.alignZ);
      break;
    case 'bottom':
      y = py - csy;
      x = alignOn(px, psx, csx, anchor.alignX);
      z = alignOn(pz, psz, csz, anchor.alignZ);
      break;
    case 'right':
      x = px + psx;
      y = alignOn(py, psy, csy, anchor.alignY);
      z = alignOn(pz, psz, csz, anchor.alignZ);
      break;
    case 'left':
      x = px - csx;
      y = alignOn(py, psy, csy, anchor.alignY);
      z = alignOn(pz, psz, csz, anchor.alignZ);
      break;
    case 'front':
      z = pz + psz;
      x = alignOn(px, psx, csx, anchor.alignX);
      y = alignOn(py, psy, csy, anchor.alignY);
      break;
    case 'back':
      z = pz - csz;
      x = alignOn(px, psx, csx, anchor.alignX);
      y = alignOn(py, psy, csy, anchor.alignY);
      break;
    case 'center':
    default:
      x = alignOn(px, psx, csx, anchor.alignX);
      y = alignOn(py, psy, csy, anchor.alignY);
      z = alignOn(pz, psz, csz, anchor.alignZ);
      break;
  }
  return [x, y, z];
}

export interface LayoutResult {
  placed: PlacedPart[];
  /** Grid dimensions that exactly contain every part. */
  size: Vec3;
  /** Doubled X coordinate of the symmetry plane, in normalized grid space. */
  mirrorPlaneX2: number;
}

/**
 * Resolve every part to a world position. A part is placed once its
 * dependencies (parent, mirror source) are placed, so declaration order in the
 * scene file does not matter.
 */
export function layoutScene(scene: VoxelScene): LayoutResult {
  const byId = new Map<string, Part>();
  for (const p of scene.parts) {
    if (byId.has(p.id)) throw new Error(`Duplicate part id: ${p.id}`);
    byId.set(p.id, p);
  }
  const root = byId.get(scene.root);
  if (!root) throw new Error(`Root part not found: ${scene.root}`);
  if (root.parent) throw new Error(`Root part ${root.id} must not have a parent`);

  const sourceOf = (p: Part): Part => {
    let cur = p;
    const seen = new Set<string>([p.id]);
    while (cur.mirrorOf) {
      const src = byId.get(cur.mirrorOf);
      if (!src) throw new Error(`Part ${cur.id} mirrors unknown part ${cur.mirrorOf}`);
      if (seen.has(src.id)) throw new Error(`Mirror cycle at part ${cur.id}`);
      seen.add(src.id);
      cur = src;
    }
    return cur;
  };
  const effSize = (p: Part): Vec3 => [...sourceOf(p).size] as Vec3;

  const placed = new Map<string, PlacedPart>();
  placed.set(root.id, {
    part: root,
    size: effSize(root),
    pos: [0, 0, 0],
    mirrored: false,
    sourceId: root.id,
  });

  // The mirror plane sits at the root's X centre, kept in doubled coordinates
  // so reflection is exact integer arithmetic for odd and even widths alike.
  const planeX2 = effSize(root)[0];

  const pending = scene.parts.filter((p) => p.id !== root.id);
  let guard = pending.length + 1;
  while (pending.length > 0 && guard-- > 0) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      const size = effSize(p);

      if (p.mirrorOf) {
        const src = placed.get(p.mirrorOf);
        if (!src) continue;
        const pos: Vec3 = [planeX2 - src.pos[0] - size[0], src.pos[1], src.pos[2]];
        if (p.offset) {
          pos[0] += p.offset[0];
          pos[1] += p.offset[1];
          pos[2] += p.offset[2];
        }
        placed.set(p.id, {
          part: p,
          size,
          pos,
          mirrored: !src.mirrored,
          sourceId: sourceOf(p).id,
        });
        pending.splice(i, 1);
        continue;
      }

      if (!p.parent) throw new Error(`Part ${p.id} has no parent and is not the root`);
      if (!byId.has(p.parent)) throw new Error(`Part ${p.id} has unknown parent ${p.parent}`);
      const parent = placed.get(p.parent);
      if (!parent) continue;
      const pos = anchorTo(parent.pos, parent.size, size, p.anchor ?? { to: 'top' });
      if (p.offset) {
        pos[0] += p.offset[0];
        pos[1] += p.offset[1];
        pos[2] += p.offset[2];
      }
      placed.set(p.id, { part: p, size, pos, mirrored: false, sourceId: p.id });
      pending.splice(i, 1);
    }
  }
  if (pending.length > 0) {
    throw new Error(`Unresolvable part hierarchy (cycle?): ${pending.map((p) => p.id).join(', ')}`);
  }

  // Shift everything into a grid that starts at the origin.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const pp of placed.values()) {
    minX = Math.min(minX, pp.pos[0]);
    minY = Math.min(minY, pp.pos[1]);
    minZ = Math.min(minZ, pp.pos[2]);
    maxX = Math.max(maxX, pp.pos[0] + pp.size[0]);
    maxY = Math.max(maxY, pp.pos[1] + pp.size[1]);
    maxZ = Math.max(maxZ, pp.pos[2] + pp.size[2]);
  }
  const out: PlacedPart[] = [];
  for (const p of scene.parts) {
    const pp = placed.get(p.id)!;
    out.push({ ...pp, pos: [pp.pos[0] - minX, pp.pos[1] - minY, pp.pos[2] - minZ] });
  }

  return {
    placed: out,
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    mirrorPlaneX2: planeX2 - 2 * minX,
  };
}
