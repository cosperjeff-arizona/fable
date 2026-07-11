// The ~200-concept master list, organized by semantic domain, plus a small
// curated table of compounds/derivations for the concepts that don't get
// their own root (see src/lexicon.ts).
//
// The 32 "core" concepts are exactly prototype/etymon.mjs's CONCEPTS list —
// kept as roots, matching how the prototype treats them.
//
// Domain counts (rough, per specs/M1.md): nature 40, body 25, kinship 15,
// animals 20, plants/food 20, artifacts/tools 20, society/power 15,
// actions 25, qualities 15, abstract 5. Total: 200.

export type Domain =
  | 'nature'
  | 'body'
  | 'kinship'
  | 'animals'
  | 'plants/food'
  | 'artifacts/tools'
  | 'society/power'
  | 'actions'
  | 'qualities'
  | 'abstract';

export type Concept = { id: string; domain: Domain; core: boolean };

/** Derivation of a compound: concatenation of two other concepts' roots. */
export type CompoundDerivation = { kind: 'compound'; parts: readonly [string, string] };

/** Derivation of a word by attaching a derivational affix to another
 * concept's root. `affix` names a role from the derivational affix set
 * generated in src/lexicon.ts (see AFFIX ROLE NOTE below). */
export type AffixDerivation = { kind: 'affix'; root: string; affix: string };

export type Derivation = CompoundDerivation | AffixDerivation;

// AFFIX ROLE NOTE: this table references the 'negation' and 'adjective-izer'
// derivational roles by name. src/lexicon.ts guarantees both of those roles
// are always generated (on top of the 1-3 other, randomly-chosen roles),
// specifically so this table always resolves. See lexicon.ts for the roles.

const CORE_IDS = [
  'water', 'fire', 'sun', 'moon', 'star', 'sky', 'earth', 'stone', 'tree', 'river',
  'mountain', 'fish', 'bird', 'dog', 'wolf', 'snake', 'eye', 'hand', 'blood', 'heart',
  'tongue', 'man', 'woman', 'child', 'people', 'house', 'road', 'king', 'name', 'night',
  'ice', 'salt',
] as const;

const CORE = new Set<string>(CORE_IDS);

function domainBlock(domain: Domain, ids: readonly string[]): Concept[] {
  return ids.map((id) => ({ id, domain, core: CORE.has(id) }));
}

const NATURE = [
  'water', 'fire', 'sun', 'moon', 'star', 'sky', 'earth', 'stone', 'sand', 'dust',
  'mountain', 'hill', 'valley', 'river', 'lake', 'sea', 'rain', 'snow', 'ice', 'wind',
  'cloud', 'thunder', 'lightning', 'day', 'night', 'morning', 'evening', 'year', 'season', 'spring_season',
  'summer', 'winter', 'autumn', 'shadow', 'light', 'dark', 'smoke', 'ash', 'mud', 'forest',
] as const;

const BODY = [
  'eye', 'ear', 'nose', 'mouth', 'tongue', 'tooth', 'hair', 'head', 'hand', 'arm',
  'finger', 'foot', 'leg', 'knee', 'heart', 'blood', 'bone', 'skin', 'belly', 'neck',
  'back', 'breast', 'liver', 'breath', 'voice',
] as const;

const KINSHIP = [
  'man', 'woman', 'child', 'mother', 'father', 'brother', 'sister', 'son', 'daughter', 'husband',
  'wife', 'grandmother', 'grandfather', 'friend', 'kin',
] as const;

const ANIMALS = [
  'fish', 'bird', 'dog', 'wolf', 'snake', 'deer', 'bear', 'horse', 'cow', 'sheep',
  'goat', 'pig', 'mouse', 'fox', 'eagle', 'owl', 'insect', 'bee', 'ant', 'worm',
] as const;

const PLANTS_FOOD = [
  'tree', 'grass', 'leaf', 'root_plant', 'flower', 'fruit', 'seed', 'bark', 'wood', 'thorn',
  'salt', 'meat', 'milk', 'egg', 'honey', 'bread', 'fat', 'berry', 'mushroom', 'reed',
] as const;

const ARTIFACTS = [
  'house', 'road', 'boat', 'wheel', 'knife', 'spear', 'bow', 'arrow', 'axe', 'rope',
  'net', 'pot', 'cloth', 'needle', 'hearth', 'roof', 'wall', 'door', 'bridge', 'iron',
] as const;

