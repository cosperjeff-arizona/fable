// Acceptance criterion 6 (specs/M2.md): determinism + golden snapshots of a
// scripted 10-change history for 3 seeds. Each step samples one change from
// the proto lexicon's evolving state (via sampleChange) and applies it to
// every lexeme — a minimal, self-contained stand-in for M3's full history
// driver, scoped just to exercise M2's engine end-to-end.

import { describe, expect, it } from 'vitest';
import { makeStreams } from '../../src/prng.js';
import { generateInventory } from '../../src/phonology.js';
import { generateLexicon, type Lexeme, type Lexicon } from '../../src/lexicon.js';
import { CONCEPTS } from '../../src/concepts.js';
import { romanize } from '../../src/romanize.js';
import { applyChange } from '../../src/changes/apply.js';
import { sampleChange } from '../../src/changes/sample.js';
import type { LangState } from '../../src/changes/rules.js';

const SAMPLE_CONCEPTS = ['water', 'fire', 'sun', 'moon', 'king', 'night', 'tongue', 'people'];
const STEPS = 10;

function runScriptedHistory(seed: number) {
  const streams = makeStreams(seed);
  const inventory = generateInventory(streams.phonology);
  let lexicon: Lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);
  const historyStream = streams.history;

  let changeHistory: string[] = [];
  const log: { step: number; id: string; description: string }[] = [];

  for (let step = 1; step <= STEPS; step++) {
    const state: LangState = { lexicon, changeHistory };
    const change = sampleChange(state, historyStream);
    if (!change) {
      log.push({ step, id: 'null', description: '(quiet century)' });
      continue;
    }
    const newLexemes = new Map<string, Lexeme>();
    for (const [id, lexeme] of lexicon.lexemes) {
      newLexemes.set(id, { ...lexeme, word: applyChange(lexeme.word, change) });
    }
    lexicon = { lexemes: newLexemes, affixes: lexicon.affixes };
    changeHistory = [...changeHistory, change.id];
    log.push({ step, id: change.id, description: change.describe() });
  }

  return {
    seed,
    log,
    forms: SAMPLE_CONCEPTS.map((c) => ({ concept: c, form: romanize(lexicon.lexemes.get(c)!.word) })),
  };
}

describe.each([1, 42, 2026])('scripted 10-change history: seed %d', (seed) => {
  it('matches the recorded snapshot', () => {
    expect(runScriptedHistory(seed)).toMatchSnapshot();
  });

  it('is byte-identical (deep-equal) across two independent runs', () => {
    expect(runScriptedHistory(seed)).toEqual(runScriptedHistory(seed));
  });
});
