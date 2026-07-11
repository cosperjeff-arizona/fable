// Golden snapshot tests (specs/M1.md acceptance criterion 2): pin down the
// full generated output for seeds 1, 42, and 2026 so any accidental change
// to the generation pipeline is caught. Vitest writes the reference
// snapshot to test/__snapshots__/golden.test.ts.snap on first run; from
// then on it's the "golden" value future runs are compared against.

import { describe, expect, it } from 'vitest';
import { makeStreams } from '../src/prng.js';
import { generateInventory, symbolFor } from '../src/phonology.js';
import { generateLexicon } from '../src/lexicon.js';
import { CONCEPTS } from '../src/concepts.js';
import { romanize } from '../src/romanize.js';

function summarize(seed: number) {
  const streams = makeStreams(seed);
  const inventory = generateInventory(streams.phonology);
  const lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);

  const lexemes = [...lexicon.lexemes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, lexeme]) => ({
      id,
      origin: lexeme.origin,
      parts: lexeme.parts ?? null,
      form: romanize(lexeme.word),
      stress: lexeme.word.stress,
    }));

  return {
    seed,
    inventory: {
      consonants: inventory.consonants.map(symbolFor),
      vowels: inventory.vowels.map(symbolFor),
      phonotactics: {
        maxOnset: inventory.phonotactics.maxOnset,
        codas: inventory.phonotactics.codas.map(symbolFor),
        allowFinalVowel: inventory.phonotactics.allowFinalVowel,
      },
    },
    affixes: lexicon.affixes.map((a) => ({
      role: a.role,
      kind: a.kind,
      slot: a.slot,
      form: a.form.map(symbolFor).join(''),
    })),
    lexemeCount: lexemes.length,
    lexemes,
  };
}

describe.each([1, 42, 2026])('golden snapshot: seed %d', (seed) => {
  it('matches the recorded snapshot', () => {
    expect(summarize(seed)).toMatchSnapshot();
  });

  it('is byte-identical (deep-equal) across two independent runs', () => {
    expect(summarize(seed)).toEqual(summarize(seed));
  });
});
