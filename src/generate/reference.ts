import type { GenSpec } from './spec.js';

/**
 * Finished models, shown to the generator as examples.
 *
 * The prompt described the house style in about 3,000 tokens of prose and never
 * once showed a completed figure, which is why it kept accumulating rules: every
 * failure was answered with another paragraph, and prose generalises badly. An
 * example generalises well, and it teaches things the prose was getting wrong —
 * the priest below wraps the whole head band on all four sides where the text
 * said to paint the face on the front only, and caps it with a hat the body's
 * own width where the text prescribed a three-tier shrinking stack.
 *
 * It also teaches faithfully, flaws included. The first version had the brow
 * directly above the eyes; a generation copied that exactly and came out looking
 * like it was wearing a visor, while a prompt rule saying to leave a gap was
 * ignored. Fixing the example fixed the output. **Prefer teaching a behaviour by
 * improving an example over adding a rule.**
 *
 * `npm run test:mcp` validates every reference, so one cannot quietly stop being
 * worth copying.
 */
export interface Reference {
  id: string;
  /** The brief this model is an answer to. */
  brief: string;
  spec: GenSpec;
  /**
   * Words that make this the right example for a request. A batch of six
   * generations came out well for every cloth-and-skin subject and badly for the
   * two that were metal — an armoured knight and a machine — because the only
   * example was a robed figure and nothing showed how to make a monochrome
   * subject read. Match the example to the archetype.
   *
   * Turkish terms are listed too: requests arrive in either language, and a
   * Turkish one would otherwise always fall through to the default.
   */
  keywords: string[];
  /** What to take from it, in prose, shown under the JSON. */
  notes: string;
}

const ROBED_PRIEST: Reference = {
  id: 'robed_priest',
  brief: 'an orthodox priest in deep red robes with a white beard',
  keywords: [
    'robe', 'robes', 'priest', 'monk', 'cleric', 'bishop', 'wizard', 'mage',
    'sorcerer', 'witch', 'cloak', 'gown', 'dress', 'tunic', 'cape', 'skirt',
    'peasant', 'villager', 'merchant', 'scholar', 'druid', 'shaman', 'king',
    'queen', 'noble',
    'cübbe', 'rahip', 'papaz', 'keşiş', 'büyücü', 'sihirbaz', 'cadı', 'pelerin',
    'elbise', 'kral', 'kraliçe', 'köylü', 'tüccar',
  ],
  spec: {
    name: 'reference_priest',
    kind: 'character',
    root: { id: 'body', size: [12, 24, 12], color: '#8b1a2a' },
    parts: [
      {
        id: 'cap',
        size: [12, 4, 12],
        color: '#4a1420',
        parent: 'body',
        anchor: { to: 'top', alignX: 'center', alignZ: 'center' },
        offset: [0, -1, 0],
        shape: 'box',
      },
    ],
    details: [
      { id: 'head_fill', part: 'body', region: [0, 16, 0, 11, 22, 11], color: '#e0ac69' },
      { id: 'collar', part: 'body', region: [0, 15, 0, 11, 16, 11], color: '#f2ede1' },
      // One row of skin (y 20) is left between brow and eyes on purpose. Without
      // it the two dark bands merge into a single bar and the figure looks like
      // it is wearing a visor — and a generation copied that flaw straight out of
      // this example, which is the clearest evidence there is that the example
      // teaches harder than the rules do.
      { id: 'brow', part: 'body', region: [2, 21, 11, 9, 21, 11], color: '#5c3a24' },
      { id: 'eyes', part: 'body', region: [3, 18, 11, 4, 19, 11], color: '#2a1f1a', mirror: true },
      { id: 'beard', part: 'body', region: [4, 16, 11, 7, 17, 11], color: '#d8d3c9' },
      { id: 'robe_chest_v', part: 'body', region: [5, 6, 11, 6, 14, 11], color: '#c9a227' },
      { id: 'robe_chest_h', part: 'body', region: [3, 12, 11, 8, 13, 11], color: '#c9a227' },
      { id: 'sash_waist', part: 'body', region: [0, 8, 0, 11, 9, 11], color: '#c9a227' },
      { id: 'arm_r', part: 'body', region: [10, 5, 11, 11, 15, 11], color: '#6e1420', mirror: true },
      { id: 'hem', part: 'body', region: [0, 0, 0, 11, 1, 11], color: '#3a0e15' },
      { id: 'cap_trim', part: 'cap', region: [0, 0, 0, 11, 0, 11], color: '#c9a227' },
    ],
  },
  notes: `  ONE BOX. The whole figure is a single 12x24x12 mass plus one cap. Everything
  else — face, beard, robe, cross, sash, arms, hem — is PAINTED. Eleven of the
  twelve markings sit on that one part.

  THE HEAD IS PAINTED, NOT BUILT. "head_fill" wraps the top third in skin on
  ALL FOUR SIDES (z 0 to 11), not just the front. That single region is what
  makes a block read as a head; the features go on top of it afterwards, and
  the white collar underneath separates head from body.

  FEATURES SIT IN MID-TONES ON THE SKIN, AND THEY DO NOT TOUCH. The brow is
  brown, not black; the beard is bone. The brow is at y 21 and the eyes at
  y 18-19, so a row of skin sits between them. Features that touch merge into
  one dark bar.

  THE HAT MATCHES THE BODY'S WIDTH. It is one cap, 12 wide on a 12-wide body,
  sunk one voxel in. It is not a stack of shrinking blocks.

  THE PALETTE HAS RANGE. Robe #8b1a2a, arms #6e1420, hem #3a0e15, cap #4a1420,
  gold #c9a227, skin #e0ac69, collar #f2ede1. Related, but each step is a step
  you can see. That is what makes the paint read at all.

  SYMMETRY IS DECLARED, NOT REPEATED. The right arm and the right eye carry
  "mirror": true and the left ones are never written.`,
};

