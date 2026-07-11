import { describe, expect, it } from 'vitest';
import { makeStreams } from '../src/prng.js';
import { generateInventory, isLegalWord, segKey, wordKey } from '../src/phonology.js';
import { generateLexicon } from '../src/lexicon.js';
import { CONCEPTS, DERIVATIONS } from '../src/concepts.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('generateLexicon', () => {
  it('is deterministic for a given seed', () => {
    const streamsA = makeStreams(42);
    const invA = generateInventory(streamsA.phonology);
    const lexA = generateLexicon(invA, CONCEPTS, streamsA.lexicon);

    const streamsB = makeStreams(42);
    const invB = generateInventory(streamsB.phonology);
    const lexB = generateLexicon(invB, CONCEPTS, streamsB.lexicon);

    expect([...lexA.lexemes.entries()]).toEqual([...lexB.lexemes.entries()]);
    expect(lexA.affixes).toEqual(lexB.affixes);
  });

  it.each(SEEDS)('every concept resolves to a lexeme (seed %d)', (seed) => {
    const streams = makeStreams(seed);
    const inventory = generateInventory(streams.phonology);
    const lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);
    for (const concept of CONCEPTS) {
      expect(lexicon.lexemes.has(concept.id)).toBe(true);
      const lexeme = lexicon.lexemes.get(concept.id)!;
      expect(lexeme.word.segments.length).toBeGreaterThan(0);
    }
  });

  it.each(SEEDS)('every root satisfies isLegalWord (seed %d)', (seed) => {
    const streams = makeStreams(seed);
    const inventory = generateInventory(streams.phonology);
    const lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);
    for (const lexeme of lexicon.lexemes.values()) {
      if (lexeme.origin !== 'root') continue;
      expect(isLegalWord(lexeme.word, inventory.phonotactics)).toBe(true);
    }
  });

  it.each(SEEDS)('has zero homophone collisions across the whole lexicon (seed %d)', (seed) => {
    const streams = makeStreams(seed);
    const inventory = generateInventory(streams.phonology);
    const lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);
    const keys = [...lexicon.lexemes.values()].map((l) => wordKey(l.word));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(SEEDS)('marks derived/compound concepts with the right origin and parts (seed %d)', (seed) => {
    const streams = makeStreams(seed);
    const inventory = generateInventory(streams.phonology);
    const lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);
    for (const [id, derivation] of DERIVATIONS) {
      const lexeme = lexicon.lexemes.get(id)!;
      if (derivation.kind === 'compound') {
        expect(lexeme.origin).toBe('compound');
        expect(lexeme.parts).toEqual([derivation.parts[0], derivation.parts[1]]);
      } else {
        expect(lexeme.origin).toBe('derived');
        expect(lexeme.parts).toEqual([derivation.root]);
      }
    }
  });

  it.each(SEEDS)('roughly ~170 concepts get their own root (seed %d)', (seed) => {
    const streams = makeStreams(seed);
    const inventory = generateInventory(streams.phonology);
    const lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);
    const rootCount = [...lexicon.lexemes.values()].filter((l) => l.origin === 'root').length;
    expect(rootCount).toBe(CONCEPTS.length - DERIVATIONS.size);
  });

  it('generates 3-5 derivational affixes including negation and adjective-izer, and 3-4 inflectional affixes', () => {
    for (const seed of SEEDS) {
      const streams = makeStreams(seed);
      const inventory = generateInventory(streams.phonology);
      const lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);
      const derivational = lexicon.affixes.filter((a) => a.kind === 'derivational');
      const inflectional = lexicon.affixes.filter((a) => a.kind === 'inflectional');
      expect(derivational.length).toBeGreaterThanOrEqual(3);
      expect(derivational.length).toBeLessThanOrEqual(5);
      expect(derivational.map((a) => a.role)).toContain('negation');
      expect(derivational.map((a) => a.role)).toContain('adjective-izer');
      expect(inflectional.length).toBeGreaterThanOrEqual(3);
      expect(inflectional.length).toBeLessThanOrEqual(4);
      expect(inflectional.map((a) => a.role)).toEqual(expect.arrayContaining(['plural', 'past', 'genitive']));
    }
  });

  it('all affixes in one lexicon share the same slot (language is uniformly suffixing or prefixing)', () => {
    for (const seed of SEEDS) {
      const streams = makeStreams(seed);
      const inventory = generateInventory(streams.phonology);
      const lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);
      const slots = new Set(lexicon.affixes.map((a) => a.slot));
      expect(slots.size).toBe(1);
    }
  });

  it('affix forms are pairwise distinct within a lexicon', () => {
    for (const seed of SEEDS) {
      const streams = makeStreams(seed);
      const inventory = generateInventory(streams.phonology);
      const lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);
      const keys = lexicon.affixes.map((a) => a.form.map(segKey).join('.'));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
