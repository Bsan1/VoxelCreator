/**
 * The lighting model, and the noise floor it creates.
 *
 * This lives in `core` rather than in the renderer because the validator needs
 * it too. A face's brightness depends on which way it points, so one colour
 * covers a *range* of rendered values — and any marking quieter than that range
 * is not read as paint, it is read as a change in lighting. Every contrast rule
 * in this project is measured against that floor rather than against a number
 * somebody picked.
 */

export type Vec3f = readonly [number, number, number];

function norm(v: Vec3f): Vec3f {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Over the viewer's shoulder and above, so the three visible faces differ. */
export const LIGHT_DIR: Vec3f = norm([0.45, 0.8, 0.4]);

/** Flat ambient term, so faces turned away from the light are not black. */
export const AMBIENT = 0.55;
/** How much of the brightness the lambert term controls. */
export const DIFFUSE = 0.45;

/** Brightness multiplier for a face with this normal. */
export function shadeFor(nx: number, ny: number, nz: number): number {
  const ndl = nx * LIGHT_DIR[0] + ny * LIGHT_DIR[1] + nz * LIGHT_DIR[2];
  return AMBIENT + DIFFUSE * Math.max(0, ndl);
}

/** The six axis-aligned face normals a voxel can present. */
const FACE_NORMALS: Vec3f[] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/**
 * How far one colour can drift from lighting alone, as a fraction of itself.
 *
 * Computed from the face normals rather than written down, so changing the light
 * moves every contrast rule with it. With the current light it is 0.36: the top
 * face renders at 0.910 and any face turned away sits at the 0.550 ambient.
 */
export const SHADING_SPREAD: number = (() => {
  const shades = FACE_NORMALS.map((n) => shadeFor(n[0], n[1], n[2]));
  return Math.max(...shades) - Math.min(...shades);
})();

/**
 * The smallest colour distance that reads as paint on this surface.
 *
 * Scales with the surface, because the drift does: on near-black a difference of
 * 20 is obvious, while on polished steel the same 20 is well inside the range
 * the surface already covers by being lit. A fixed threshold passed a knight
 * whose highlight sat 38 from a surface that drifts 74, and it was invisible.
 */
export function contrastFloorFor(luminance: number, absoluteFloor: number): number {
  return Math.max(absoluteFloor, SHADING_SPREAD * luminance);
}

/** Rec. 709 luminance of an 8-bit colour. */
export function luminanceOf(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
