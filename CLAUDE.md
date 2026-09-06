# VoxelCreator

An AI voxel model creator. You describe a model, a local Claude Code or Codex
CLI designs it, and a browser viewer shows the result live. Output is `.vox`,
which opens in MagicaVoxel.

## The house style: one rectangular prism

**Every model is essentially a single rectangular prism.** A character is a
standing block — the head is the top of it, the body is the rest, and the face
and clothing are *painted on*. There are no separate heads, arms or legs.

This is the whole point of the project, so the generator defaults to a plain
box and has to earn every deviation from it. Three deviations are allowed, and
only when the request actually calls for them:

| Deviation | When | Example |
| --- | --- | --- |
| **Stepped profile** | the concept has that silhouette | a gown that flares wide below a narrow bodice |
| **Small protrusion** | a named feature | hat brim, nose, snout, held item |
| **Relief panel** (1-2 voxels deep, laid on a face) | detail was asked for | belt, collar, chest plate |

Nothing else. No decorative bumps, ridges or studs. A clean box with a
well-painted face beats a lumpy one — when in doubt, paint it.

**The base is one solid footing.** Never split the bottom into two leg blocks —
that turns the figure into a puppet. Boots are a painted band, or at most one
shallow step the full width of the body. The `solid_base` check counts
connected regions in the bottom layer and warns on more than one.

The `prism_fidelity` check measures the silhouette: a character must fill
**60%+ of its own bounding box**. A solid box is 100%; a stepped gown lands
around 75%; a figure with limbs sticking out is about 40% and fails.

## Characters, items, assemblies

A scene has a `kind`, and the three are judged differently:

| kind | What it is | Silhouette rules |
| --- | --- | --- |
| `character` | a standing figure | full — prism fidelity, solid base, ground contact |
| `item` | equipment: sword, shield, hat | none — a blade is legitimately a thin slab that never touches the floor |
| `assembly` | a character with equipment attached | stance rules only; equipment is *expected* to break the prism |

Equipment is **never** built into a character. The character prompt says so
explicitly: armour and clothing are part of the figure, a sword is not.

### Generating equipment for a character

```bash
npm run generate -- "a knight's longsword with a cross guard" --for knight --name sword
```

`--for <character>` reads that character back and puts its palette (ordered by
coverage) and its exact dimensions into the item prompt, with scale guidance
derived from them — a one-handed weapon at half to two thirds of the
character's height, a shield about 70% of its width. This is what stops an item
looking like it came from a different game once equipped.

Items are built **grip-down**: the mounting end sits at y = 0.

### Attaching

```bash
npm run attach -- knight sword hand_r --name knight_armed
npm run attach -- knight_armed shield hand_l --name knight_full
```

This writes a new combined scene and leaves the character and item scenes
untouched, so one sword can be attached to several characters. Item part ids
are namespaced (`sword__blade`), and the item's root is re-anchored to the
socket — so the item follows if the character is later resized.

Sockets are `hand_r`, `hand_l`, `back`, `head_top`. A character that declares
none gets them derived from its root mass; hand sockets align the item's
**bottom** to about 42% of body height, because items are grip-down and
centre-aligning a longsword would leave the grip around its knees.

## Commands

```bash
npm run viewer      # browser viewer + generate endpoint at :5173
npm run generate -- "a knight in plate armour"
npm run generate -- "a rusty steam robot" --codex --name bot
npm run generate -- "a kite shield" --for knight --name shield   # equipment
npm run attach   -- knight shield hand_l --name knight_armed
npm run revise   -- knight "make the crest silver"   # edit an existing model
npm run revise   -- knight --undo
npm run check    -- knight shield knight_armed   # validation report
npm run test:mcp    # exercise the MCP server end to end
npm run test:repair # exercise the correction pass on a broken spec
npm run typecheck   # tsc --noEmit
```

The viewer has a **Single** mode (one model, stats, parts list, `.vox`
download) and an **All models** mode that lays every scene out in a grid with
name tags. Camera presets: Front, 3/4, Side, Top. The **◀** button folds the
panel away and hands its width back to the camera.

## Generation

Generation shells out to the local `claude` or `codex` CLI over stdin, so it
runs on your existing subscription — no API key, nothing to configure. Expect
60-180s per model.

The model returns a `GenSpec` (`src/generate/spec.ts`): a root mass, optional
parts, and painted details. There is no character preset and no fixed skeleton
— the art direction lives entirely in `src/generate/prompt.ts`, **which is
where generation quality is tuned.**

A generation is built and validated before anything is written, so a malformed
reply fails loudly instead of saving a broken scene.

## Revision

```bash
npm run revise -- knight "make the crest silver and add a dark blue cloak"
npm run revise -- knight "..." --as knight_blue   # branch instead of overwrite
npm run revise -- knight --undo                   # step back one revision
```

Or use the **Revise** box in the viewer, which acts on the selected model.

Revision feeds the model's **current scene** back as the starting point rather
than re-running the original prompt, so everything you already accepted
survives — "make the tabard blue" changes one field instead of rolling the dice
again. The scene is the source of truth here, not the `genSpec` stored in meta,
so revision also works on scenes edited through the MCP tools or produced by
attaching an item.

