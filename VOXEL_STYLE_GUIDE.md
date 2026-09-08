# Voxel style guide

Craft rules for models made by this tool. They are here because "it looks wrong"
kept being the only feedback available, and a rule that cannot be measured
cannot be checked, taught to the generator, or argued with.

Two kinds of statement appear below:

- **Craft rules** taken from pixel and voxel art practice, cited at the end.
- **Derived rules** calculated from *this* project's renderer. These are not
  opinions — they fall out of the shading model in `src/render/raster.ts`, and
  if that model changes the numbers change with it.

The per-project numbers live in a style profile (`src/styles/<id>.ts`). This
document explains where they come from; the profile decides what they are.

---

## 1. The lighting floor — the number everything else hangs off

The renderer shades a face by `0.55 + 0.45 · max(0, N·L)` with the light at
`normalize(0.45, 0.8, 0.4)`. That gives six possible brightnesses:

| face | multiplier |
| --- | --- |
| top (+Y) | **0.910** |
| right (+X) | 0.752 |
| front (+Z) | 0.730 |
| left, back, bottom | 0.550 |

**One colour therefore drifts by 0.36 × its own luminance purely from which way
a face points.** That drift is the noise floor. Anything quieter than it is not
read as paint or as form — it is read as a change in lighting.

| surface | luminance | lighting drift |
| --- | --- | --- |
| `#161616` near-black | 22 | 8 |
| `#3f434b` dark steel | 67 | 24 |
| `#8b1a2a` deep red | 51 | 18 |
| `#3f6b35` green wool | 94 | 34 |
| `#e0ac69` skin | 178 | 64 |
| `#c9ced6` polished steel | 206 | **74** |

### Derived rule 1 — contrast scales with the surface

> A painted marking must differ from the surface beneath it by more than
> **0.36 × the luminance of that surface**.

A fixed threshold is wrong, and this project used one (20) for a while. It
passed a knight whose markings sat 28–31 from a body at drift 24 — technically
above the floor, indistinguishable in practice — and whose highlight on polished
steel sat 38 against a drift of 74, which was simply invisible. The model looked
like a grey slab and scored full marks.

Dark garments are forgiving; light ones are not. Trim on white or steel has to
be *much* further away than trim on black.

---

## 2. Steps, slopes and silhouette

### Derived rule 2 — a step must be at least 4 voxels wide, 2 per side

When a form steps outward, the step exposes a **top face** — the brightest
surface in the whole model at 0.910, against a wall at 0.730. A step that
changes the width by 2 (one voxel each side) exposes a band exactly **one voxel
wide** of the brightest value on the model.

A one-unit cluster of a distinct value is the textbook definition of an **orphan
pixel**: "single pixel units not connected to a cluster of the same color…
usually responsible for the image looking noisy and confusing" (Saint11). Ours is
worse than the usual case, because it is not merely a stray pixel, it is the
stray pixel with the highest contrast available.

> Width changes by **4 or more** (2 voxels per side), never 2.

### Craft rule — step sizes must progress, never wobble

Saint11 on curved edges: the pixels in each step "goes up and then goes down",
and a *misstep* is "a step size suddenly goes down and goes up again in the
middle of a curve." Isometric pixel art enforces this absolutely — every
receding edge is 2 across for 1 down, "2, 2, 2, 2, every step identical", and an
edge that breaks the ratio "stops agreeing with the grid".

> Within one tapering form, either keep the step constant or change it
> monotonically. Never 4, 2, 4.

The cone primitive used to produce widths 16, 10, 8, 6, 6, 4, 2 — steps of
6, 2, 2, 0, 2, 2 — and rasterised each layer as a fresh ellipse, so two layers of
the same width had different corners bitten out. That is a jaggie in three
dimensions and it is what a "bad hat" was made of.

### Derived rule 4 — the body does not widen; cloth is painted

A robe hangs from the shoulders and its widest point is the hem, so the obvious
move is to step the silhouette outward on the way down. It was tried and
measured, and it does not work at these proportions.

| model | width × height | aspect | reads as |
| --- | --- | --- | --- |
| straight guard | 12 × 30 | **0.40** | a person |
| straight priest | 12 × 27 | 0.44 | a person |
| one-step flare | 20 × 41 | 0.49 | a barrel |
| two-step flare | 24 × 41 | **0.59** | a wedding cake |

The head is 41% of the figure in every one of those, so the head is not the
variable — the silhouette aspect is. The ladder's ratio (8:18 = 0.44) is already
at the edge of the readable band, and a flare has to add width the proportions
cannot absorb. Sixteen generated robes all put their widening in the bottom
sixth in a single step, which is the plinth failure; correcting the geometry
produced the barrel failure instead.

> The body is a straight prism. A robe is conveyed in paint.

Flat pixel art has always done cloth this way: **vertical** bands of a darker
and a lighter shade of the garment colour, of uneven widths, read as folds.
Horizontal bands alone make a postbox. This also agrees with the greebles
advice — flat surfaces, bold colour, no protruding detail.

A profile can allow a flare (`bodyFlare: 'stepped'`), and then rule 2's step
sizes and a start height govern it. `medieval-humanoid` does not.

### Craft rule — no greebles

Small protruding details ("greebles") are noise. They cost geometry for nothing,
and under lighting "everything gets blurred out" and "shadows would hide a lot of
the details" (Game Developer). The advice is flat surfaces, bold colour choices,
strong contrast between base and highlight, and simplification.

> Detail is **painted**, not built. A bump has to earn its place by being a named
> feature the request asked for, and it has to be at least 2 voxels in two axes.