const PLATED_KNIGHT: Reference = {
  id: 'plated_knight',
  brief: 'a knight in polished steel plate armour with a red crest',
  keywords: [
    'armour', 'armor', 'knight', 'plate', 'steel', 'iron', 'metal', 'chrome',
    'robot', 'machine', 'mech', 'android', 'droid', 'automaton', 'golem',
    'helmet', 'helm', 'soldier', 'guard', 'trooper', 'samurai', 'paladin',
    'skeleton', 'stone', 'statue', 'brass', 'copper', 'rusty',
    'zırh', 'zırhlı', 'şövalye', 'miğfer', 'asker', 'muhafız', 'çelik',
    'demir', 'metal', 'makine', 'heykel', 'taş', 'paslı',
  ],
  spec: {
    name: 'reference_knight',
    kind: 'character',
    root: { id: 'body', size: [12, 26, 12], color: '#3f434b' },
    parts: [
      {
        id: 'helmet',
        size: [12, 4, 12],
        color: '#6e7480',
        parent: 'body',
        anchor: { to: 'top', alignX: 'center', alignZ: 'center' },
        offset: [0, -1, 0],
        shape: 'box',
      },
      {
        id: 'crest',
        size: [2, 6, 7],
        color: '#9e1b24',
        parent: 'helmet',
        anchor: { to: 'top', alignX: 'center', alignZ: 'center' },
        offset: [0, -1, 0],
        shape: 'box',
      },
    ],
    details: [
      { id: 'head_fill', part: 'body', region: [0, 17, 0, 11, 25, 11], color: '#5a6068' },
      { id: 'gorget', part: 'body', region: [0, 16, 0, 11, 16, 11], color: '#b8bec8' },
      { id: 'visor_brow', part: 'body', region: [2, 21, 11, 9, 21, 11], color: '#3f434b' },
      { id: 'eye_slit', part: 'body', region: [3, 19, 11, 4, 19, 11], color: '#101214', mirror: true },
      { id: 'breastplate', part: 'body', region: [1, 7, 11, 10, 15, 11], color: '#c9ced6' },
      { id: 'chest_ridge', part: 'body', region: [5, 7, 11, 6, 15, 11], color: '#dfe4ea' },
      { id: 'pauldron_r', part: 'body', region: [9, 12, 0, 11, 16, 11], color: '#c9ced6', mirror: true },
      { id: 'belt', part: 'body', region: [0, 6, 0, 11, 7, 11], color: '#c9a227' },
      { id: 'tasset', part: 'body', region: [1, 1, 11, 10, 5, 11], color: '#6e7480' },
      { id: 'greave_trim', part: 'body', region: [0, 0, 0, 11, 0, 11], color: '#4a4e56' },
      { id: 'helmet_trim', part: 'helmet', region: [0, 0, 0, 11, 0, 11], color: '#c9a227' },
      { id: 'underarm_shadow', part: 'body', region: [9, 12, 0, 11, 15, 3], color: '#101214', mirror: true },
      { id: 'waist_shadow', part: 'body', region: [0, 6, 0, 11, 6, 11], color: '#16181b' },
      { id: 'breastplate_rivets', part: 'body', region: [1, 8, 11, 1, 14, 11], color: '#dfe4ea', mirror: true },
      { id: 'chest_fuller_h', part: 'body', region: [2, 11, 11, 9, 12, 11], color: '#dfe4ea' },
      { id: 'greave_center', part: 'body', region: [4, 1, 0, 7, 5, 11], color: '#101214' },
      { id: 'greave_steel', part: 'body', region: [1, 1, 0, 3, 5, 11], color: '#c9ced6', mirror: true },
      { id: 'belt_seam', part: 'body', region: [0, 5, 0, 11, 5, 11], color: '#c9a227' },
    ],
  },
  notes: `  A SUBJECT WITH NO SKIN STILL NEEDS ITS HEAD BAND FILLED. "head_fill" wraps
  the top third in helmet steel on all four sides, exactly as the priest wraps
  his in skin, and the visor slot and brow go on top of it.

  ONE HUE, SEVEN VALUES — THIS IS THE WHOLE LESSON FOR A METAL OR MONOCHROME
  SUBJECT. Near-black #101214 in the recesses, #16181b at the waist, dark steel
  #3f434b for the body, #5a6068 for the head, #6e7480 for the helmet, polished
  #b8bec8 and #c9ced6 for the plate, #dfe4ea for the highlight on the ridge.
  Painting grey trim on a grey body in a nearby grey is the same as painting
  nothing: a knight built that way came back as a featureless slab that passed
  every structural check. Every value here is a step you can see.

  ONE SATURATED ACCENT, USED SPARINGLY. Gold #c9a227 at the belt and helmet
  rim, red #9e1b24 for the crest. Nothing else is coloured.

  SHADOW IS A MARKING. "underarm_shadow" and "waist_shadow" are painted in the
  darkest value to carve the plate into pieces. This is how a single box gets
  depth without a single extra part.

  THE LOWER THIRD IS NOT LEFT BARE. A dark centre panel with polished steel to
  either side breaks the legs up. A bare block below the belt is the most
  common way one of these ends up looking like a postbox.

  A CREST IS A FLAT BLADE. It is 2 wide, 6 tall and 7 deep — thin in ONE axis,
  running front to back. A 2x2 nub reads as nothing, and a cone in a 2-deep box
  tapers away to nothing at all.`,
};

export const REFERENCES: Reference[] = [ROBED_PRIEST, PLATED_KNIGHT];

/**
 * The example to show for this request. Defaults to the robed figure, which is
 * the broader case; a request that names armour, metal or machinery gets the
 * knight, because that is the archetype the robed example teaches badly.
 */
export function pickReference(userPrompt: string): Reference {
  const words = new Set(userPrompt.toLowerCase().match(/[\p{L}]+/gu) ?? []);
  let best = REFERENCES[0];
  let bestHits = 0;
  for (const ref of REFERENCES) {
    const hits = ref.keywords.filter((k) => words.has(k)).length;
    if (hits > bestHits) {
      best = ref;
      bestHits = hits;
    }
  }
  return best;
}

/** The chosen example as it appears in the prompt: brief, JSON, then the notes. */
export function referenceBlock(userPrompt: string): string {
  const ref = pickReference(userPrompt);
  return `=== A FINISHED MODEL ===

This is a complete answer to the brief "${ref.brief}". Read it before you write
yours: it is the house style, and it is worth more than any rule below.

${JSON.stringify(ref.spec, null, 2)}

What to take from it:

${ref.notes}

Your model is a different character with different proportions and a different
palette. Take the approach, not the numbers.`;
}