Every overwrite snapshots the previous version to `scenes/.history/<name>/`,
and `--undo` (or the viewer's Undo button) restores it. The revise prompt
repeats the house-style rules in short form, because "give it arms" is exactly
the instruction that would otherwise produce limbs sticking out of a prism.

### The correction pass

If the first attempt trips a structural check, its own defect list is fed back
for **one** repair pass, and whichever attempt has fewer problems is kept. The
checks are deterministic and name the part at fault, so the model gets "only
fills 43% of its bounding box" rather than "try again". Skipped entirely when
the first attempt is clean. Disable with `generate(prompt, { repairs: 0 })`.

**The validator thresholds and the prompt rules must stay in step.** The
validator drives the repair loop, so a rule the prompt states but the validator
does not check will pass through silently.

## The scene format is the source of truth

`scenes/*.scene.json` holds a **semantic** model — named parts with sizes,
colors and anchors — not a voxel array. Voxels are derived from it on every
build. This is what makes revision cheap: "wider skirt" is a one-number edit.

Never hand-edit voxels. Edit the scene, rebuild.

## Coordinate conventions

- **+X right, +Y up, +Z front.** The `.vox` writer converts to MagicaVoxel's
  Z-up on export; you never deal with that.
- Part-local coordinates run `[0,0,0]` to `size-1`. **The front face is at max Z**
  — a face detail on an 8-deep body sits at `z = 7`.
- Parts are placed by **anchoring to a parent face**, never absolute coordinates,
  so resizing the body moves everything attached to it.
- `mirrorOf` makes a part the mirror image of another across the symmetry plane.
  It inherits size, color and details. Define the right side; mirror the left.

### Match odd/even width parity on centred parts

A part that straddles the symmetry plane — a step, a hat, a nose — **must have
the same odd/even width as its parent.** Centring floors to the grid, so a
9-wide hat on a 10-wide body lands half a voxel off centre and quietly breaks
symmetry. Mirrored pairs are exempt.

The `centering` check names the offending pair. It only considers parts whose
whole ancestry is centred, so something hanging off a protrusion is left alone.

## Structural checks

| Check | Catches |
| --- | --- |
| `prism_fidelity` | a character silhouette that has strayed from a rectangular prism |
| `solid_base` | a base split into separate leg blocks |
| `base_footprint` | a model tapering to a point at the bottom, which looks unstable |
| `connectivity` | detached parts |
| `centering` | width-parity mistakes that break symmetry |
| `thickness` | parts thin in **two** axes (sticks). Thin in one axis is a relief panel and fine |
| `ground_contact` | nothing on the floor |
| `palette` / `vox_limits` | `.vox` format ceilings |

`symmetry` is reported as a metric but never warns: asymmetry is often
deliberate, and `centering` catches the accidental kind.

## Tools (MCP)

The agent drives these over MCP; `.mcp.json` wires them into Claude Code.

| Tool | Use |
| --- | --- |
| `create_scene` | Empty scene with one root part. |
| `add_part` | Attach a step, protrusion or relief panel. Anchor it to a parent. |
| `set_part` | Revise size/color/anchor of an existing part. |
| `remove_part` | Delete a part and everything hanging off it. |
| `add_detail` | Paint a region on a part. Cannot create floating geometry. |
| `describe_scene` | Resolved positions + validation report. Check your work with this. |
| `get_scene` | Full scene JSON. Read before a non-trivial revision. |
| `export_vox` | Write `out/<name>.vox`. |

Every mutating tool returns a validation report, so you learn immediately
whether an edit broke the model. A scene is only saved if it builds.

## Hand editing

The viewer has an **Edit voxels** panel: Add or Remove, a swatch row taken from
the model's own palette, and Save / Discard. Opening it **locks the orbit** —
with the camera live a click would mean "rotate", not "edit". Clicks go into a
buffer and the preview updates immediately, but nothing reaches the scene until
Save; Discard drops the buffer.

Edits are stored as an explicit layer on `scene.edits`, not baked into the parts:

```json
"edits": { "added": [[8, 22, 12, "#f2ede1"]], "removed": [[11, 14, 11]] }
```

The semantic scene has nowhere to put "a voxel at 8,22,12", and baking one in
would end revision. As a layer, the parts stay generated and revisable, and
deleting the layer restores exactly what the generator made.

Coordinates are in **layout space**, not final grid space. A voxel added outside
the parts' own box grows the grid and shifts the built content to make room, so
`BuildResult.shift` is what converts between the two — without it an add could
only ever go inward, which rules out a nose or an ear. Storing layout
coordinates is what keeps hand edits valid when the model is later resized.

Saving snapshots the previous version, so 
steps back through hand edits too.

## The visual pass

```bash
npm run look -- knight "a knight in ornate plate armour"
npm run render -- knight     # just the PNG, no model call
```

Renders the model front and three-quarter, hands the image back, and applies
the edits it returns. This is the general form of what used to be hand-written
prompt rules: every quality failure here was obvious on sight and invisible in
JSON, and encoding them one at a time does not generalise.

The renderer is a software raycaster (`src/render/`) — no GPU, no browser, no
native module. PNG encoding uses the zlib Node already ships.

Structure gets the last word. Visual edits run through the same deterministic
repair loop, and if the result has more problems than what was there, the whole
set is discarded and the model is left alone. Two constraints the eye keeps
breaking are stated in the critique prompt because of this: width parity, and
that a cone tapers to a point so nothing can be stacked on it.

Costs about $0.15-0.30 a look. Opt in per model rather than running on every
generation.

## Not built yet

- `.glb` export for Unity (needs a greedy mesher).
- An offscreen inspection render so the agent can see its own output.

## Layout

```
src/core/     scene types, grid, palette, primitives, layout, build, validate
src/io/       .vox writer and a reader used to verify it
src/generate/ prompt, spec, CLI, and the agent that shells out to claude/codex
src/mcp/      MCP server (the agent's interface) and a test client
src/viewer/   three.js viewer
scenes/       saved scenes + index.json manifest the viewer reads
out/          exported .vox files
```
