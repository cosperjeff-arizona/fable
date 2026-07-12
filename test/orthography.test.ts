// M7 acceptance tests (specs/M7.md's "Acceptance criteria" 2): unit tests for
// each orthographic convention choice, plus the "no `~` or `'` anywhere in
// leaf display" property test over >= 15 seeds.

import { describe, expect, it } from 'vitest';
import type { Consonant, Vowel, Word } from '../src/phonology.js';
import { orthographyFor, sampleOrthography, spell, type Orthography } from '../src/orthography.js';
import { makeStreams } from '../src/prng.js';
import { generateSimulation } from '../src/history.js';
import { formIn, leaves } from '../src/query.js';
import { renderDict } from '../src/render.js';
import { CONCEPTS } from '../src/concepts.js';

// A full Orthography with every field overridable, so each unit test can
// isolate exactly the one convention it's checking.
const BASE_ORTHOGRAPHY: Orthography = {
  k: 'k',
  affricateVoiceless: 'ch',
  affricateVoiced: 'j',
  fricativePostalveolar: 'sh',
  glide: 'y',
  frontRounded: 'umlaut',
  schwa: 'ë',
  longVowel: 'double',
  nasalVowel: 'tilde',
};

const K: Consonant = { type: 'C', place: 'velar', manner: 'stop', voiced: false };
const TS: Consonant = { type: 'C', place: 'postalveolar', manner: 'affricate', voiced: false };
const DZ: Consonant = { type: 'C', place: 'postalveolar', manner: 'affricate', voiced: true };
const SH: Consonant = { type: 'C', place: 'postalveolar', manner: 'fricative', voiced: false };
const GLIDE_J: Consonant = { type: 'C', place: 'palatal', manner: 'glide', voiced: true };
const N: Consonant = { type: 'C', place: 'alveolar', manner: 'nasal', voiced: true };
const P: Consonant = { type: 'C', place: 'labial', manner: 'stop', voiced: false };

const A: Vowel = { type: 'V', height: 'low', backness: 'central', rounded: false, long: false, nasal: false };
const I: Vowel = { type: 'V', height: 'high', backness: 'front', rounded: false, long: false, nasal: false };
const Y: Vowel = { type: 'V', height: 'high', backness: 'front', rounded: true, long: false, nasal: false };
const OE: Vowel = { type: 'V', height: 'mid', backness: 'front', rounded: true, long: false, nasal: false };
const SCHWA: Vowel = { type: 'V', height: 'mid', backness: 'central', rounded: false, long: false, nasal: false };

function word(segments: (Consonant | Vowel)[]): Word {
  return { segments, stress: segments.findIndex((s) => s.type === 'V') };
}

describe('spell: /k/', () => {
  it('"k" style always spells k, even before a front vowel', () => {
    expect(spell(word([K, I]), { ...BASE_ORTHOGRAPHY, k: 'k' })).toBe('ki');
  });

  it('"c" style spells c before a back/central vowel', () => {
    expect(spell(word([K, A]), { ...BASE_ORTHOGRAPHY, k: 'c' })).toBe('ca');
  });

  it('"c" style still spells k before front vowels i/e/y/ö to stay readable', () => {
    expect(spell(word([K, I]), { ...BASE_ORTHOGRAPHY, k: 'c' })).toBe('ki');
    expect(spell(word([K, Y]), { ...BASE_ORTHOGRAPHY, k: 'c' })).toBe('küu'.slice(0, 2)); // "kü"
    expect(spell(word([K, OE]), { ...BASE_ORTHOGRAPHY, k: 'c' })).toBe('kö');
  });

  it('"c" style spells c word-finally (no following vowel)', () => {
    expect(spell(word([A, K]), { ...BASE_ORTHOGRAPHY, k: 'c' })).toBe('ac');
  });
});

