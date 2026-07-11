// Root generation, morphology (affixes), and compounds/derivations.

import type { Stream } from './prng.js';
import {
  type Inventory,
  type Segment,
  type Word,
  isLegalWord,
  isNearCollision,
  isVowel,
  segKey,
  wordKey,
} from './phonology.js';
import { DERIVATIONS, type Concept } from './concepts.js';
import { parse, romanize } from './romanize.js';

export type DerivationalRole = 'agent' | 'diminutive' | 'place-of' | 'negation' | 'adjective-izer';
export const ALL_DERIVATIONAL_ROLES: readonly DerivationalRole[] = [
  'agent',
  'diminutive',
  'place-of',
  'negation',
  'adjective-izer',
];
export const ALWAYS_PRESENT_DERIVATIONAL_ROLES: readonly DerivationalRole[] = ['negation', 'adjective-izer'];

export type InflectionalRole = 'plural' | 'past' | 'genitive' | 'accusative';

export type Affix = {
  role: DerivationalRole | InflectionalRole;
  kind: 'derivational' | 'inflectional';
  slot: 'prefix' | 'suffix';
  form: Segment[];
};

export type LexemeOrigin = 'root' | 'compound' | 'derived';

export type Lexeme = {
  concept: string;
  word: Word;
  origin: LexemeOrigin;
  parts?: string[];
};

export type Lexicon = {
  lexemes: Map<string, Lexeme>;
  affixes: Affix[];
};

// ------------------------------------------------------------- syllables

/** Build one syllable's segments: optional onset, a vowel nucleus, optional
 * coda. `allowOnsetless` permits a zero-consonant onset (only legal
 * word-initially). Returns null if it can't build a legal syllable (should
 * not happen with a well-formed inventory). */
function buildSyllable(
  inv: Inventory,
  stream: Stream,
  opts: { allowOnsetless: boolean; forceOnset: boolean; codaChance: number },
): Segment[] {
  const segs: Segment[] = [];
  const wantOnset = opts.forceOnset || !opts.allowOnsetless || stream.chance(0.85);
  if (wantOnset) {
    segs.push(stream.pick(inv.consonants));
  }
  segs.push(stream.pick(inv.vowels));
  if (stream.chance(opts.codaChance) && inv.phonotactics.codas.length > 0) {
    segs.push(stream.pick(inv.phonotactics.codas));
  }
  return segs;
}

function buildRootCandidate(inv: Inventory, stream: Stream): Word {
  const syllableCount = stream.weightedPick<1 | 2 | 3>([
    [1, 0.2],
    [2, 0.65],
    [3, 0.15],
  ]);
  const segments: Segment[] = [];
  for (let s = 0; s < syllableCount; s++) {
    const isFirst = s === 0;
    const isMono = syllableCount === 1;
    const syll = buildSyllable(inv, stream, {
      allowOnsetless: isFirst,
      forceOnset: isMono,
      codaChance: isMono ? 0.7 : 0.3,
    });
    segments.push(...syll);
  }
  // Stress: initial syllable, i.e. the first vowel.
  const stress = segments.findIndex(isVowel);
  return { segments, stress: stress < 0 ? 0 : stress };
}

/** A word "round-trips cleanly" if romanizing then re-parsing it reproduces
 * the same word. This is normally guaranteed by construction, but a rare
 * coda/onset adjacency (e.g. coda /s/ followed by onset /h/) can spell the
 * same digraph as another single phoneme (/ʃ/ -> "sh"); we simply reject
 * and regenerate such words rather than complicating the phonotactics. */
function roundTripsCleanly(word: Word): boolean {
  try {
    return wordKey(parse(romanize(word))) === wordKey(word);
  } catch {
    return false;
  }
}

const MAX_ROOT_ATTEMPTS = 200;

/** Generate one fresh root, legal under `inv.phonotactics`, that does not
 * collide (homophone or near-collision) with any word already in `used`,
 * and round-trips through romanize/parse. */
function generateRoot(inv: Inventory, stream: Stream, used: Word[]): Word {
  for (let attempt = 0; attempt < MAX_ROOT_ATTEMPTS; attempt++) {
    const candidate = buildRootCandidate(inv, stream);
    if (!isLegalWord(candidate, inv.phonotactics)) continue;
    if (!roundTripsCleanly(candidate)) continue;
    const key = wordKey(candidate);
    if (used.some((w) => wordKey(w) === key)) continue;
    if (used.some((w) => isNearCollision(w, candidate))) continue;
    used.push(candidate);
    return candidate;
  }
  throw new Error('generateRoot: root space exhausted (or too constrained an inventory)');
}

