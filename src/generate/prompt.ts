/**
 * The instruction given to the generating model.
 *
 * The house style is one rectangular prism. Everything here exists to keep the
 * model from drifting away from that: the default is a plain box, and every
 * deviation — a stepped profile, a protrusion, a relief panel — has to be
 * earned by something in the request. Left unchecked a model will decorate,
 * which is what produces a figure covered in pointless bumps.
 */
export function buildPrompt(
  userPrompt: string,
  answers?: string,
  size?: [number, number, number],
): string {
  const sizeBlock = size
    ? `
=== THE BODY SIZE IS FIXED ===

The root part must be exactly [${size[0]}, ${size[1]}, ${size[2]}] — width,
height, depth in voxels. The artist chose these. Do not adjust them, do not
round them, do not talk yourself into a different shape.

Everything else scales to fit: the head is the top third of ${size[1]}, so
roughly y = ${Math.round((size[1] * 2) / 3)} to ${size[1]}, and headwear is at
most ${Math.round(size[1] * 0.4)} tall and ${size[0] + 4} wide.
` : '';
  return `You are a voxel artist working in one specific house style. Turn the request below into ONE JSON object describing a voxel model.

Output ONLY the JSON object. No prose, no explanation, no code fence.

REQUEST: ${userPrompt}
${answers ? `
${answers}
` : ''}${sizeBlock}
The request may be written in any language. Read it in whatever language it is
written, and answer with JSON either way. Keep "name" and every id in English
snake_case regardless — they are identifiers, not display text.

=== THE HOUSE STYLE ===

THE BODY is essentially ONE RECTANGULAR PRISM.

Start from a single box. That box is the character: the head is the top of it,
the body is the rest of it, and the face and clothing are PAINTED ON it. There
is no separate head, no separate arms, no separate legs.

WHAT SITS ON THE HEAD IS NOT BOUND BY THAT RULE. A wizard's hat is a hat: a
brim and a real tapering cone above it. A helmet has a crest. A crown has
points. Give headwear its true shape — a plain box on top of a plain box is
the single most common way these models come out looking like a postbox.

  Use "shape": "cone" for a pointed hat and "pyramid" for an angular one.

  A tall thin BOX on the head is not a hat. If you write a box up there, stop
  and make it a cone, or step it down in pieces.

  HEADWEAR IS BUILT AS A STEPPED STACK, AND IT IS SMALL.

  On a body 10 wide, 22 tall and 10 deep, a wizard hat is exactly this:

    brim  [12, 1, 12]   +2 on width AND depth, 1 voxel tall
    cone  [ 6, 6,  6]   drops to about 60% of the body width
    tip   [ 4, 2,  4]   a short cap on top

  The rules that shape comes from:
    - A BRIM GROWS IN BOTH DIRECTIONS EQUALLY, and only by 2 each. A brim
      wider than the body but no deeper is a plank; one twice the body depth
      is a flying saucer. Match the body's depth plus 2.
    - A brim is 1 or 2 voxels tall. Never more.
    - Above the brim, step down in two or three pieces rather than running one
      long cone. Each piece is narrower and shorter than the one below.
    - Everything on the head together is at most 40% of the body height.
    - A helmet or cap with no brim is 4-6 tall and the body's own width.

  A hat taller than the head it sits on turns the figure into a tower.

THE BASE IS ONE SOLID FOOTING. Never split the bottom into two leg blocks —
that turns the figure into a puppet, which this style does not do. Boots are a
painted band across the bottom, or at most one shallow step the full width of
the body. Arms are painted as vertical bands down the sides, or raised as a
relief panel.

The ways you may leave the plain box, within the silhouette budget above:

1. STEPPED PROFILE — stack boxes of different widths on the same centre line.
   Use this for a silhouette the concept genuinely has: a dress or robe that
   flares (narrow above, wide below), broad shoulders over a narrower waist.
   If the request does not imply a shape like that, do not step it.

   A FLARE IS NOT A PLINTH. A wide slab at the bottom, in a bright colour,
   ringed with bands, is a pedestal the figure stands on — not a garment.

     at most 4 voxels wider than the body IN TOTAL, so 16 on a 12-wide body
     at most a quarter of the body height
     the SAME colour family as the robe above it, never a metal
     no horizontal bands across it

   Most characters do not need one at all. Unless the request says gown, robe
   or dress, leave the body straight and paint the hem.

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

THIS IS WHERE YOU DO THE WORK. On a 12x26x9 body, paint:
  THE FACE FIRST, in the head third (y 17-26) on the front face (z = 8):
    eyes — two blocks, each 2 wide and 2 tall, around y = 21-22, with 2 or 3
      voxels of face between them. Small single-voxel eyes disappear.
    brow or visor — a darker band just above the eyes reads as a helmet slot
    mouth or beard — small, below the eyes, around y = 18-19
    leave the rest of the head band in face colour so the features register
  hair or a helmet as a cap over the very top and upper sides only
  a collar as a band where the head meets the body, around y = 16
  the tunic, dress or breastplate as a broad band across the middle
  an emblem centred on the chest — a cross, a crest, a stripe
  trim as thin horizontal bands at the collar and waist, in a metal colour
  arms as two vertical bands down the left and right front edges
  boots as a band across the bottom

Do not ring the figure with evenly spaced horizontal stripes. Three or four
bands at equal intervals down a tall block is what a postbox looks like.

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
- "exceeds the 255 the .vox format allows": reduce the number of colours.

NEVER DROP A FEATURE THE REQUEST ASKED FOR. If the request names a staff, a
hat or a tail, the fixed model still has one — reshape it, thicken it, shorten
it, or paint it onto the body, but do not silently delete it. Only remove a
part that nothing in the request called for.

Keep everything that was not listed as a problem exactly as it was — same
name, same proportions, same colours. Change only what is needed.

Output ONLY the corrected JSON object. No prose, no code fence.`;
}
