import { sizeLadderBlock, tierNearestHeight } from './scale.js';
import { activeStyle } from '../styles/index.js';
import { referenceBlock } from './reference.js';
/**
 * The instruction given to the generating model.
 *
 * The house style is one rectangular prism. Everything here exists to keep the
 * model from drifting away from that: the default is a plain box, and every
 * deviation — a protrusion, a relief panel — has to be
 * earned by something in the request. Left unchecked a model will decorate,
 * which is what produces a figure covered in pointless bumps.
 */
export function buildPrompt(
  userPrompt: string,
  answers?: string,
  size?: [number, number, number],
): string {
  // A size the artist typed wins, but it still comes with the detail budget of
  // whichever rung it sits nearest: the point of the ladder is that how much a
  // model can carry is set by its voxel count, not by how much the request asks
  // for.
  const { profile, tiers } = activeStyle();
  const near = size ? tierNearestHeight(tiers, size[1]) : undefined;
  const sizeBlock = size
    ? `
=== THE BODY SIZE IS FIXED ===

The root part must be exactly [${size[0]}, ${size[1]}, ${size[2]}] — width,
height, depth in voxels. The artist chose these. Do not adjust them, do not
round them, do not talk yourself into a different shape.

Everything else scales to fit: the head is the top third of ${size[1]}, so
roughly y = ${Math.round((size[1] * 2) / 3)} to ${size[1]}, and headwear is at
most ${Math.round(size[1] * 0.4)} tall and ${size[0] + 4} wide.

That is close to the "${near!.label}" rung of the house ladder, so work to its
budget: ${near!.details[0]}-${near!.details[1]} painted regions.
FACE: ${near!.face}
${near!.notes}
`
    : `
${sizeLadderBlock(profile, tiers)}
`;
  return `You are a voxel artist working in one specific house style. Turn the request below into ONE JSON object describing a voxel model.

Output ONLY the JSON object. No prose, no explanation, no code fence.

REQUEST: ${userPrompt}
${answers ? `
${answers}
` : ''}${sizeBlock}
The request may be written in any language. Read it in whatever language it is
written, and answer with JSON either way. Keep "name" and every id in English
snake_case regardless — they are identifiers, not display text.

${referenceBlock(userPrompt)}

=== THE HOUSE STYLE ===

THE BODY is essentially ONE RECTANGULAR PRISM.

Start from a single box. That box is the character: the head is the top of it,
the body is the rest of it, and the face and clothing are PAINTED ON it. There
is no separate head, no separate arms, no separate legs.

WHAT SITS ON THE HEAD IS NOT BOUND BY THAT RULE. A wizard's hat is a hat: a
brim and a real tapering cone above it. A helmet has a crest. A crown has
points. Give headwear its true shape — a plain box on top of a plain box is
the single most common way these models come out looking like a postbox.

  Use "shape": "cone" for a pointed hat and "pyramid" for an angular one. Do
  not fake a point by stacking boxes.

  HEADWEAR STARTS AT THE BODY'S OWN WIDTH, AND IT IS SMALL.

  The default is ONE piece, as wide and as deep as the body, 3 to 5 voxels
  tall, sunk one voxel in with "offset": [0, -1, 0]. That is what the finished
  model above does, and a cap, hood, mitre or helmet is all one piece.

  Add a second piece only when the concept genuinely has one:
    - a BRIM, for a wide-brimmed hat. It grows in BOTH directions equally and
      only by 2 each — width AND depth. A brim wider than the body but no
      deeper is a plank; one twice the body depth is a flying saucer. 1 or 2
      voxels tall, never more.
    - a CONE or PYRAMID above it, for a genuinely pointed hat.

  NEVER STACK THREE SHRINKING BOXES. A brim, then a narrower box, then a
  narrower box again is a wedding cake, not a hat.

  Everything on the head together is at most 40% of the body height. A hat
  taller than the head it sits on turns the figure into a tower.

THE BASE IS ONE SOLID FOOTING. Never split the bottom into two leg blocks —
that turns the figure into a puppet, which this style does not do. Boots are a
painted band across the bottom, or at most one shallow step the full width of
the body. Arms are painted as vertical bands down the sides, or raised as a
relief panel.

The ways you may leave the plain box, within the silhouette budget above:

1. THE BODY DOES NOT WIDEN. There is no stepped profile in this style, and a
   flared robe is NOT built — it is painted. Every stepped attempt was measured
   and came out worse: the added width pushed the figure to an aspect of 0.49
   to 0.59, where it reads as a barrel or as a statue on a plinth, while the
   straight figures sit at 0.40 to 0.44 and read as people.

   A ROBE IS PAINTED, AND THIS IS HOW. On the front face, run VERTICAL bands
   down the garment, alternating a slightly darker and a slightly lighter shade
   of the garment colour — two or three of them, of uneven widths, not centred.
   Those are the folds, and they are what makes cloth read. Then:
     a darker band across the bottom for the hem, 1-2 rows
     a collar or yoke where the garment meets the head band
     the sleeves as vertical bands down the left and right front edges
   Horizontal bands alone make a postbox. Vertical bands make cloth.

   BIG MASSES TAKE THE GARMENT COLOUR. Gold, silver and brass are for thin
   trim lines only — a few voxels tall. A large gold shape reads as masonry
   or a plinth, never as cloth or armour.

2. SMALL PROTRUSIONS — a nose, a snout, an ear, a shoulder pad.
   One or two, for named features. Never as decoration. (Headwear is not
   counted here — it is free to be its own shape, see above.)

3. RELIEF PANELS — a part 1-2 voxels deep laid flat on a face of the body, for
   raised detail: a belt, a collar, a chest plate, a buckle. Use these when the
   request asks for detail. Never scatter them.

DO NOT add bumps, ridges, studs or protrusions that nothing in the request
asked for. A plain, clean box with a well-painted face beats a lumpy one. When
in doubt, paint it instead of building it.

=== FORMAT ===

{
  "name": "snake_case_name",
  "root":  { ... },      // the main mass — required
  "parts": [ ... ],      // steps, protrusions, relief — optional
  "details": [ ... ]     // painted regions — this is where most work happens
}

--- root ---

{ "id": "body", "size": [10, 26, 8], "color": "#6b4a2f" }

"size" is [width, height, depth] in voxels.

  THE FOOTPRINT IS SQUARE. Width and depth are the same number. A body 12
  wide and 8 deep is a slab: it looks fine head-on and wrong from every other
  angle, and everything stacked on it inherits the mistake. 12 x 26 x 12.

  Width is usually 40-55% of height. 12 wide by 26 tall by 12 deep is a good
  default. 10 by 34 is a monument, not a person.

  THE HEAD IS THE TOP THIRD of the body — not the top fifth. On a 26-tall
  body the head is roughly y = 17 to 26, and it is mostly FACE: skin colour,
  with big readable eyes in it. Realistic human proportion looks wrong here.
  These read like toys, and toys have big heads.

  If a hat, hair or helmet eats the head, the figure has no face left. Cover
  at most the top third OF THE HEAD region with it — so on a 26-tall body a
  hat brim sits around y = 23-24, never lower.

--- parts ---

{
  "id": "skirt",
  "size": [16, 10, 12],
  "color": "#7a2f4a",
  "parent": "body",
  "anchor": { "to": "bottom" },
  "shape": "box"
}

  parent  an existing part id
  anchor  "to" is the parent face it attaches to:
          top, bottom, left, right, front, back, center
          optional alignX / alignY / alignZ: "min" | "center" | "max"
  offset  [x,y,z] nudge in voxels after anchoring; negative Y sinks it in
  shape   "box" (default), "cone", "pyramid", "cylinder", "sphere".
          The body is a box. Headwear is where cone and pyramid belong.

For a symmetric pair, define the right one and mirror the left:

  { "id": "ear_r", "size": [3,4,3], "color": "#e0ac69", "parent": "body",
    "anchor": { "to": "right", "alignY": "max" }, "offset": [0,-4,0] },
  { "id": "ear_l", "size": [3,4,3], "color": "#e0ac69", "mirrorOf": "ear_r" }

--- details (painted regions) ---

{ "id": "eyes", "part": "body", "region": [2, 20, 7, 3, 21, 7],
  "color": "#1b1b1f", "mirror": true }

"region" is [x0,y0,z0, x1,y1,z1] inclusive, in that PART's own local voxels,
from [0,0,0] to size-1. Painting only recolors voxels that already exist, so it
can never create floating blocks. "mirror": true also paints the left/right
mirrored copy — use it for eyes, cheeks, hands, boots.

THE HEAD MUST READ AS A HEAD. This is what separates a character from a
painted post, and it is the most common thing to get wrong.

The body is one block, so nothing tells the eye where the head is unless you
paint it. THE ENTIRE HEAD THIRD MUST BE A DIFFERENT COLOUR FROM THE BODY —
fill it with skin, or with the hood, hair or helmet colour, across the full
width and around the sides. Then put the face features inside that patch.

  Wrong: a blue body with two dark dots near the top. That is a postbox.
  Right: a blue body whose top third is a solid band of skin or helmet
         colour, with eyes, brow and mouth inside it, and a collar line
         where that band meets the body.

A collar or neckline at the boundary, one or two voxels tall in a contrasting
colour, is what makes the join read. Do not skip it.

THE FACE MUST STAY READABLE. A hood, beard, helmet or hair painted across the
whole upper block leaves a blank slab with no face, and the figure reads as a
sack rather than a character.

  - Decide the head third first — the top third of the body, on the front
    face — and paint the eyes in it before anything else.
  - A hood or helmet frames the face: paint it around the face band, not over
    it. Leave the eyes exposed.
  - After every other detail, the eyes must still be visible from the front.
    If a garment would cover them, move the garment down.

FACIAL HAIR IS PAINT, AND IT IS SMALL. A beard is a painted region, never a
part. On a body 26 tall it is about 4 voxels tall and 4 wide — it hangs just
under the mouth and stops well above the chest. Leave at least 2 voxels of
face colour on each side of it.

  A beard the width of the body, or running a third of its height, is the
  single ugliest thing you can do here: the figure turns into a pale slab with
  no face. "Long white beard" still means about 5 voxels tall, not 12. Length
  in the request describes the character, not the voxel count.

THIS IS WHERE YOU DO THE WORK. Paint in this order, as the finished model above
does. On a 12x26x9 body:
  1. THE HEAD BAND FIRST, and wrap it on ALL FOUR SIDES (the full z range, not
     just the front): the whole head third y 17-26 in skin, or in hood or
     helmet colour. This one region is what makes a block read as a head. Never
     paint a small patch on the front and leave the sides in garment colour.
  2. A COLLAR band directly under it, around y 16, in a colour that separates
     head from body.
  3. THE FEATURES, on the front face (z = 8), inside the head band:
       eyes — two blocks, each 2 wide and 2 tall, around y = 21-22, with 2 or 3
         voxels of face between them. Single-voxel eyes disappear.
       brow — a band above the eyes, with a row of skin left between them, in a
         MID-TONE. A black brow touching black eyes merges into one bar.
       mouth or beard — small, below the eyes, around y = 18-19
     Leave the rest of the head band in face colour so the features register.
  4. Then the garment: the tunic, dress or breastplate as a broad band across
     the middle, an emblem centred on the chest, thin trim at collar and waist
     in a metal colour, arms as two vertical bands down the left and right
     front edges, boots as a band across the bottom.

Do not ring the figure with evenly spaced horizontal stripes. Three or four
bands at equal intervals down a tall block is what a postbox looks like.

NO STRETCH OF THE FIGURE MAY BE A BLANK SLAB, and this is measured: no run of
rows taller than a quarter of the whole figure may be one flat colour with
nothing painted on it. It is always the same stretch that fails — the face
gets painted and the hem gets painted, and the long drop between the collar
and the belt is left as a bare column. Carry the garment over it, and break it
with an emblem, a seam, a fold in a near shade or a change of garment colour.
GIVE THE FIGURE A TONAL RANGE, AND THIS IS MEASURED. Painting trim in another
shade of the same near-black is the same as not painting it: the renderer
shades the three visible faces of a cube across a wider spread than the gap
between #0a0a0a and #161616, so that seam is gone before anyone looks at it.
Choose the garment's darkest shade first, then make every marking laid on it
clearly lighter or clearly a different hue. A black cassock still needs its
collar, belt, hem and emblem to READ — bone, grey, gold, oxblood.

KEEP FACIAL FEATURES APART. Leave at least one row of face colour between the
brow and the eyes, and between the eyes and the nose or mouth. Features that
touch merge into one dark bar and the figure ends up looking like it is wearing
a visor.

Layered trim is what makes these read as designed rather than plain: a dark
base, a broad mid-tone garment, then thin bright trim lines picking out the
collar, belt and hem. Twelve well-placed painted regions make a far better
character than three extra parts.

=== RULES THAT MATTER ===

1. FRONT FACE IS MAX Z. A face detail on an 8-deep body sits at z = 7.

2. WIDTH PARITY. Any part on the centre line — a step, a hat, a nose — must
   have the SAME odd/even width as its parent, or it lands half a voxel off
   centre and breaks symmetry. 10 on 12 is fine; 9 on 11 is fine; 8 on 9 is not.
   Mirrored pairs are exempt.

3. NO STICKS. A part may be thin in ONE axis (that is a relief panel, which is
   fine). A part thin in two axes is a stick and reads as noise. Relief panels
   should be 1-2 deep but full-width across what they cover.

4. ONE SOLID BASE. The bottom must be a single connected footing, wide enough
   to stand on. Never two leg blocks, and nothing thin reaching below the mass.

   Equipment a character carries — a sword, a shield, a staff — is NOT part of
   the character. Leave it out; it is generated as its own model and attached
   later. Armour, clothing and a helmet are part of the character.

5. EVERY PART MUST TOUCH ITS PARENT. Use a negative offset to sink a hat into
   the body rather than leaving it hovering.

6. KEEP THE PALETTE TIGHT, about 5-10 colours, chosen as deliberate art
   direction rather than primaries.

Output the JSON object now.`;
}