describe('spell: /tʃ dʒ ʃ/', () => {
  it('affricateVoiceless renders as ch / c / tš', () => {
    expect(spell(word([A, TS, A]), { ...BASE_ORTHOGRAPHY, affricateVoiceless: 'ch' })).toBe('acha');
    expect(spell(word([A, TS, A]), { ...BASE_ORTHOGRAPHY, affricateVoiceless: 'c' })).toBe('aca');
    expect(spell(word([A, TS, A]), { ...BASE_ORTHOGRAPHY, affricateVoiceless: 'tš' })).toBe('atša');
  });

  it('affricateVoiced renders as j / dj', () => {
    expect(spell(word([A, DZ, A]), { ...BASE_ORTHOGRAPHY, affricateVoiced: 'j' })).toBe('aja');
    expect(spell(word([A, DZ, A]), { ...BASE_ORTHOGRAPHY, affricateVoiced: 'dj' })).toBe('adja');
  });

  it('fricativePostalveolar renders as sh / š / x', () => {
    expect(spell(word([A, SH, A]), { ...BASE_ORTHOGRAPHY, fricativePostalveolar: 'sh' })).toBe('asha');
    expect(spell(word([A, SH, A]), { ...BASE_ORTHOGRAPHY, fricativePostalveolar: 'š' })).toBe('aša');
    expect(spell(word([A, SH, A]), { ...BASE_ORTHOGRAPHY, fricativePostalveolar: 'x' })).toBe('axa');
  });
});

describe('spell: /j/ glide', () => {
  it('renders as y or j per the orthography', () => {
    expect(spell(word([GLIDE_J, A]), { ...BASE_ORTHOGRAPHY, glide: 'y' })).toBe('ya');
    expect(spell(word([GLIDE_J, A]), { ...BASE_ORTHOGRAPHY, glide: 'j' })).toBe('ja');
  });
});

describe('spell: /y ø/', () => {
  it('umlaut style renders ü ö', () => {
    expect(spell(word([Y]), { ...BASE_ORTHOGRAPHY, frontRounded: 'umlaut' })).toBe('ü');
    expect(spell(word([OE]), { ...BASE_ORTHOGRAPHY, frontRounded: 'umlaut' })).toBe('ö');
  });
  it('y-oe style renders y ö', () => {
    expect(spell(word([Y]), { ...BASE_ORTHOGRAPHY, frontRounded: 'y-oe' })).toBe('y');
    expect(spell(word([OE]), { ...BASE_ORTHOGRAPHY, frontRounded: 'y-oe' })).toBe('ö');
  });
  it('digraph style renders ue oe', () => {
    expect(spell(word([Y]), { ...BASE_ORTHOGRAPHY, frontRounded: 'digraph' })).toBe('ue');
    expect(spell(word([OE]), { ...BASE_ORTHOGRAPHY, frontRounded: 'digraph' })).toBe('oe');
  });
});

describe('spell: /ə/', () => {
  it('renders as ë, e, or ă per the orthography', () => {
    expect(spell(word([SCHWA]), { ...BASE_ORTHOGRAPHY, schwa: 'ë' })).toBe('ë');
    expect(spell(word([SCHWA]), { ...BASE_ORTHOGRAPHY, schwa: 'e' })).toBe('e');
    expect(spell(word([SCHWA]), { ...BASE_ORTHOGRAPHY, schwa: 'ă' })).toBe('ă');
  });
});

describe('spell: long vowels', () => {
  it('doubles the letter, or adds a combining macron, per the orthography', () => {
    const long: Vowel = { ...A, long: true };
    expect(spell(word([long]), { ...BASE_ORTHOGRAPHY, longVowel: 'double' })).toBe('aa');
    expect(spell(word([long]), { ...BASE_ORTHOGRAPHY, longVowel: 'macron' })).toBe('ā');
  });
});

describe('spell: nasal vowels', () => {
  it('tilde style adds a combining tilde', () => {
    const nasal: Vowel = { ...A, nasal: true };
    expect(spell(word([nasal]), { ...BASE_ORTHOGRAPHY, nasalVowel: 'tilde' })).toBe('ã');
  });

  it('ogonek style adds a combining ogonek', () => {
    const nasal: Vowel = { ...A, nasal: true };
    expect(spell(word([nasal]), { ...BASE_ORTHOGRAPHY, nasalVowel: 'ogonek' })).toBe('ą');
  });

  it('n-after style appends a plain n when unambiguous', () => {
    const nasal: Vowel = { ...A, nasal: true };
    expect(spell(word([P, nasal]), { ...BASE_ORTHOGRAPHY, nasalVowel: 'n-after' })).toBe('pan');
  });

  it('n-after style falls back to tilde when a real /n/ consonant follows (true /Vn/ ambiguity)', () => {
    const nasal: Vowel = { ...A, nasal: true };
    const withRealN = word([P, nasal, N, A]);
    const spelled = spell(withRealN, { ...BASE_ORTHOGRAPHY, nasalVowel: 'n-after' });
    // Falls back to the tilde marker instead of "an" + real "n" (which would
    // misleadingly read as "ann").
    expect(spelled).toBe('pãna');
  });
});

