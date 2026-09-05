import type { SceneKind } from '../core/types.js';

/**
 * Revision asks for a list of edits, not a rewritten model.
 *
 * Re-emitting the whole spec to change one colour measured at ~3.5k output
 * tokens, and output is the expensive half of a call. The same edit as an op
 * list is a few dozen. It also removes a whole class of failure: the model
 * cannot accidentally "improve" a proportion it was not asked about, because
 * it never restates it.
 *
 * The house-style rules still appear in short form, because a revision can
 * break them just as easily as a first generation — "give it arms" is exactly
 * the instruction that would otherwise produce limbs sticking out of a prism.
 */
export function buildRevisePrompt(
  currentSpec: string,
  instruction: string,
  kind: SceneKind,
): string {
  const styleReminder =
    kind === 'item'
      ? `This is EQUIPMENT, not a character. It may be any real shape for the
object — a blade is a long slab, a shield a broad panel. It is built grip-down:
the mounting end sits at y = 0.`
      : `This is a CHARACTER in a house style where the whole figure reads as ONE
RECTANGULAR PRISM. The head is the top of the body block; the face, clothing
and arms are PAINTED ON it. There are no separate heads, arms or legs, and the
base is one solid footing — never two leg blocks.

The plain box may only be broken by: a stepped profile the concept genuinely
has (a flared gown), one or two small protrusions for named features (a hat
brim, a crest), and relief panels 1-2 voxels deep laid on a face (a belt, a
collar). Never decorative bumps.

If the instruction asks for something that would break this — arms that stick
out, separate legs — deliver it the house way instead: paint it on, or raise it
as a shallow relief panel.`;

  return `You are revising an existing voxel model. Below is its current definition and a change the artist wants.

CURRENT MODEL:
${currentSpec}

REQUESTED CHANGE: ${instruction}

${styleReminder}

=== OUTPUT A LIST OF EDITS ===

Do NOT restate the model. Output only the operations needed for this change:

{"ops": [ ... ]}

Available operations:

  {"op": "replace_color", "from": "#7a4a9c", "to": "#2f6b4a"}
      Recolours every part and painted region using that exact colour. This is
      the right op for "make the gown green" — one line instead of many.

  {"op": "set_part", "id": "skirt", "size": [16,10,12], "color": "#2f6b4a"}
      Change fields of one existing part. Include only the fields that change.
      Anchored children follow a resize automatically.

  {"op": "add_part", "part": {"id":"brim","size":[12,2,12],"color":"#c9a227",
      "parent":"body","anchor":{"to":"top"},"offset":[0,-1,0]}}

  {"op": "remove_part", "id": "brim"}
      Also removes anything anchored to it.

  {"op": "add_detail", "detail": {"id":"hem","part":"skirt",
      "region":[0,0,0,15,1,11],"color":"#c9a227","mirror":false}}
      Painted regions are in that PART's local voxels, [x0,y0,z0,x1,y1,z1]
      inclusive, from [0,0,0] to size-1. The front face is at max Z. Painting
      only recolours voxels that already exist, so it cannot float.
      Reusing an existing detail id replaces that detail.

  {"op": "set_detail", "id": "eyes", "color": "#1b1b1f"}

  {"op": "remove_detail", "id": "eyes"}

=== RULES ===

1. CHANGE ONLY WHAT WAS ASKED FOR. Do not re-proportion the body, retouch the
   palette or rename anything because you would have done it differently. The
   artist has already accepted everything else.
2. Prefer a painted detail over a new part when adding decoration.
3. A part on the centre line must share its parent's odd/even width, or it
   lands half a voxel off centre.
4. No part may be thin in two axes at once — that reads as a stray stick.
5. Every part must touch its parent; sink it with a negative offset.

Output ONLY the JSON object with "ops". No prose, no code fence.`;
}

/**
 * Correction pass for a revision.
 *
 * The generic repair prompt asks for a whole corrected spec, which is the wrong
 * mode here: it invites the model to restate the model from scratch and, in
 * testing, to change something nobody asked about. This keeps it editing.
 */
export function buildPatchRepairPrompt(
  currentSpec: string,
  instruction: string,
  problems: string[],
): string {
  return `Your edit list did not work. Try again.

THE MODEL, UNCHANGED:
${currentSpec}

THE CHANGE THAT WAS ASKED FOR: ${instruction}

WHAT WENT WRONG:
${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Common causes:
- naming a part or detail id that does not exist — use the exact ids above
- "replace_color" with a colour no part actually uses — copy the hex exactly
- an added part that floats: give it a negative offset so it overlaps its parent
- a part thin in two axes: make it a flat panel instead, or paint it
- a centred part whose width parity differs from its parent's

The ops available are: replace_color, set_part, add_part, remove_part,
add_detail, set_detail, remove_detail — same shapes as before.

Output a corrected {"ops": [...]} for the SAME requested change. Do not restate
the model. No prose, no code fence.`;
}
