/**
 * The visual pass: let the generator look at what it built.
 *
 * Every quality failure this project has hit was obvious on sight and
 * invisible in JSON — a beard that reads as a zipper, a hat with no taper,
 * bands that make a figure look like a postbox. Encoding each one as a prompt
 * rule does not generalise: there is always a new way to look wrong.
 *
 * Rendering the model and handing it back closes that gap once, for every
 * failure mode, instead of one rule at a time.
 */
export function buildCritiquePrompt(
  imagePath: string,
  userPrompt: string,
  currentSpec: string,
): string {
  return `Read the image at ${imagePath}

It shows a voxel model you built, from the front and from three-quarters. It
was meant to be:

  ${userPrompt}

This is its definition:

${currentSpec}

LOOK AT THE IMAGE AND JUDGE IT HONESTLY. Not the JSON — the picture. Ask
yourself what a person would say if you showed them this and said it was the
thing above. If it reads as a postbox, a monument, a lamp post or a domino,
say so and fix it.

Then output the edits that fix the worst of it.

The house style, for reference: the BODY is one rectangular prism with a
square footprint, the face and clothing are painted on it, the head is the top
third and must be a different colour from the body so it reads as a head.
Headwear is free to have its real shape. Detail comes from paint, not parts.

Common things to look for, though trust your eyes over this list:
  - a hat that does not taper, or one so large the figure becomes a tower
  - a face you cannot find, or features so small they vanish
  - a beard or hood that has swallowed the face
  - evenly spaced horizontal bands ringing the body
  - a wide slab at the bottom that reads as a plinth rather than a garment
  - large areas of metal colour, which read as masonry

Output ONLY a JSON object of edits, no prose:

{"ops": [ ... ]}

  {"op":"replace_color","from":"#7a4a9c","to":"#2f6b4a"}
  {"op":"set_part","id":"cone","size":[8,14,8],"shape":"cone"}
  {"op":"add_part","part":{"id":"tip","size":[4,4,4],"color":"#2f3f66",
     "shape":"cone","parent":"cone","anchor":{"to":"top"}}}
  {"op":"remove_part","id":"hem"}
  {"op":"add_detail","detail":{"id":"beard","part":"body",
     "region":[4,15,11,7,18,11],"color":"#e8e8e0"}}
  {"op":"set_detail","id":"eyes","region":[3,20,11,4,21,11]}
  {"op":"remove_detail","id":"band"}

Painted regions are in that PART's own local voxels, [x0,y0,z0,x1,y1,z1]
inclusive, and the front face is at max Z. Use the exact ids from the
definition above.

TWO THINGS THAT WILL GET YOUR EDITS THROWN AWAY:

  WIDTH PARITY. A part stacked on the centre line must share its parent's
  odd/even width, or it lands half a voxel off centre. Resizing a hat cone
  from 8 to 7 on a 12-wide brim breaks this — go 8 to 6, or 10.

  EVERY PART MUST TOUCH ITS PARENT. Shrinking or moving a piece can leave the
  one above it floating. If you shorten something, check what sits on it.

  A CONE IS ALWAYS THE LAST PIECE IN A STACK. It narrows to a single voxel, so
  anything anchored on top of one is left hanging. If you want a tip above a
  cone, either make the piece below a box, or drop the tip and let the cone
  come to its own point.

The structure is re-checked after your edits, and if they break it the whole
set is discarded and the model stays as it was. Keep the numbers even and
keep the stack connected.

Change what is actually wrong. If something already reads well, leave it.
No prose, no code fence.`;
}
