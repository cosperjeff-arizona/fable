// specs/M2.md's "Paradigm-collapse detection": after a change is applied,
// an inflectional affix is marked collapsed once fewer than 30% of a
// 20-lexeme sample still distinguishes the inflected form from the
// citation form.

import { describe, expect, it } from 'vitest';
import { detectParadigmCollapse } from '../../src/changes/paradigms.js';
import { getChange, w } from './helpers.js';
import { Stream } from '../../src/prng.js';
import type { Affix, Lexeme, Lexicon } from '../../src/lexicon.js';

function rootLexicon(forms: string[], affix: Affix): Lexicon {
  const lexemes = new Map<string, Lexeme>();
  forms.forEach((f, i) => lexemes.set(`w${i}`, { concept: `w${i}`, word: w(f), origin: 'root' }));
  return { lexemes, affixes: [affix] };
}

describe('detectParadigmCollapse', () => {
  it('marks an affix collapsed once apocope erodes its erstwhile-distinguishing final vowel', () => {
    // Every root ends in a consonant; the plural suffix is a single
    // unstressed vowel /e/. After apocope (final unstressed V > ∅ / C_#),
    // "kate" (root "kat" + suffix "e") erodes right back to "kat" — the
    // same as the bare citation form — for every sample lexeme.
    const apocope = getChange('apocope');
    const pluralAffix: Affix = { role: 'plural', kind: 'inflectional', slot: 'suffix', form: w('e').segments };
    const lexicon = rootLexicon(['kat', 'pat', 'sat', 'mat', 'nat'], pluralAffix);

    const notes = detectParadigmCollapse(lexicon, [apocope], apocope, 12, new Set(), new Stream(1));

    expect(notes).toHaveLength(1);
    expect(notes[0]!.affixRole).toBe('plural');
    expect(notes[0]!.century).toBe(12);
    expect(notes[0]!.note).toMatch(/plural/);
  });

  it('does not mark an affix collapsed when the inflected and citation forms stay distinct', () => {
    const pluralAffix: Affix = { role: 'plural', kind: 'inflectional', slot: 'suffix', form: w('e').segments };
    const lexicon = rootLexicon(['kat', 'pat', 'sat', 'mat', 'nat'], pluralAffix);
    // Empty change history: citation === root, inflected === root + suffix, always distinct.
    const anyChange = getChange('h-loss');
    const notes = detectParadigmCollapse(lexicon, [], anyChange, 1, new Set(), new Stream(1));
    expect(notes).toHaveLength(0);
  });

  it('skips affixes already recorded as collapsed', () => {
    const apocope = getChange('apocope');
    const pluralAffix: Affix = { role: 'plural', kind: 'inflectional', slot: 'suffix', form: w('e').segments };
    const lexicon = rootLexicon(['kat', 'pat', 'sat'], pluralAffix);
    const notes = detectParadigmCollapse(lexicon, [apocope], apocope, 5, new Set(['plural']), new Stream(1));
    expect(notes).toHaveLength(0);
  });
});
