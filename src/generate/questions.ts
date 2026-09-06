/**
 * Ask before building.
 *
 * A one-line prompt underspecifies a model, and the generator fills the gaps
 * generically — which is how "a wizard" comes back as a coloured post with a
 * flat slab for a hat. Nothing in the pipeline could fix that, because nothing
 * knew what was wanted. A short round of questions turns the request into
 * something specific enough to build from, and costs one cheap call.
 */

export interface Question {
  id: string;
  /** The question, in the language the request was written in. */
  q: string;
  /** Two to four concrete answers, so the artist can click rather than type. */
  options: string[];
}

export function buildQuestionsPrompt(userPrompt: string): string {
  return `An artist wants a voxel model. Their request is short, and you are going to build it. Before you do, ask what you actually need to know.

REQUEST: ${userPrompt}

Ask 3 to 5 questions. Ask ONLY about things that would change what you build
and that the request does not already answer. Do not ask about anything it
already states.

The models are standing rectangular blocks: one solid mass, the face and
clothing painted onto it, at most a stepped profile and one or two small
protrusions. So the useful questions are about:

  - the palette — which two or three colours dominate
  - the silhouette — squat and wide, tall and narrow, flared at the base
  - the head — bare, hooded, helmeted, hatted, and what shape
  - the one feature that should read first from across a room
  - surface treatment — plain and clean, or layered with trim, seams, an emblem
  - what it is wearing on its torso, and whether it has a belt or sash

Do NOT ask about weapons or held items. Those are separate models, attached
later.

Write the questions in the SAME LANGUAGE as the request. Give each question 2-4
concrete options the artist can just pick — real answers, not "other" or
"you decide". Keep each option under about six words.

Reply with ONLY this JSON, no prose, no code fence:

{"questions":[
  {"id":"palette","q":"...","options":["...","...","..."]},
  {"id":"silhouette","q":"...","options":["...","..."]}
]}`;
}

/** Fold the answers into the generation prompt as settled decisions. */
export function formatAnswers(pairs: Array<{ q: string; a: string }>): string {
  const kept = pairs.filter((p) => p.a.trim().length > 0);
  if (kept.length === 0) return '';
  return `The artist has already answered these. Treat them as decided, and
build exactly what they say:

${kept.map((p) => `  ${p.q}\n    -> ${p.a}`).join('\n')}`;
}