const SOCIETY = [
  'king', 'law', 'war', 'peace', 'people', 'tribe', 'chief', 'slave', 'enemy', 'gift',
  'trade', 'song', 'dance', 'feast', 'god',
] as const;

const ACTIONS = [
  'eat', 'drink', 'sleep', 'die', 'see', 'hear', 'give', 'take', 'go', 'come',
  'make', 'cut', 'burn', 'speak', 'know', 'run', 'walk', 'swim', 'fly_verb', 'fall',
  'sit', 'stand', 'kill', 'hunt', 'bind',
] as const;

const QUALITIES = [
  'big', 'small', 'old', 'new', 'good', 'bad', 'hot', 'cold', 'long', 'heavy',
  'deep', 'sharp', 'round', 'white', 'black',
] as const;

const ABSTRACT = ['spirit', 'dream', 'name', 'luck', 'death'] as const;

export const CONCEPTS: Concept[] = [
  ...domainBlock('nature', NATURE),
  ...domainBlock('body', BODY),
  ...domainBlock('kinship', KINSHIP),
  ...domainBlock('animals', ANIMALS),
  ...domainBlock('plants/food', PLANTS_FOOD),
  ...domainBlock('artifacts/tools', ARTIFACTS),
  ...domainBlock('society/power', SOCIETY),
  ...domainBlock('actions', ACTIONS),
  ...domainBlock('qualities', QUALITIES),
  ...domainBlock('abstract', ABSTRACT),
];

/**
 * ~30 concepts that are compounds or affix-derivations rather than their
 * own roots, e.g. sea = water + big (cf. DESIGN.md's "night-sun for moon"
 * style examples), enemy = friend + negation.
 *
 * Every `parts`/`root` reference here points at a concept that itself has
 * a root (never at another entry of this table), except `shadow`, whose
 * second part `dark` is itself affix-derived — src/lexicon.ts resolves
 * roots, then affix-derivations, then compounds, in that order, so this
 * one level of chaining is safe.
 */
export const DERIVATIONS: ReadonlyMap<string, Derivation> = new Map<string, Derivation>([
  ['sea', { kind: 'compound', parts: ['water', 'big'] }],
  ['ash', { kind: 'compound', parts: ['fire', 'dust'] }],
  ['hearth', { kind: 'compound', parts: ['fire', 'house'] }],
  ['lightning', { kind: 'compound', parts: ['fire', 'sky'] }],
  ['bread', { kind: 'compound', parts: ['seed', 'fire'] }],
  ['iron', { kind: 'compound', parts: ['stone', 'fire'] }],
  ['grandmother', { kind: 'compound', parts: ['mother', 'old'] }],
  ['grandfather', { kind: 'compound', parts: ['father', 'old'] }],
  ['bridge', { kind: 'compound', parts: ['river', 'road'] }],
  ['tribe', { kind: 'compound', parts: ['people', 'kin'] }],
  ['slave', { kind: 'compound', parts: ['war', 'take'] }],
  ['trade', { kind: 'compound', parts: ['gift', 'road'] }],
  ['feast', { kind: 'compound', parts: ['eat', 'song'] }],
  ['thorn', { kind: 'compound', parts: ['tree', 'tooth'] }],
  ['berry', { kind: 'compound', parts: ['tree', 'fruit'] }],
  ['wall', { kind: 'compound', parts: ['stone', 'house'] }],
  ['roof', { kind: 'compound', parts: ['wood', 'house'] }],
  ['shadow', { kind: 'compound', parts: ['sun', 'dark'] }],
  ['valley', { kind: 'compound', parts: ['river', 'mountain'] }],
  ['knife', { kind: 'compound', parts: ['stone', 'cut'] }],
  ['enemy', { kind: 'affix', root: 'friend', affix: 'negation' }],
  ['peace', { kind: 'affix', root: 'war', affix: 'negation' }],
  ['bad', { kind: 'affix', root: 'good', affix: 'negation' }],
  ['small', { kind: 'affix', root: 'big', affix: 'negation' }],
  ['cold', { kind: 'affix', root: 'hot', affix: 'negation' }],
  ['black', { kind: 'affix', root: 'white', affix: 'negation' }],
  ['dark', { kind: 'affix', root: 'light', affix: 'negation' }],
  ['new', { kind: 'affix', root: 'old', affix: 'negation' }],
  ['sharp', { kind: 'affix', root: 'stone', affix: 'adjective-izer' }],
  ['round', { kind: 'affix', root: 'moon', affix: 'adjective-izer' }],
]);
