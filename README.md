# VoxelCreator

Describe a model, get a voxel asset. A local Claude Code or Codex CLI designs
it, a browser viewer shows the result live, and the output is `.vox` — the
format MagicaVoxel opens.

The house style is deliberately narrow: **every model reads as one rectangular
prism**. A character is a standing block with the face and clothing painted on,
not an articulated figure with separate limbs. Equipment is generated as its own
model and attached at a socket.

## Setup

```bash
npm install
npm run viewer      # http://localhost:5173
```

Generation shells out to the `claude` or `codex` CLI you already have installed,
so it runs on your existing subscription — there is no API key to configure.

## Usage

```bash
npm run generate -- "a knight in ornate plate armour"
npm run generate -- "a longsword with a cross guard" --for knight --name sword
npm run attach   -- knight sword hand_r --name knight_armed
npm run revise   -- knight "make the crest silver and add a dark blue cloak"
npm run revise   -- knight --undo
```

All of it is also in the viewer: a prompt box to create, a revise box with undo,
a gallery of every model, camera presets and `.vox` download.

## How it holds together

Scenes are stored as **semantic JSON** — named parts with sizes, colors and
anchors — not voxel arrays. Voxels are derived on every build, which is what
makes revision cheap: "wider skirt" is a one-number edit, and a revision sends
back a small list of edits rather than a rewritten model.

A set of deterministic checks (silhouette fidelity, solid base, connectivity,
symmetry parity, thickness) runs on every result. When one trips, its own defect
list is fed back for a single correction pass — no vision call, no guessing.

See [CLAUDE.md](CLAUDE.md) for the full design: conventions, the check table,
the MCP tool surface, and where generation quality is tuned.