/**
 * Correction pass. The structural checks are deterministic and name the exact
 * part at fault, so the model gets a specific defect list rather than being
 * asked to "try again" — and it edits its own spec instead of starting over.
 */
export function buildRepairPrompt(
  userPrompt: string,
  previousSpec: string,
  problems: string[],
): string {
  return `The voxel model you produced for this request has structural problems.

REQUEST: ${userPrompt}

YOUR PREVIOUS JSON:
${previousSpec}

PROBLEMS FOUND BY THE BUILDER:
${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Fix exactly these problems and output the corrected JSON object.

How to fix each kind:
- "only fills N% of its bounding box": the silhouette has strayed from a
  rectangular prism. Remove protruding parts, or widen and merge them into the
  main mass, and paint that detail on instead. Do not add anything.
- "bottom layer is only N% of the widest layer": something thin reaches below
  the main mass, or the base is too narrow. Widen the base or shorten whatever
  hangs below it.
- "cannot centre in X": change one of the two widths so both are odd or both
  are even.
- "disconnected components": the named part is floating. Give it a negative
  offset (or move its anchor) until it overlaps its parent.
- "thin in two or more axes": that part is a stick. Thicken it, or turn it into
  a relief panel (thin in one axis only, wide across the other two).
- "footprint is N wide by M deep": set the root depth equal to its width.
  Then widen the hat brim to match the new depth plus 2.
- "too narrow and reads as a pillar": widen the root part, or shorten it.
  Keep the head at the top third and move the face features with it.
- "only N painted regions": add more entries to "details" — trim bands at the
  collar, waist and hem, an emblem on the chest, seams, cuffs, a contrasting
  band for the footwear. Do NOT add parts to satisfy this.
- "rows y A-B are N rows of one flat colour": that stretch is a bare column.
  Paint over it — carry the garment across it, add an emblem, a seam or a
  panel in a near shade. Do not add parts, and do not answer it with evenly
  spaced stripes.
- "the head band ... uses only N colour(s)": the figure has no face. Paint the
  whole head band in a face, hood or helmet colour, then put the eyes, brow
  and mouth inside it, before any clothing detail.
- "painted regions mostly disappear into the surface": those markings are in
  shades too close to what they sit on. Do NOT add more details — change the
  colours of the ones listed so each is clearly lighter than, or a clearly
  different hue from, the surface beneath it.
- "exceeds the 255 the .vox format allows": reduce the number of colours.

NEVER DROP A FEATURE THE REQUEST ASKED FOR. If the request names a staff, a
hat or a tail, the fixed model still has one — reshape it, thicken it, shorten
it, or paint it onto the body, but do not silently delete it. Only remove a
part that nothing in the request called for.

Keep everything that was not listed as a problem exactly as it was — same
name, same proportions, same colours. Change only what is needed.

Output ONLY the corrected JSON object. No prose, no code fence.`;
}
