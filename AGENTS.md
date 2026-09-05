# VoxelCreator

An AI voxel model creator. An agent (Codex or Codex) drives voxel tools over
MCP to build editable voxel assets; a browser viewer shows the result live and
`.vox` export opens in MagicaVoxel.

## Workflow

```
agent ──MCP──▶ voxel tools ──▶ scenes/<name>.scene.json ──▶ out/<name>.vox
                                        │
                                        ▼
                          viewer at localhost:5173 (live, polls every 500ms)
```

Start the viewer with `npm run viewer`, then leave it open — it picks up every
edit automatically. There is no build step between an edit and seeing it.

## Commands

## Generating from a prompt

```bash
npm run generate -- "a stocky dwarf blacksmith with a braided beard"
npm run generate -- "a rusty steam robot" --codex --name bot
```

Or type the prompt in the viewer's **Create** box and press Generate.

Generation shells out to the local `Codex` or `codex` CLI over stdin, so it
runs on your existing subscription — no API key, nothing to configure. The
model returns a `GenSpec` (`src/generate/spec.ts`): a preset choice plus
numbers, not a raw part hierarchy, because picking dimensions and colors is
what an LLM does reliably. The instruction it receives lives in
`src/generate/prompt.ts` — **that file is where generation quality is tuned.**

A generation is built and validated before anything is written, so a malformed
reply fails loudly instead of saving a broken scene. Expect 60-150s per model.

### The correction pass

If the first attempt trips a structural check, its own defect list is fed back
for **one** repair pass (`buildRepairPrompt`), and whichever attempt has fewer
problems is kept. The checks are deterministic and name the part at fault, so
the model gets "staff hangs 10 voxels below the feet" rather than "try again".
That costs one extra CLI call and is skipped entirely when the first attempt is
clean. Tune with `generate(prompt, { repairs: 0 })` to disable.

**The validator thresholds and the prompt rules must stay in step.** The
validator is what drives the repair loop, so a rule the prompt states but the
validator does not check will pass through silently — and a threshold stricter
than the prompt will send clean models into pointless repair.

```bash
npm run viewer      # browser viewer + generate endpoint at :5173
npm run gallery     # rebuild the 8 sample characters, report validation for each
npm run demo        # build the sample knight, print ASCII views, export .vox
npm run test:mcp    # exercise the MCP server end to end
npm run typecheck   # tsc --noEmit
```

The viewer has a **Single** mode (one model, stats, parts list, `.vox` download)
and an **All models** mode that lines every scene up side by side with name
tags. Camera presets: Front, 3/4, Side, Top.

## The scene format is the source of truth

`scenes/*.scene.json` holds a **semantic** model — named parts with sizes,
colors and anchors — not a voxel array. Voxels are derived from it on every
build. This is what makes revision cheap: "longer arms" is a two-number edit to
one part, not a regeneration.

Never hand-edit voxels. Edit the scene, rebuild.

## Coordinate conventions

- **+X right, +Y up, +Z front.** The `.vox` writer converts to MagicaVoxel's
  Z-up on export; you never deal with that.
- Part-local coordinates run `[0,0,0]` to `size-1`. **The front face is at max Z**
  — a face detail sits at `z = depth-1`.
- Parts are placed by **anchoring to a parent face**, never absolute coordinates.
  That is why resizing a torso moves the head, arms and legs with it instead of
  detaching them.
- `mirrorOf` makes a part the mirror image of another across the model's
  symmetry plane. It inherits size, color and details, so a left arm cannot
  drift out of sync with the right. Define the right side; mirror the left.

### Match odd/even width parity on centred parts

A part that straddles the symmetry plane — head, torso, helmet, antenna,
anything not half of a mirrored pair — **must have the same odd/even width as
its parent.** Centring floors to the grid, so an 8-wide head in a 9-wide torso
lands half a voxel off centre and quietly breaks symmetry. A 10-wide head in
that torso is fine, and so is 9-wide in 11-wide.

This does not apply to mirrored pairs (arms, legs, horns) — those stay
symmetric at any width, because the mirror is computed from the plane.

The `centering` check names the offending pair when you get it wrong. It only
considers parts whose whole ancestry is centred, so something hanging off an arm
(a staff, a shield) is correctly left alone.

### Nothing may hang below the feet

The legs are the model's ground reference. A staff, tail or cape reaching below
them lifts the whole figure off the floor when it is placed in a scene — the
model looks like it floats. The `below_feet` check reports the part and by how
much.

### Structural checks

| Check | Catches |
| --- | --- |
| `connectivity` | detached parts — a helmet floating above the head |
| `centering` | width-parity mistakes that break symmetry |
| `below_feet` | anything reaching below the legs |
| `thickness` | parts under 3 voxels, which read as noise |
| `ground_contact` | a model with nothing on the floor |
| `palette` / `vox_limits` | `.vox` format ceilings |

`symmetry` is reported as a metric but never warns: asymmetry is usually
deliberate, and `centering` is what catches the accidental kind.

## Tools

| Tool | Use |
| --- | --- |
| `create_humanoid` | Blocky character from the skeleton preset. Start here for characters. |
| `create_scene` | Empty scene with one root part. Start here for props. |
| `add_part` | Attach a helmet, weapon, ear, wheel. Anchor it to a parent. |
| `set_part` | Revise size/color/anchor of an existing part. |
| `remove_part` | Delete a part and everything hanging off it. |
| `add_detail` | Paint a region on a part. Cannot create floating geometry. |
| `describe_scene` | Resolved positions + validation report. Check your work with this. |
| `get_scene` | Full scene JSON. Read before a non-trivial revision. |
| `export_vox` | Write `out/<name>.vox`. |

Every mutating tool returns a validation report (connectivity, symmetry, ground
contact, thickness), so you learn immediately whether an edit broke the model.
A scene is only saved if it builds — a failed edit leaves the last good state.

## Making characters that read well

The preset defaults to Minecraft-like proportions, 32 voxels tall:
head `8×8×8`, torso `8×12×4`, arms and legs `4×12×4`.

- **Keep the silhouette a clean stack of rectangular prisms.** Blocky reads as
  intentional; near-round reads as broken.
- **Detail with paint, not geometry.** Faces, clothing, trim and markings are
  `add_detail` regions. Adding thin parts for them produces noise and breaks the
  silhouette.
- **Exaggerate.** Big head, chunky limbs, minimum 3-4 voxels thick. Anything
  1-2 voxels wide disappears at normal viewing size — the thickness check warns
  about this.
- **Character type comes from proportion before color.** An orc is a wider
  torso and longer arms; a child is a bigger head on a shorter body. Change
  dimensions first, then palette.
- **Keep the palette tight**, roughly 8-16 colors. `.vox` caps at 255 and a
  large palette makes voxel art look muddy.

## Layout

```
src/core/     scene types, grid, palette, primitives, layout, build, validate, humanoid preset
src/io/       .vox writer and a reader used to verify it
src/mcp/      MCP server (the agent's interface) and a test client
src/viewer/   three.js viewer
scenes/       saved scenes + index.json manifest the viewer reads
out/          exported .vox files
```