// -------------------------------------------------------------- morphology

const DERIVATIONAL_FORM_CODA_CHANCE = 0.2;

function buildAffixForm(inv: Inventory, stream: Stream): Segment[] {
  // 1 syllable max: optional onset, nucleus, optional coda.
  const segs: Segment[] = [];
  if (stream.chance(0.7)) segs.push(stream.pick(inv.consonants));
  segs.push(stream.pick(inv.vowels));
  if (stream.chance(DERIVATIONAL_FORM_CODA_CHANCE) && inv.phonotactics.codas.length > 0) {
    segs.push(stream.pick(inv.phonotactics.codas));
  }
  return segs;
}

function generateAffixes(inv: Inventory, stream: Stream): Affix[] {
  // A language is suffixing (85%) or prefixing (15%) as a whole.
  const slot: 'prefix' | 'suffix' = stream.chance(0.85) ? 'suffix' : 'prefix';

  // Derivational: 'negation' and 'adjective-izer' are always present because
  // src/concepts.ts's DERIVATIONS table depends on them; 1-3 more of the
  // remaining roles are added at random, for a total of 3-5.
  const optionalRoles = ALL_DERIVATIONAL_ROLES.filter((r) => !ALWAYS_PRESENT_DERIVATIONAL_ROLES.includes(r));
  const extraCount = stream.int(1, Math.min(3, optionalRoles.length));
  const extraRoles = stream.shuffle(optionalRoles).slice(0, extraCount);
  const derivationalRoles: DerivationalRole[] = [...ALWAYS_PRESENT_DERIVATIONAL_ROLES, ...extraRoles];

  // Inflectional: plural, past, genitive always; accusative 50% of the time.
  const inflectionalRoles: InflectionalRole[] = ['plural', 'past', 'genitive'];
  if (stream.chance(0.5)) inflectionalRoles.push('accusative');

  // Affix forms must be pairwise distinct: homophonous affixes across
  // paradigms would make M2's paradigm-collapse detection ambiguous.
  const usedForms = new Set<string>();
  const uniqueForm = (): Segment[] => {
    for (let tries = 0; tries < 30; tries++) {
      const form = buildAffixForm(inv, stream);
      const key = form.map(segKey).join('.');
      if (!usedForms.has(key)) {
        usedForms.add(key);
        return form;
      }
    }
    throw new Error('generateAffixes: could not find a distinct affix form');
  };

  const affixes: Affix[] = [];
  for (const role of derivationalRoles) {
    affixes.push({ role, kind: 'derivational', slot, form: uniqueForm() });
  }
  for (const role of inflectionalRoles) {
    affixes.push({ role, kind: 'inflectional', slot, form: uniqueForm() });
  }
  return affixes;
}

/** Every word this milestone builds — root, compound, or derived — carries
 * initial-syllable stress: the index of its own first vowel. (Spec-silent
 * choice: specs/M1.md only states this rule for roots; extending it
 * uniformly keeps romanize/parse's stress round-trip simple and correct,
 * and is consistent with there being no stress-shift rules yet — those
 * arrive in M2's catalog.) */
function initialStress(segments: readonly Segment[]): number {
  const idx = segments.findIndex(isVowel);
  return idx < 0 ? 0 : idx;
}

/** Attach `affix` to `lexeme`'s word, producing a new (unstored) Word. */
export function inflect(lexeme: Lexeme, affix: Affix): Word {
  const base = lexeme.word;
  const segments =
    affix.slot === 'suffix' ? [...base.segments, ...affix.form] : [...affix.form, ...base.segments];
  return { segments, stress: initialStress(segments) };
}

const MAX_COLLISION_REPAIR_ATTEMPTS = 10;

/**
 * Compounds and affix-derivations are otherwise fully deterministic
 * concatenations of already-fixed parts, so unlike roots they can't just be
 * resampled if they happen to collide with something else in the lexicon.
 * On the rare accidental homophone, insert a linking consonant at the
 * morpheme boundary (drawn from the lexicon stream) and retry — the same
 * trick real languages use (cf. linking/epenthetic elements in compounds).
 */
function resolveCollision(segments: Segment[], joinIndex: number, inv: Inventory, stream: Stream, used: Word[]): Word {
  let segs = segments;
  for (let attempt = 0; attempt < MAX_COLLISION_REPAIR_ATTEMPTS; attempt++) {
    const word: Word = { segments: segs, stress: initialStress(segs) };
    const key = wordKey(word);
    const collides = used.some((w) => wordKey(w) === key) || used.some((w) => isNearCollision(w, word));
    if (!collides) {
      used.push(word);
      return word;
    }
    const linker = stream.pick(inv.consonants);
    segs = [...segs.slice(0, joinIndex), linker, ...segs.slice(joinIndex)];
  }
  throw new Error('resolveCollision: could not resolve a homophone collision after several attempts');
}

