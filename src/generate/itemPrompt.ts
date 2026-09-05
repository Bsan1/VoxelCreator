import { buildScene } from '../core/build.js';
import { socketsFor } from '../core/compose.js';
import type { VoxelScene } from '../core/types.js';

/**
 * Equipment is generated as its own model, then attached to a character at a
 * socket. Handing the generator the character it is being made for is the
 * whole point: an item built blind ends up the wrong scale and the wrong
 * palette, and looks like it came from a different game once equipped.
 */
export function describeCharacter(character: VoxelScene): string {
  const { grid, palette } = buildScene(character);

  // Order colours by how much of the character each one covers, so the shades
  // that define the look lead.
  const counts = new Map<number, number>();
  grid.forEach((_x, _y, _z, v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const colors = palette.colors();
  const ordered = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([idx]) => colors[idx - 1])
    .filter(Boolean);

  const sockets = socketsFor(character).map((s) => s.id).join(', ');

  return `=== THE CHARACTER THIS IS FOR: "${character.name}" ===

It is ${grid.sx} wide, ${grid.sy} tall and ${grid.sz} deep in voxels.

Its palette, ordered by how much of it each colour covers:
  ${ordered.join('  ')}

Build the item so it belongs to this character:

SCALE. Size it against those numbers, not in the abstract. A one-handed weapon
runs about half to two thirds the character's height (${Math.round(grid.sy * 0.5)}-${Math.round(grid.sy * 0.66)} voxels).
A shield covers roughly the chest, about ${Math.round(grid.sx * 0.7)} wide and ${Math.round(grid.sy * 0.4)} tall.
A hat or helmet matches the character's width, about ${grid.sx} voxels across.
Depth should stay near ${Math.max(2, Math.round(grid.sz * 0.4))}-${grid.sz}, so the item does not look
like a cardboard cut-out next to a chunky figure.

PALETTE. Take the metal, leather and trim colours from the list above. Add at
most 2 new colours, for what genuinely makes this item its own thing — a blade
sheen, a gemstone, a banner colour.

It exposes these mounting points: ${sockets}`;
}

/** The item-specific instruction. Characters and items are judged differently. */
export function buildItemPrompt(userPrompt: string, characterBlock?: string): string {
  return `You are a voxel artist. Turn the request below into ONE JSON object describing a piece of EQUIPMENT — an item a character carries or wears, not a character.

Output ONLY the JSON object. No prose, no explanation, no code fence.

REQUEST: ${userPrompt}
${characterBlock ? `\n${characterBlock}\n` : ''}
=== HOW ITEMS DIFFER FROM CHARACTERS ===

A character must read as one standing prism. An item does not: a sword is a
long slab, a shield is a broad flat panel, an axe is a shaft with a head. Build
the real shape of the object.

What still holds:
  - Chunky, readable masses. No part thin in two axes at once — a blade is a
    slab (wide and long, thin in depth), never a 2x2 stick.
  - Detail comes from PAINT, not from extra geometry. A blade fuller, a grip
    wrap, a shield boss and heraldry are all painted regions.
  - Build it standing upright in its natural orientation, growing along +Y: a
    sword with its point up and grip at the bottom, a shield face-on.
    The grip or mounting end must be at the BOTTOM (y = 0) — that end is what
    gets attached to the character.

=== FORMAT ===

{
  "name": "snake_case_name",
  "kind": "item",
  "root":  { ... },      // the main mass — required
  "parts": [ ... ],      // optional
  "details": [ ... ]     // painted regions — most of the character comes from here
}

--- root and parts ---

{ "id": "blade", "size": [4, 20, 2], "color": "#c9ced6" }

{
  "id": "guard", "size": [10, 2, 3], "color": "#c9a227",
  "parent": "blade", "anchor": { "to": "bottom" }
}

  parent  an existing part id
  anchor  "to": top, bottom, left, right, front, back, center
          optional alignX / alignY / alignZ: "min" | "center" | "max"
  offset  [x,y,z] nudge after anchoring
  shape   "box" (default), "sphere" or "cylinder"

Mirror a symmetric pair with "mirrorOf" instead of "parent".

--- details (painted regions) ---

{ "id": "fuller", "part": "blade", "region": [1, 4, 1, 2, 18, 1],
  "color": "#8d939c", "mirror": false }

"region" is [x0,y0,z0, x1,y1,z1] inclusive in that PART's local voxels, from
[0,0,0] to size-1. The front face is at max Z. Painting only recolours voxels
that already exist, so it cannot create floating blocks.

=== RULES ===

1. EVERY PART MUST TOUCH ITS PARENT. Sink it with a negative offset rather
   than leaving a gap.
2. NO STICKS. Thin in one axis is a slab and fine; thin in two is noise.
3. WIDTH PARITY on centred parts: a guard centred on a blade must share the
   blade's odd/even width, or it lands half a voxel off centre.
4. KEEP THE PALETTE TIGHT — mostly the character's colours.

Output the JSON object now.`;
}
