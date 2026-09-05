import type { Detail, Part, VoxelScene } from '../core/types.js';

/**
 * Revision as a list of edits rather than a rewritten model.
 *
 * Asking for the complete updated JSON made the model re-emit every part and
 * every painted region to change one colour — measured at ~3.5k output tokens
 * for a one-line request, and output is the expensive half of a call. An op
 * list for the same edit is a few dozen tokens.
 */
export type RevisionOp =
  | { op: 'set_part'; id: string } & Partial<Omit<Part, 'id'>>
  | { op: 'add_part'; part: Part }
  | { op: 'remove_part'; id: string }
  | { op: 'set_detail'; id: string } & Partial<Omit<Detail, 'id'>>
  | { op: 'add_detail'; detail: Detail }
  | { op: 'remove_detail'; id: string }
  | { op: 'replace_color'; from: string; to: string };

export interface PatchResult {
  scene: VoxelScene;
  applied: string[];
}

const norm = (hex: string) => hex.trim().toLowerCase().replace(/^#/, '');

/**
 * Apply edits to a copy of the scene. Every op that names something missing
 * throws with the available ids, so a wrong reference comes back to the model
 * as a specific defect rather than silently doing nothing.
 */
export function applyOps(scene: VoxelScene, ops: RevisionOp[]): PatchResult {
  const next: VoxelScene = JSON.parse(JSON.stringify(scene)) as VoxelScene;
  const applied: string[] = [];

  const partIds = () => next.parts.map((p) => p.id).join(', ');
  const detailIds = () => next.details.map((d) => d.id ?? '(unnamed)').join(', ');

  for (const raw of ops) {
    const op = raw as RevisionOp & Record<string, unknown>;
    switch (op.op) {
      case 'set_part': {
        const part = next.parts.find((p) => p.id === op.id);
        if (!part) throw new Error(`set_part: no part "${op.id}". Parts: ${partIds()}`);
        const changed: string[] = [];
        for (const key of ['size', 'color', 'shape', 'anchor', 'offset', 'parent', 'mirrorOf', 'hollow', 'tags'] as const) {
          if (op[key] === undefined) continue;
          (part as unknown as Record<string, unknown>)[key] = op[key];
          changed.push(key);
        }
        applied.push(`${op.id}: ${changed.join(', ') || 'no change'}`);
        break;
      }
      case 'add_part': {
        if (!op.part?.id) throw new Error('add_part: needs a "part" object with an id');
        if (next.parts.some((p) => p.id === op.part.id)) {
          throw new Error(`add_part: "${op.part.id}" already exists`);
        }
        next.parts.push(op.part);
        applied.push(`+part ${op.part.id}`);
        break;
      }
      case 'remove_part': {
        if (op.id === next.root) throw new Error(`remove_part: cannot remove the root "${op.id}"`);
        if (!next.parts.some((p) => p.id === op.id)) {
          throw new Error(`remove_part: no part "${op.id}". Parts: ${partIds()}`);
        }
        // Cascade, so nothing is left pointing at a missing parent.
        const doomed = new Set([op.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const p of next.parts) {
            if (doomed.has(p.id)) continue;
            if ((p.parent && doomed.has(p.parent)) || (p.mirrorOf && doomed.has(p.mirrorOf))) {
              doomed.add(p.id);
              grew = true;
            }
          }
        }
        next.parts = next.parts.filter((p) => !doomed.has(p.id));
        next.details = next.details.filter((d) => !doomed.has(d.part));
        applied.push(`-part ${[...doomed].join(', ')}`);
        break;
      }
      case 'set_detail': {
        const detail = next.details.find((d) => d.id === op.id);
        if (!detail) throw new Error(`set_detail: no detail "${op.id}". Details: ${detailIds()}`);
        const changed: string[] = [];
        for (const key of ['part', 'region', 'color', 'mirror'] as const) {
          if (op[key] === undefined) continue;
          (detail as unknown as Record<string, unknown>)[key] = op[key];
          changed.push(key);
        }
        applied.push(`${op.id}: ${changed.join(', ') || 'no change'}`);
        break;
      }
      case 'add_detail': {
        if (!op.detail?.part) throw new Error('add_detail: needs a "detail" object with a part');
        if (!next.parts.some((p) => p.id === op.detail.part)) {
          throw new Error(`add_detail: no part "${op.detail.part}". Parts: ${partIds()}`);
        }
        next.details = next.details.filter((d) => !op.detail.id || d.id !== op.detail.id);
        next.details.push(op.detail);
        applied.push(`+detail ${op.detail.id ?? '(unnamed)'} on ${op.detail.part}`);
        break;
      }
      case 'remove_detail': {
        const before = next.details.length;
        next.details = next.details.filter((d) => d.id !== op.id);
        if (next.details.length === before) {
          throw new Error(`remove_detail: no detail "${op.id}". Details: ${detailIds()}`);
        }
        applied.push(`-detail ${op.id}`);
        break;
      }
      case 'replace_color': {
        // Recolouring everything that shares a shade is the single most common
        // revision, and as one op it costs a dozen tokens.
        const from = norm(op.from);
        let hits = 0;
        for (const p of next.parts) {
          if (norm(p.color) === from) { p.color = op.to; hits++; }
        }
        for (const d of next.details) {
          if (norm(d.color) === from) { d.color = op.to; hits++; }
        }
        if (hits === 0) throw new Error(`replace_color: nothing uses "${op.from}"`);
        applied.push(`recolour ${op.from} -> ${op.to} (${hits})`);
        break;
      }
      default:
        throw new Error(`Unknown op "${(op as { op: string }).op}"`);
    }
  }

  return { scene: next, applied };
}
