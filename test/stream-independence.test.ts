import { describe, expect, it } from 'vitest';
import { makeStreams } from '../src/prng.js';
import { generateInventory } from '../src/phonology.js';
import { generateLexicon } from '../src/lexicon.js';
import { CONCEPTS } from '../src/concepts.js';

describe('stream independence (specs/M1.md acceptance criterion 3)', () => {
  it('consuming extra randomness from the lexicon stream does not change phonology output', () => {
    const streamsA = makeStreams(42);
    const inventoryA = generateInventory(streamsA.phonology);

    const streamsB = makeStreams(42);
    // Burn a lot of extra randomness on the lexicon stream before touching
    // phonology at all.
    for (let i = 0; i < 500; i++) streamsB.lexicon.next();
    const inventoryB = generateInventory(streamsB.phonology);

    expect(inventoryB).toEqual(inventoryA);
  });

  it('generating the full lexicon (which consumes lexicon-stream randomness) does not change a phonology generated from the same seed', () => {
    const streamsA = makeStreams(2026);
    const inventoryA = generateInventory(streamsA.phonology);

    const streamsB = makeStreams(2026);
    const inventoryB = generateInventory(streamsB.phonology);
    // Now consume a full lexicon generation's worth of lexicon-stream
    // randomness; this must not perturb anything phonology-related, since
    // inventoryB was already produced above.
    generateLexicon(inventoryB, CONCEPTS, streamsB.lexicon);

    expect(inventoryB).toEqual(inventoryA);
  });

  it('phonology stream position is unaffected by how many concepts the lexicon consumes', () => {
    const streamsA = makeStreams(7);
    const invA = generateInventory(streamsA.phonology);
    generateLexicon(invA, CONCEPTS, streamsA.lexicon);
    const nextPhonologyValueA = streamsA.phonology.next();

    const streamsB = makeStreams(7);
    const invB = generateInventory(streamsB.phonology);
    // Use only a handful of concepts (consumes far less lexicon-stream
    // randomness than the full 200-concept run above).
    generateLexicon(invB, CONCEPTS.slice(0, 5), streamsB.lexicon);
    const nextPhonologyValueB = streamsB.phonology.next();

    expect(nextPhonologyValueB).toBe(nextPhonologyValueA);
  });
});
