// Paradigm-collapse detection (specs/M2.md's "Paradigm-collapse detection").
//
// No syntax simulation — just detection and reporting. After a change is
// applied, for each inflectional affix not already marked collapsed: inflect
// a sample of lexemes, evolve both the citation form and the inflected form
// through the *same* change history, and see whether they're still
// distinguishable. If fewer than 30% of the sample still differ, the affix
// is declared collapsed.

import { wordKey } from '../phonology.js';
import { type Affix, type Lexeme, type Lexicon, inflect } from '../lexicon.js';
import type { Stream } from '../prng.js';
import { evolve } from './apply.js';
import type { SoundChange } from './rules.js';

export type ParadigmNote = { century: number; affixRole: string; note: string };

const SAMPLE_SIZE = 20;
const COLLAPSE_THRESHOLD = 0.3; // fewer than this fraction still distinguishable => collapsed

/**
 * Check every inflectional affix (skipping any role already in
 * `collapsedRoles`) for paradigm collapse, given the full change history
 * applied so far (including the change that was just applied — the caller
 * decides when to call this). Returns one note per newly-collapsed affix;
 * the caller is responsible for accumulating `collapsedRoles` and
 * `paradigmNotes` across centuries (this function is pure/stateless).
 */
export function detectParadigmCollapse(
  lexicon: Lexicon,
  changeHistory: readonly SoundChange[],
  latestChange: SoundChange,
  century: number,
  collapsedRoles: ReadonlySet<string>,
  stream: Stream,
): ParadigmNote[] {
  const inflectionalAffixes = lexicon.affixes.filter((a) => a.kind === 'inflectional' && !collapsedRoles.has(a.role));
  if (inflectionalAffixes.length === 0) return [];

  const rootLexemes = [...lexicon.lexemes.values()];
  if (rootLexemes.length === 0) return [];

  const notes: ParadigmNote[] = [];
  for (const affix of inflectionalAffixes) {
    const sample = stream.shuffle(rootLexemes).slice(0, Math.min(SAMPLE_SIZE, rootLexemes.length));
    const distinguishable = sample.filter((lexeme) => stillDistinguishable(lexeme, affix, changeHistory)).length;
    const fraction = distinguishable / sample.length;
    if (fraction < COLLAPSE_THRESHOLD) {
      notes.push({
        century,
        affixRole: affix.role,
        note: `the ${affix.role} was lost to ${latestChange.describe()}, c. year ${century * 100}`,
      });
    }
  }
  return notes;
}

function stillDistinguishable(lexeme: Lexeme, affix: Affix, changeHistory: readonly SoundChange[]): boolean {
  const citation = evolve(lexeme.word, changeHistory).form;
  const inflectedProto = inflect(lexeme, affix);
  const inflected = evolve(inflectedProto, changeHistory).form;
  return wordKey(citation) !== wordKey(inflected);
}
