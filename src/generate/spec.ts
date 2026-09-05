import type { Detail, Part, SceneKind, VoxelScene } from '../core/types.js';

/**
 * What a generating model is asked to emit.
 *
 * There is no character preset: every model is one main mass plus whatever is
 * anchored to it. The art direction — keep the silhouette close to a single
 * rectangular prism — lives in the prompt, not in a fixed skeleton, so a
 * figure in a dress and a figure in armour are the same kind of object here.
 */
export interface GenSpec {
  name: string;
  /** Defaults to "character". */
  kind?: SceneKind;
  /** The main mass everything else anchors to. */
  root: Part;
  /** Further masses and shallow relief, each anchored to a parent. */
  parts?: Part[];
  /** Painted regions: face, clothing, trim, markings. */
  details?: Detail[];
}

export function specToScene(spec: GenSpec): VoxelScene {
  if (!spec?.name) throw new Error('spec.name is required');
  if (!spec.root?.id) throw new Error('spec.root with an id is required');
  if (spec.root.parent || spec.root.mirrorOf) {
    throw new Error(`Root part "${spec.root.id}" must not have a parent or mirrorOf`);
  }

  const scene: VoxelScene = {
    name: spec.name,
    kind: spec.kind ?? 'character',
    root: spec.root.id,
    parts: [spec.root],
    details: [...(spec.details ?? [])],
  };

  const seen = new Set([spec.root.id]);
  for (const p of spec.parts ?? []) {
    if (seen.has(p.id)) throw new Error(`Duplicate part id from generator: ${p.id}`);
    seen.add(p.id);
    scene.parts.push(p);
  }

  // Keep the spec with the scene: a later revision can edit the compact spec
  // rather than reverse-engineering an expanded part hierarchy.
  scene.meta = { genSpec: spec };
  return scene;
}

/**
 * The inverse: read a saved scene back as a spec.
 *
 * Revision works off this rather than the `genSpec` stored in meta, because the
 * scene is the source of truth — it may have been edited through the MCP tools
 * or produced by attaching an item, in which case the stored spec is stale or
 * absent.
 */
export function sceneToSpec(scene: VoxelScene): GenSpec {
  const root = scene.parts.find((p) => p.id === scene.root);
  if (!root) throw new Error(`Scene "${scene.name}" has no root part "${scene.root}"`);
  return {
    name: scene.name,
    kind: scene.kind ?? 'character',
    root,
    parts: scene.parts.filter((p) => p.id !== scene.root),
    details: scene.details,
  };
}

/**
 * Pull the JSON object out of a model's reply. Models often wrap it in a fence
 * or a sentence, so scan for the first balanced object rather than trusting the
 * whole response to parse.
 */
export function extractJson(raw: string): GenSpec {
  return extractJsonObject(raw) as unknown as GenSpec;
}

/** Same scan, untyped — a revision reply is an op list, not a GenSpec. */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], raw].filter((s): s is string => Boolean(s));

  for (const text of candidates) {
    const start = text.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    let inStr = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
          } catch {
            break; // try the next candidate
          }
        }
      }
    }
  }
  throw new Error(`No parsable JSON object in model output:\n${raw.slice(0, 600)}`);
}
