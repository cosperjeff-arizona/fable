// Acceptance criterion 1 (specs/M2.md): one unit test per catalog entry,
// hand-constructed input -> expected romanized output, plus a negative case
// (environment not met) each. Also criterion 7 (grimm-bundle uniqueness).

import { describe, expect, it } from 'vitest';
import { applyChange } from '../../src/changes/apply.js';
import { CATALOG } from '../../src/changes/catalog.js';
import { Stream } from '../../src/prng.js';
import { romanize } from '../../src/romanize.js';
import { getChange, w } from './helpers.js';

function expectUnchanged(id: string, input: ReturnType<typeof w>) {
  const change = getChange(id);
  const result = applyChange(input, change);
  expect(result).toBe(input); // pure function: same reference when nothing changed
}

function expectRomanized(id: string, input: ReturnType<typeof w>, expected: string) {
  const change = getChange(id);
  const result = applyChange(input, change);
  expect(romanize(result)).toBe(expected);
}

describe('catalog has 38 entries with unique ids', () => {
  it('exactly 38 factories', () => {
    expect(CATALOG.length).toBe(38);
  });

  it('all ids are unique', () => {
    const ids = CATALOG.map((f) => f(new Stream(1)).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('1. voicing', () => {
  it('p t k > b d g / V_V', () => expectRomanized('voicing', w('atata'), 'adada'));
  it('negative: no intervocalic stops', () => expectUnchanged('voicing', w('tak')));
});

describe('2. spirantization', () => {
  it('b d g > v z h / V_V', () => {
    expectRomanized('spirantization', w('aba'), 'ava');
    expectRomanized('spirantization', w('ada'), 'aza');
    expectRomanized('spirantization', w('aga'), 'aha');
  });
  it('negative: not intervocalic', () => expectUnchanged('spirantization', w('bak')));
});

describe('3. final-devoicing', () => {
  it('b d g v z > p t k f s / _#', () => expectRomanized('final-devoicing', w('tab'), 'tap'));
  it('negative: already voiceless', () => expectUnchanged('final-devoicing', w('tap')));
});

describe('4. w-fortition', () => {
  it('w > v everywhere', () => expectRomanized('w-fortition', w('awa'), 'ava'));
  it('negative: no w', () => expectUnchanged('w-fortition', w('ata')));
});

describe('5. glide-fortition', () => {
  it('j > dʒ / #_', () => expectRomanized('glide-fortition', w('yata'), 'jata'));
  it('negative: not word-initial', () => expectUnchanged('glide-fortition', w('ayata')));
});

describe('6. degemination', () => {
  it('identical CC > C', () => expectRomanized('degemination', w('atta'), 'ata'));
  it('negative: not identical', () => expectUnchanged('degemination', w('atka')));
});

describe('7. apocope', () => {
  it('final unstressed V > ∅ / C_#', () => expectRomanized('apocope', w('kata'), 'kat'));
  it('negative: final vowel is stressed', () => expectUnchanged('apocope', w('ka')));
});

describe('8. syncope', () => {
  it('medial unstressed V > ∅ between single Cs', () => expectRomanized('syncope', w('katama'), 'katma'));
  it('negative: not enough context (2 syllables)', () => expectUnchanged('syncope', w('kata')));
});

describe('9. final-stop-loss', () => {
  it('stops > ∅ / _#', () => expectRomanized('final-stop-loss', w('kat'), 'ka'));
  it('negative: word-guard blocks a 2-segment result from shrinking to 1', () => expectUnchanged('final-stop-loss', w('ap')));
});

describe('10. h-loss', () => {
  it('h > ∅ everywhere', () => expectRomanized('h-loss', w('haka'), 'aka'));
  it('negative: no h', () => expectUnchanged('h-loss', w('aka')));
});

describe('11. initial-cluster-reduction', () => {
  it('#CC > #C, keep second', () => expectRomanized('initial-cluster-reduction', w('pla'), 'la'));
  it('negative: single onset', () => expectUnchanged('initial-cluster-reduction', w('pa')));
});

describe('12. final-n-loss-with-nasalization', () => {
  it('Vn > Ṽ / _#', () => expectRomanized('final-n-loss-with-nasalization', w('kan'), 'ka~'));
  it('negative: no final n', () => expectUnchanged('final-n-loss-with-nasalization', w('kata')));
});

describe('13. unstressed-vowel-reduction', () => {
  it('unstressed non-low V > ə', () => expectRomanized('unstressed-vowel-reduction', w('kati'), 'katë'));
  it('negative: target vowel is low (a)', () => expectUnchanged('unstressed-vowel-reduction', w('kata')));
});

describe('14. nasal-place-assim', () => {
  it('n > m / _labial stop', () => expectRomanized('nasal-place-assim', w('anpa'), 'ampa'));
  it('negative: n before alveolar stop', () => expectUnchanged('nasal-place-assim', w('anta')));
});

describe('15. cluster-voicing-assim', () => {
  it('voiceless obstruent agrees with a following voiced obstruent', () => expectRomanized('cluster-voicing-assim', w('asba'), 'azba'));
  it('negative: trigger is voiceless', () => expectUnchanged('cluster-voicing-assim', w('aspa')));
});

describe('16. palatalization-velar', () => {
  it('k g > tʃ dʒ / _i', () => expectRomanized('palatalization-velar', w('aki'), 'achi'));
  it('negative: k before a', () => expectUnchanged('palatalization-velar', w('aka')));
});

describe('17. palatalization-alveolar', () => {
  it('t d s > tʃ dʒ ʃ / _i', () => expectRomanized('palatalization-alveolar', w('ati'), 'achi'));
  it('negative: t before a', () => expectUnchanged('palatalization-alveolar', w('ata')));
});

describe('18. umlaut', () => {
  it('a o u > e ø y before i in the next syllable', () => expectRomanized('umlaut', w('kati'), 'keti'));
  it('negative: no following i', () => expectUnchanged('umlaut', w('kata')));
});

describe('19. total-assim-nt', () => {
  it('nt > tt', () => expectRomanized('total-assim-nt', w('anta'), 'atta'));
  it('negative: n before d', () => expectUnchanged('total-assim-nt', w('anda')));
});

describe('20. chain-raising', () => {
  it('o > u and a > o without merging (drag chain)', () => expectRomanized('chain-raising', w('aoka'), 'ouko'));
  it('negative: no a or o', () => expectUnchanged('chain-raising', w('iki')));
});

describe('21. fronting-u', () => {
  it('u > y', () => expectRomanized('fronting-u', w('uta'), 'üta'));
  it('negative: no u', () => expectUnchanged('fronting-u', w('ita')));
});

describe('22. raising-e', () => {
  it('e > i', () => expectRomanized('raising-e', w('eta'), 'ita'));
  it('negative: no e', () => expectUnchanged('raising-e', w('ata')));
});

describe('23. fronting-a', () => {
  it('a > e', () => expectRomanized('fronting-a', w('ata'), 'ete'));
  it('negative: no a', () => expectUnchanged('fronting-a', w('iti')));
  it('applicable() is false once umlaut has run on this path', () => {
    const change = getChange('fronting-a');
    const lexicon = { lexemes: new Map(), affixes: [] };
    expect(change.applicable({ lexicon, changeHistory: [] })).toBe(false); // no target segments either, but...
    expect(change.applicable({ lexicon: minimalLexiconWith(w('ata')), changeHistory: [] })).toBe(true);
    expect(change.applicable({ lexicon: minimalLexiconWith(w('ata')), changeHistory: ['umlaut'] })).toBe(false);
  });
});

describe('24. diphthongization', () => {
  it('eː > ie', () => expectRomanized('diphthongization', w('tee'), 'tie'));
  it('oː > uo', () => expectRomanized('diphthongization', w('too'), 'tuo'));
  it('negative: short e (no length)', () => expectUnchanged('diphthongization', w('te')));
});

describe('25. monophthongization', () => {
  it('ai > eː', () => expectRomanized('monophthongization', w('tai'), 'tee'));
  it('au > oː', () => expectRomanized('monophthongization', w('tau'), 'too'));
  it('negative: e followed by i (not a)', () => expectUnchanged('monophthongization', w('tei')));
});

describe('26. length-loss', () => {
  it('long V > short V', () => expectRomanized('length-loss', w('kaa'), 'ka'));
  it('negative: no long vowel', () => expectUnchanged('length-loss', w('ka')));
});

describe('27. nasal-vowel-merger', () => {
  it('high nasal vowels lower to mid', () => expectRomanized('nasal-vowel-merger', w('ki~'), 'ke~'));
  it('negative: nasal vowel is already non-high', () => expectUnchanged('nasal-vowel-merger', w('ka~')));
});

describe('28. prothesis', () => {
  it('∅ > e / #_sC', () => expectRomanized('prothesis', w('ska'), 'eska'));
  it('negative: s followed by a vowel', () => expectUnchanged('prothesis', w('sata')));
});

describe('29. anaptyxis', () => {
  it('∅ > ə inside a medial CC', () => expectRomanized('anaptyxis', w('akta'), 'akëta'));
  it('negative: no medial CC', () => expectUnchanged('anaptyxis', w('aka')));
});

describe('30. paragoge', () => {
  it('∅ > e / obstruent_#', () => expectRomanized('paragoge', w('kat'), 'kate'));
  it('negative: final sonorant, not obstruent', () => expectUnchanged('paragoge', w('kan')));
});

describe('31. rhotacism', () => {
  it('s z > r / V_V', () => expectRomanized('rhotacism', w('asa'), 'ara'));
  it('negative: not intervocalic', () => expectUnchanged('rhotacism', w('sa')));
});

describe('32. debuccalization', () => {
  it('s > h / #_', () => expectRomanized('debuccalization', w('sata'), 'hata'));
  it('negative: not word-initial', () => expectUnchanged('debuccalization', w('asa')));
});

describe('33. liquid-metathesis', () => {
  it('CVrC > CrVC', () => expectRomanized('liquid-metathesis', w('karta'), 'krata'));
  it('negative: no r', () => expectUnchanged('liquid-metathesis', w('kata')));
});

describe('34. l-vocalization', () => {
  it('l > w / _C', () => expectRomanized('l-vocalization', w('alta'), 'awta'));
  it('l > w / _#', () => expectRomanized('l-vocalization', w('kal'), 'kaw'));
  it('negative: intervocalic l', () => expectUnchanged('l-vocalization', w('ala')));
});

describe('35. grimm-bundle', () => {
  it("p t k > f s h; b d g > p t k, all at once", () => expectRomanized('grimm-bundle', w('pakbad'), 'fahpat'));
  it('negative: no stops at all', () => expectUnchanged('grimm-bundle', w('asa')));
  it('acceptance criterion 7: applicable() is false once it has already run on this path', () => {
    const change = getChange('grimm-bundle');
    const lexicon = minimalLexiconWith(w('pakbad'));
    expect(change.applicable({ lexicon, changeHistory: [] })).toBe(true);
    expect(change.applicable({ lexicon, changeHistory: ['voicing', 'grimm-bundle', 'apocope'] })).toBe(false);
  });
});

describe('36. intervocalic-glide-loss', () => {
  it('j w > ∅ / V_V', () => {
    expectRomanized('intervocalic-glide-loss', w('aya'), "a'a");
    expectRomanized('intervocalic-glide-loss', w('awa'), "a'a");
  });
  it('negative: word-initial glide', () => expectUnchanged('intervocalic-glide-loss', w('ya')));
});

describe('37. hiatus-resolution', () => {
  it('identical V.V > single long V', () => expectRomanized('hiatus-resolution', w("ka'a"), 'kaa'));
  it('negative: no hiatus', () => expectUnchanged('hiatus-resolution', w('kata')));
});

describe('38. stress-shift-initial', () => {
  it('moves stress to the first vowel, no segmental change', () => {
    const change = getChange('stress-shift-initial');
    const input = w('katama', 3);
    const result = applyChange(input, change);
    expect(result.stress).toBe(1);
    expect(result.segments).toEqual(input.segments);
  });
  it('negative: already initial stress (same reference)', () => {
    const change = getChange('stress-shift-initial');
    const input = w('katama');
    expect(applyChange(input, change)).toBe(input);
  });
});

// ---------------------------------------------------------------- helpers

function minimalLexiconWith(word: ReturnType<typeof w>) {
  return {
    lexemes: new Map([['x', { concept: 'x', word, origin: 'root' as const }]]),
    affixes: [],
  };
}