---

## 3. Painted markings

### Craft rule — clusters, not orphans

A cluster is "a continuous group of pixels of the exact same color", and the aim
is to minimise cluster count and eliminate single-pixel clusters. Orphans are
allowed only for texture, anti-aliasing, or "strong details, like the red eyes".

Translated for this project, and this is the `featureRule` setting in a profile:

| rule | a line may be | a patch must be |
| --- | --- | --- |
| `free` | 1 | 1 |
| `line1` | 1 | 2×2 |
| `min2` | 2 | 2×2 |

`line1` is the reading that matches the source: a connected 1-wide line running
across a form is not an orphan, an isolated 1×1 dot is.

### Derived rule 3 — `min2` cannot draw a face at the base size

A face is a stack: brow, gap, eyes, gap, mouth. That is 5 rows at minimum under
`free`, 6 under `line1`, **8** under `min2`. The head band is a third of the body
height:

| rung | body | head band | fits `min2`? |
| --- | --- | --- | --- |
| ×0.5 | 4×9×4 | 3 rows | no |
| ×1 | 8×18×8 | 6 rows | **no** |
| ×1.5 | 12×27×12 | 9 rows | yes |
| ×2 | 16×36×16 | 12 rows | yes |

So `min2` is only available to a style whose base body is at least ×1.5.

### Craft rule — features must not touch

Two dark markings that touch merge into one dark bar. A brow directly above the
eyes reads as a visor, not a face. Leave a row of skin between every pair.

### Craft rule — islands of detail, not uniform noise

Arne: make "islands of detail" rather than spreading detail evenly, and separate
things with contrast rather than with black outlines. Evenly spaced horizontal
bands down a tall block is what a postbox looks like.

---

## 4. Colour

### Craft rule — ramps shift hue, they do not just darken

Do not build a ramp by mixing black and white into one colour; shift the hue as
the value changes — toward the light's hue for highlights, away from it for
shadows. Skin, for example, runs greyish warm purple in shadow, orange in
midtone, yellowish in highlight. Long ramps of fully saturated colour are for
neon and nothing else.

### Craft rule — few colours, used deliberately

Restrained palettes beat extensive gradients. Highlights go in "a few sweet
spots"; over-highlighting flattens a colour's identity, turning red into shiny
pink. Metals are the exception and can carry a longer highlight ramp.

### Craft rule — avoid banding

Banding is several bands of value following the same path, which flattens a form.
Where a banded edge is unavoidable, put it near a natural terminator, where the
eye expects a boundary and stops noticing it.

### Putting it together with rule 1

A palette for one figure:

- one **garment** value, which is the largest area
- one or two **structure** values darker than it, for shadow, recess and hem
- one **accent**, saturated, used two or three times and nowhere else
- **skin or material** for the head band, well clear of all of the above

Every neighbouring pair must clear `0.36 × luminance` of the lighter one, or the
step is invisible. On a dark garment that is a small number; on a light one it is
large, which is why light-armoured figures need bolder markings than robed ones.

---

## 5. Detail budget follows voxel count

Cube resolution is to voxel art what canvas size is to pixel art. Consistent
voxel density across a set is the rule that makes a set look like a set — "keep
one cube size throughout".

Every model in a style is the base body or a clean multiple of it, and each rung
carries its own budget, because what a model can hold is set by how many voxels
it has. Painting a ×2 model like a ×1 leaves it empty; painting a ×1 like a ×2
turns it to mush.

---

## 6. What is enforced, and what is taught

Checks catch what is measurable. They are a *filter* — they reject bad output,
they do not make the generator produce good output.

What actually moves quality is the **worked example**. Measured, in this project:
a prompt rule saying "leave a row of skin between brow and eyes" was ignored,
while making the same change in the reference example propagated to the next
generation immediately. The model copies the example faithfully — including its
flaws.

> Prefer teaching a behaviour by improving an example over adding a rule.
> Add a check when the thing is a number, not a taste.

---

## Sources

- [Saint11 — Cluster Sketching and Painting](https://saint11.art/pixel_art_articles/article2/) — clusters, orphan pixels, jaggies, step progression
- [Saint11 — Consistency](https://saint11.art/blog/consistency/) — settling scale, proportion and palette rules up front
- [Arne (androidarts) — Pixel Art Tutorial](https://androidarts.com/pixtut/pixelart.htm) — ramps, hue shifting, banding, islands of detail, highlight discipline
- [the-pixel.art — How Isometric Pixel Art Works (the 2:1 Trick)](https://the-pixel.art/articles/isometric-pixel-art/) — consistent step ratios along an edge
- [Pedro Medeiros — Basic Shading](https://medium.com/pixel-grimoire/how-to-start-making-pixel-art-4-f57f51dcfa02) and [Anti-Alias and Banding](https://medium.com/pixel-grimoire/how-to-start-making-pixel-art-4-ff4bfcd2d085)
- [Game Developer — Voxel Art: Reducing the Greebles](https://www.gamedeveloper.com/design/voxel-art-reducing-the-greebles) — why small protruding detail hurts a voxel model
- [Pixel Art for 3D: MagicaVoxel for Scalable 3D Game Art](https://sites.psu.edu/zaczidik/2025/02/08/pixel-art-for-3d-why-magicavoxel-might-be-the-best-choice-for-scalable-3d-game-art/) — cube resolution as the primary lever, one cube size throughout
- [The Pixel Artist — Top Ten Things New Pixel Artists Should Know](https://www.the-pixel-artist.com/articles/top-ten-things-new-pixel-artists-should-know)