describe('spell: no apostrophe or ~ ever appears', () => {
  it('a coined compound with a would-be phonemic apostrophe separator spells cleanly', () => {
    // Two adjacent identical vowels — romanize() would insert an apostrophe
    // here to avoid a false long vowel; spell() never does, since it builds
    // straight from segments rather than post-processing romanize()'s text.
    const w = word([P, A, A, P]);
    expect(spell(w, BASE_ORTHOGRAPHY)).not.toContain("'");
    expect(spell(w, BASE_ORTHOGRAPHY)).toBe('paap');
  });
});

describe('sampleOrthography', () => {
  it('is deterministic for a given seed and branch id', () => {
    const a = orthographyFor({ config: { seed: 42 } } as never, 'root.0');
    const b = orthographyFor({ config: { seed: 42 } } as never, 'root.0');
    expect(a).toEqual(b);
  });

  it('different branch ids under the same seed are not all identical (25 ids)', () => {
    const streams = makeStreams(1);
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      seen.add(JSON.stringify(sampleOrthography(streams.orthography(`branch-${i}`))));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('never samples glide=j together with affricateVoiced=j (25 seeds x 10 branches)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const streams = makeStreams(seed);
      for (let b = 0; b < 10; b++) {
        const o = sampleOrthography(streams.orthography(`b${b}`));
        if (o.affricateVoiced === 'j') expect(o.glide).not.toBe('j');
      }
    }
  });

  it('never samples frontRounded="y-oe" together with glide="y" (25 seeds x 10 branches)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const streams = makeStreams(seed);
      for (let b = 0; b < 10; b++) {
        const o = sampleOrthography(streams.orthography(`b${b}`));
        if (o.glide === 'y') expect(o.frontRounded).not.toBe('y-oe');
      }
    }
  });
});

// Criterion 2 (property test): no leaf display output anywhere contains `~`
// or `'`, over >= 15 seeds, drift + contact enabled (so coined/taboo/loan
// forms — the ones most likely to carry a phonemic apostrophe separator —
// are well represented). Checked directly against `spell()`'s own output
// (every CONCEPTS x leaf form, the thing every leaf display ultimately
// renders through) rather than full rendered CLI text, since rendered text
// also legitimately embeds proto forms (`*...`, specs/M7.md: "keep the
// existing neutral phonemic romanization") and branch display names (also
// phonemic, unrelated to this milestone) — neither of which this criterion
// is about.
describe('spell() never produces ~ or an apostrophe (15 seeds)', () => {
  const SEEDS = Array.from({ length: 15 }, (_, i) => i + 1);

  it.each(SEEDS)('every concept x leaf form in seed %i spells cleanly', (seed) => {
    const sim = generateSimulation({ seed, driftEnabled: true, contactEnabled: true });
    let checked = 0;
    for (const leaf of leaves(sim)) {
      const orthography = orthographyFor(sim, leaf.id);
      for (const concept of CONCEPTS) {
        const spelled = spell(formIn(sim, concept.id, leaf.id), orthography);
        expect(spelled).not.toContain('~');
        expect(spelled).not.toContain("'");
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('renderDict\'s word column (the spelled form itself) never contains ~ or an apostrophe (15 seeds)', () => {
    for (const seed of SEEDS) {
      const sim = generateSimulation({ seed, driftEnabled: true, contactEnabled: true });
      for (const leaf of leaves(sim)) {
        const lines = renderDict(sim, leaf);
        for (const line of lines.slice(1)) {
          if (!line.startsWith('  ') || line.trim().startsWith('—')) continue; // a semantic-note continuation line
          const word = line.trim().split(/\s+/)[1];
          if (!word) continue;
          expect(word).not.toContain('~');
          expect(word).not.toContain("'");
        }
      }
    }
  });
});
