// Acceptance criteria 2-4 (specs/M2.md): feeding-chain, simultaneity,
// index-remapping, and stress-remapping tests for the application engine
// itself (src/changes/apply.ts), independent of any one catalog entry.

import { describe, expect, it } from 'vitest';
import { applyChange } from '../../src/changes/apply.js';
import { romanize } from '../../src/romanize.js';
import { getChange, w } from './helpers.js';

describe('acceptance 2: feeding chain (h-loss -> hiatus-resolution)', () => {
  it('h-loss then hiatus-resolution produces a long vowel end-to-end', () => {
    const hLoss = getChange('h-loss');
    const hiatus = getChange('hiatus-resolution');

    const start = w('kaha');
    const afterHLoss = applyChange(start, hLoss);
    expect(romanize(afterHLoss)).toBe("ka'a"); // h deleted, leaving two short a's in hiatus

    const afterHiatus = applyChange(afterHLoss, hiatus);
    expect(romanize(afterHiatus)).toBe('kaa'); // merged into one long a
    expect(afterHiatus.segments.some((s) => s.type === 'V' && s.long)).toBe(true);
  });
});

describe('acceptance 3: simultaneity and index remapping', () => {
  it('voicing on atata yields adada from the same pre-state (not fed)', () => {
    const change = getChange('voicing');
    expect(romanize(applyChange(w('atata'), change))).toBe('adada');
  });

  it('remaps indices correctly with multiple deletions in one word', () => {
    // Two independent geminate pairs in one word: degemination must delete
    // both, right-to-left, without either deletion corrupting the other's
    // (pre-computed) index.
    const change = getChange('degemination');
    const input = w('attakka'); // a-t-t-a-k-k-a
    const result = applyChange(input, change);
    expect(romanize(result)).toBe('ataka');
  });
});

describe('acceptance 4: stress remapping', () => {
  it('deleting the stressed vowel moves stress to the nearest surviving vowel to the left', () => {
    // hiatus-resolution's second subRule deletes a vowel with no stress
    // restriction of its own; force stress onto the vowel it will delete.
    const hiatus = getChange('hiatus-resolution');
    const input = w("ka'ata", 2); // k(0) a(1) a(2) t(3) a(4); stress forced onto index 2
    const result = applyChange(input, hiatus);
    expect(romanize(result)).toBe('kaata'); // index1/2 merge into one long vowel at index 1
    expect(result.stress).toBe(1); // nearest surviving vowel to the left of the deleted one
  });

  it('an insertion before the stressed vowel shifts its index right', () => {
    const prothesis = getChange('prothesis');
    const input = w('ska'); // s(0) k(1) a(2); stress defaults to the only vowel, index 2
    expect(input.stress).toBe(2);
    const result = applyChange(input, prothesis);
    expect(romanize(result)).toBe('eska'); // insertBefore at index 0
    expect(result.stress).toBe(3); // shifted right by the insertion
  });
});