/** Concatenate two lexemes' surface words into a compound word. Exported for
 * src/drift.ts's coinage machinery (specs/M5.md: "reusing lexicon compound
 * machinery"), which needs to build fresh compounds from a branch's
 * *currently evolved* lexemes rather than proto roots. */
export function compoundWord(a: Lexeme, b: Lexeme, inv: Inventory, stream: Stream, used: Word[]): Word {
  const segments = [...a.word.segments, ...b.word.segments];
  return resolveCollision(segments, a.word.segments.length, inv, stream, used);
}

/** Exported for src/drift.ts's coinage fallback chain (generic
 * diminutive/adjective-izer re-derivation). */
export function affixDerivedWord(base: Lexeme, affix: Affix, inv: Inventory, stream: Stream, used: Word[]): Word {
  const joinIndex = affix.slot === 'suffix' ? base.word.segments.length : affix.form.length;
  const segments =
    affix.slot === 'suffix' ? [...base.word.segments, ...affix.form] : [...affix.form, ...base.word.segments];
  return resolveCollision(segments, joinIndex, inv, stream, used);
}

// --------------------------------------------------------------- lexicon

/**
 * Generate roots for every root-bearing concept, then resolve
 * affix-derivations, then compounds (in that dependency order — compounds
 * may reference an affix-derived lexeme, e.g. shadow = sun + dark).
 */
export function generateLexicon(inventory: Inventory, concepts: Concept[], stream: Stream): Lexicon {
  const affixes = generateAffixes(inventory, stream);
  const negationAffix = affixes.find((a) => a.role === 'negation');
  const adjectiveIzerAffix = affixes.find((a) => a.role === 'adjective-izer');
  if (!negationAffix || !adjectiveIzerAffix) {
    // Guaranteed by generateAffixes; guard defensively for type-safety.
    throw new Error('generateLexicon: expected negation and adjective-izer affixes to always be present');
  }
  const affixByRole = new Map<string, Affix>();
  for (const a of affixes) if (a.kind === 'derivational') affixByRole.set(a.role, a);

  const lexemes = new Map<string, Lexeme>();
  const usedWords: Word[] = [];

  const derivedIds = new Set(DERIVATIONS.keys());
  const rootConcepts = concepts.filter((c) => !derivedIds.has(c.id));
  const affixDerivedConcepts = concepts.filter((c) => {
    const d = DERIVATIONS.get(c.id);
    return d?.kind === 'affix';
  });
  const compoundConcepts = concepts.filter((c) => {
    const d = DERIVATIONS.get(c.id);
    return d?.kind === 'compound';
  });

  // Pass 1: roots.
  for (const concept of rootConcepts) {
    const word = generateRoot(inventory, stream, usedWords);
    lexemes.set(concept.id, { concept: concept.id, word, origin: 'root' });
  }

  // Pass 2: affix-derivations (only depend on roots).
  for (const concept of affixDerivedConcepts) {
    const d = DERIVATIONS.get(concept.id);
    if (!d || d.kind !== 'affix') continue;
    const base = lexemes.get(d.root);
    const affix = affixByRole.get(d.affix);
    if (!base || !affix) {
      throw new Error(`generateLexicon: unresolved affix-derivation for "${concept.id}" (root=${d.root}, affix=${d.affix})`);
    }
    const word = affixDerivedWord(base, affix, inventory, stream, usedWords);
    lexemes.set(concept.id, { concept: concept.id, word, origin: 'derived', parts: [d.root] });
  }

  // Pass 3: compounds (may depend on roots or affix-derived lexemes).
  for (const concept of compoundConcepts) {
    const d = DERIVATIONS.get(concept.id);
    if (!d || d.kind !== 'compound') continue;
    const [p1, p2] = d.parts;
    const a = lexemes.get(p1);
    const b = lexemes.get(p2);
    if (!a || !b) {
      throw new Error(`generateLexicon: unresolved compound for "${concept.id}" (parts=${p1},${p2})`);
    }
    const word = compoundWord(a, b, inventory, stream, usedWords);
    lexemes.set(concept.id, { concept: concept.id, word, origin: 'compound', parts: [p1, p2] });
  }

  return { lexemes, affixes };
}
