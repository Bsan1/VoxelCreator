/**
 * Semantic scene format. This — not the voxel grid — is the canonical
 * representation an agent reads and edits. Revisions ("longer arms") are
 * small edits here, then a full deterministic rebuild.
 *
 * Coordinate convention (internal): +X right, +Y up, +Z front. Y-up matches
 * three.js; the .vox writer converts to MagicaVoxel's Z-up on export.
 */

export type Hex = string;
export type Vec3 = [number, number, number];

/** Face of the parent that a child attaches to. */
export type AnchorFace = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back' | 'center';

/** Placement on an axis that the anchor face doesn't pin. */
export type Align = 'min' | 'center' | 'max';

export interface Anchor {
  to: AnchorFace;
  alignX?: Align;
  alignY?: Align;
  alignZ?: Align;
}

export type ShapeKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'pyramid';

export interface Part {
  id: string;
  /** [width, height, depth] in voxels. */
  size: Vec3;
  color: Hex;
  shape?: ShapeKind;
  /** Parent part id. Omit for the root. */
  parent?: string;
  anchor?: Anchor;
  /** Nudge applied after anchoring, in voxels. */
  offset?: Vec3;
  /**
   * Marks this part as the mirror image of another across the scene's
   * symmetry plane. Its size/color/details are inherited from the source,
   * so a left arm can never drift out of sync with the right one.
   */
  mirrorOf?: string;
  tags?: string[];
  /** Carve out the interior, leaving a 1-voxel shell. */
  hollow?: boolean;
}

/** A painted region in part-local coordinates (inclusive bounds). */
export interface Detail {
  id?: string;
  part: string;
  region: [number, number, number, number, number, number];
  color: Hex;
  /** Also paint the X-mirrored region within the same part (eyes, pockets). */
  mirror?: boolean;
}

/**
 * A named mounting point on a character. Equipment is generated as its own
 * scene and attached here, so a sword is a reusable model rather than geometry
 * welded into one character.
 */
export interface Socket {
  id: string;
  /** Part on the character the item anchors to. */
  parent: string;
  anchor: Anchor;
  offset?: Vec3;
}

/**
 * Characters and the equipment they carry are judged differently: a character
 * must read as one standing prism, while a sword is legitimately a thin slab
 * that never touches the ground. An "assembly" is a character with equipment
 * attached — it still has to stand, but its silhouette is expected to break the
 * prism, since that is what a drawn sword does.
 */
export type SceneKind = 'character' | 'item' | 'assembly';

/**
 * Manual voxel touch-ups, applied after the scene is built.
 *
 * The scene is semantic — parts and painted regions — so "put a voxel here"
 * has nowhere to live in it. Keeping hand edits as an explicit layer on top
 * means the model stays revisable: regenerate or resize the parts and these
 * still apply, and dropping the layer restores exactly what the generator made.
 */
export interface VoxelEdits {
  /** [x, y, z, hex] in final grid coordinates. */
  added: Array<[number, number, number, string]>;
  /** [x, y, z] cleared after the build. */
  removed: Array<[number, number, number]>;
}

export interface VoxelScene {
  name: string;
  /** Defaults to "character" when absent. */
  kind?: SceneKind;
  /** Part id everything else hangs off. */
  root: string;
  parts: Part[];
  details: Detail[];
  /** Mounting points for equipment. Characters have them; items do not. */
  sockets?: Socket[];
  /** Hand edits layered over the built voxels. */
  edits?: VoxelEdits;
  meta?: Record<string, unknown>;
}

/** A part with its resolved world-space min corner. */
export interface PlacedPart {
  part: Part;
  /** Effective size after mirror inheritance. */
  size: Vec3;
  /** Min corner in world voxel space. */
  pos: Vec3;
  /** True if this part was produced by mirroring; its local X is flipped. */
  mirrored: boolean;
  /** Part whose size/color/details this one inherits (itself, unless mirrored). */
  sourceId: string;
}
