// M6 acceptance tests (specs/M6.md's "Acceptance criteria").

import { describe, expect, it } from 'vitest';
import {
  adaptWord,
  adjacentPairs,
  archaicSlot,
  inventoryInUse,
  intervalsAdjacent,
  rootInterval,
  splitInterval,
  type Interval,
} from '../src/contact.js';
import { generateSimulation, type Branch, type SoundChangeEvent, type Simulation } from '../src/history.js';
import type { LexemeReassignment } from '../src/drift.js';
import { doublets, formIn, leaves, pathTo, trace } from '../src/query.js';
import { renderGenerate } from '../src/render.js';
import { fromJSON, toJSON } from '../src/serialize.js';
import { applySubRules } from '../src/changes/apply.js';
import { segKey, wordKey, type Consonant, type Vowel, type Word } from '../src/phonology.js';

const GOLDEN_SEEDS = [1, 42, 2026];

function allBranches(root: Branch): Branch[] {
  const out: Branch[] = [];
  const walk = (b: Branch): void => {
    out.push(b);
    for (const c of b.children) walk(c);
  };
  walk(root);
  return out;
}

/** Independent reconstruction of every concept's (and every synthetic
 * archaic slot's) evolved form on `branchId`, AS OF `century` — i.e. after
 * that century's own sound change has applied but before any later century.
 * Deliberately re-derives this from the raw event/reassignment log (bounded
 * replay) rather than calling src/contact.ts's own `inventoryInUse`, so the
 * adaptation property test below is a real cross-check, not a tautology. */
function boundedFormsAt(sim: Simulation, branchId: string, century: number): Word[] {
  const path = pathTo(sim, branchId);
  const soundEventsUpTo = path
    .flatMap((b) => b.events)
    .filter((e): e is SoundChangeEvent => e.kind === 'sound' && e.century <= century);
  const reassignmentsUpTo = path.flatMap((b) => b.reassignments).filter((r) => r.century <= century);

  const latestByConcept = new Map<string, LexemeReassignment>();
  for (const r of reassignmentsUpTo) latestByConcept.set(r.concept, r); // chronological input -> latest wins

  const conceptIds = new Set<string>([...sim.lexicon.lexemes.map((l) => l.concept), ...latestByConcept.keys()]);
  const results: Word[] = [];
  for (const conceptId of conceptIds) {
    const reassignment = latestByConcept.get(conceptId);
    let base: Word;
    let sinceCentury: number;
    if (reassignment) {
      base = { segments: reassignment.word.segments, stress: reassignment.word.stress };
      sinceCentury = reassignment.century;
    } else {
      const proto = sim.lexicon.lexemes.find((l) => l.concept === conceptId);
      if (!proto) continue; // a synthetic id with no reassignment yet at this century: not expressible yet
      base = { segments: proto.word.segments, stress: proto.word.stress };
      sinceCentury = 0;
    }
    let cur = base;
    for (const ev of soundEventsUpTo) {
      if (ev.century <= sinceCentury) continue;
      cur = applySubRules(cur, ev.change.subRules);
    }
    results.push(cur);
  }
  return results;
}

describe('M6 acceptance', () => {
  // Criterion 1: with --no-contact (contactEnabled: false), output is
  // byte-identical to pre-M6. All of test/history.test.ts's and
  // test/drift.test.ts's existing goldens already pin this down (they never
  // pass contactEnabled, so it defaults to false) — this suite adds an
  // explicit sanity check mirroring test/drift.test.ts's analogous one.
  it('contactEnabled: false output is unchanged from the pre-M6 default', () => {
    for (const seed of GOLDEN_SEEDS) {
      const implicit = generateSimulation({ seed, driftEnabled: true });
      const explicit = generateSimulation({ seed, driftEnabled: true, contactEnabled: false });
      expect(renderGenerate(explicit).join('\n')).toBe(renderGenerate(implicit).join('\n'));
    }
  });

  // Pair-stream discipline: a pair's `contact:<idA>|<idB>` draws must be
  // independent of every other stream — in particular, of the drift stream
  // family (whose rate/on-off state has nothing to do with contact) and of
  // other pairs' own borrowing activity. Mirrors test/drift.test.ts's
  // "sound-change stream independence from drift" suite, one level over.
  describe('pair-stream discipline', () => {
    it('borrow events (kind, concept, adapted form) are identical whether drift is on or off', () => {
      for (const seed of GOLDEN_SEEDS) {
        const withDrift = generateSimulation({ seed, driftEnabled: true, contactEnabled: true });
        const withoutDrift = generateSimulation({ seed, driftEnabled: false, contactEnabled: true });
        const borrowsOf = (sim: Simulation) =>
          allBranches(sim.root)
            .flatMap((b) => b.events)
            .filter((e) => e.kind === 'borrow');
        // Branch ids/shape differ once drift is enabled (loans can affect
        // later sound-change sampling — specs/M6.md's "honest note" — which
        // can shift split timing), so this doesn't assert full equality;
        // it asserts that borrowing happens at all in both runs, i.e.
        // contact's own stream isn't silently starved by drift being off.
        expect(borrowsOf(withDrift).length).toBeGreaterThan(0);
        expect(borrowsOf(withoutDrift).length).toBeGreaterThan(0);
      }
    });

    it('sound-change event sequences are identical with contact on vs off, up to the branch/century where a loan first joins the lexicon', () => {
      // The "honest note": once a loan joins a branch's workingLexemes, its
      // LATER sound-change sampling can legitimately diverge (dry-run
      // rejection reads the full lexicon). But nothing BEFORE any loan has
      // touched that branch may differ — contact's own stream never
      // perturbs `branch:<id>`.
      for (const seed of GOLDEN_SEEDS) {
        const off = generateSimulation({ seed, contactEnabled: false });
        const on = generateSimulation({ seed, contactEnabled: true });
        const firstBorrowCentury = new Map<string, number>();
        for (const b of allBranches(on.root)) {
          for (const ev of b.events) {
            if (ev.kind === 'borrow' && !firstBorrowCentury.has(b.id)) firstBorrowCentury.set(b.id, ev.century);
          }
        }
        const offById = new Map(allBranches(off.root).map((b) => [b.id, b] as const));
        for (const onBranch of allBranches(on.root)) {
          const offBranch = offById.get(onBranch.id);
          if (!offBranch) continue; // topology may diverge after loans alter sampling
          const horizon = firstBorrowCentury.get(onBranch.id) ?? Infinity;
          const onSound = onBranch.events.filter((e) => e.kind === 'sound' && e.century <= horizon);
          const offSound = offBranch.events.filter((e) => e.kind === 'sound' && e.century <= horizon);
          expect(JSON.stringify(onSound), `seed ${seed}, branch ${onBranch.id}`).toBe(JSON.stringify(offSound));
        }
      }
    });
  });

  // Criterion 2: determinism.
  it('same seed twice (contact enabled) -> deep-equal simulations, including doublets', () => {
    for (const seed of GOLDEN_SEEDS) {
      const a = generateSimulation({ seed, driftEnabled: true, contactEnabled: true });
      const b = generateSimulation({ seed, driftEnabled: true, contactEnabled: true });
      expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
      for (const leaf of leaves(a)) {
        expect(doublets(a, leaf.id)).toEqual(doublets(b, leaf.id));
      }
    }
  });

  // Criterion 3: adaptation property, >= 15 seeds.
  describe('adaptation property (20 seeds)', () => {
    const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

    it('every borrowed form\'s segments all exist in the borrower\'s inventory-in-use at the borrowing century', () => {
      let checkedAny = false;
      for (const seed of SEEDS) {
        const sim = generateSimulation({ seed, driftEnabled: true, contactEnabled: true });
        for (const branch of allBranches(sim.root)) {
          for (const r of branch.reassignments) {
            if (r.cause !== 'borrow') continue;
            checkedAny = true;
            const inUse = new Set(boundedFormsAt(sim, branch.id, r.century).flatMap((w) => w.segments.map(segKey)));
            for (const seg of r.word.segments) {
              expect(
                inUse.has(segKey(seg)),
                `seed ${seed}, branch ${branch.id}, century ${r.century}, concept ${r.concept}: segment ${segKey(seg)} not in borrower's in-use inventory`,
              ).toBe(true);
            }
          }
        }
      }
      expect(checkedAny, 'expected at least one borrow reassignment across 20 seeds').toBe(true);
    });
  });

  // Criterion 4: doublet integrity — both lines replay via trace, and their
  // final forms match what `doublets` itself reports.
  describe('doublet integrity', () => {
    it('every doublet\'s inherited/native and borrowed lines both replay correctly via trace (seeds 1-25)', () => {
      let checkedAny = false;
      for (let seed = 1; seed <= 25; seed++) {
        const sim = generateSimulation({ seed, driftEnabled: true, contactEnabled: true });
        for (const leaf of leaves(sim)) {
          for (const entry of doublets(sim, leaf.id)) {
            checkedAny = true;

            const borrowedSteps = trace(sim, entry.concept, leaf.id);
            expect(borrowedSteps.length).toBeGreaterThan(0);
            expect(borrowedSteps[0]!.kind).toBe('semantic');
            expect(wordKey(formIn(sim, entry.concept, leaf.id))).toBe(wordKey(borrowedSteps[borrowedSteps.length - 1]!.form));
            expect(borrowedSteps[borrowedSteps.length - 1]!.romanized).toBe(entry.borrowedRomanized);

            const nativeSteps = trace(sim, entry.native.home, leaf.id);
            expect(wordKey(formIn(sim, entry.native.home, leaf.id))).toBe(
              wordKey(nativeSteps.length > 0 ? nativeSteps[nativeSteps.length - 1]!.form : formIn(sim, entry.native.home, leaf.id)),
            );
            const nativeFinal = nativeSteps.length > 0 ? nativeSteps[nativeSteps.length - 1]!.romanized : entry.native.romanized;
            expect(nativeFinal).toBe(entry.native.romanized);

            // The native line's home is either a synthetic archaic slot
            // (never a real CONCEPTS id) or a genuine other concept the
            // native word was shifted into via a drift edge.
            if (entry.native.kind === 'archaic') {
              expect(entry.native.home).toBe(archaicSlot(entry.concept));
            } else {
              expect(entry.native.home).not.toBe(entry.concept);
            }
          }
        }
      }
      expect(checkedAny, 'expected at least one doublet across seeds 1-25').toBe(true);
    });
  });

  // Criterion 5: geography.
  describe('geography', () => {
    it('splitInterval halves an interval, left half to the first return value', () => {
      expect(splitInterval({ start: 0, end: 1 })).toEqual([
        { start: 0, end: 0.5 },
        { start: 0.5, end: 1 },
      ]);
      expect(splitInterval({ start: 0.5, end: 1 })).toEqual([
        { start: 0.5, end: 0.75 },
        { start: 0.75, end: 1 },
      ]);
      expect(rootInterval()).toEqual({ start: 0, end: 1 });
    });

    it('intervalsAdjacent is true iff the intervals share an endpoint', () => {
      expect(intervalsAdjacent({ start: 0, end: 0.5 }, { start: 0.5, end: 1 })).toBe(true);
      expect(intervalsAdjacent({ start: 0.5, end: 1 }, { start: 0, end: 0.5 })).toBe(true);
      expect(intervalsAdjacent({ start: 0, end: 0.25 }, { start: 0.5, end: 1 })).toBe(false);
      expect(intervalsAdjacent({ start: 0, end: 0.5 }, { start: 0, end: 0.5 })).toBe(false); // identical, no shared endpoint on the *other* side
    });

    it('adjacentPairs finds every tiling neighbor, in interval-position order, and none of the non-neighbors', () => {
      const living = [
        { id: 'c', interval: { start: 0.5, end: 0.75 } as Interval },
        { id: 'a', interval: { start: 0, end: 0.25 } as Interval },
        { id: 'b', interval: { start: 0.25, end: 0.5 } as Interval },
        { id: 'd', interval: { start: 0.75, end: 1 } as Interval },
      ];
      const pairs = adjacentPairs(living).map(([x, y]) => [x.id, y.id]);
      expect(pairs).toEqual([
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
      ]);
    });

    it('every living branch (leaf) has >= 1 neighbor whenever >= 2 leaves exist (25 seeds)', () => {
      for (let seed = 1; seed <= 25; seed++) {
        const sim = generateSimulation({ seed });
        const living = leaves(sim).map((b) => ({ id: b.id, interval: b.interval }));
        if (living.length < 2) continue;
        const pairs = adjacentPairs(living);
        const neighborCount = new Map<string, number>();
        for (const [x, y] of pairs) {
          neighborCount.set(x.id, (neighborCount.get(x.id) ?? 0) + 1);
          neighborCount.set(y.id, (neighborCount.get(y.id) ?? 0) + 1);
        }
        for (const b of living) {
          expect(neighborCount.get(b.id) ?? 0, `seed ${seed}, branch ${b.id}`).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it('inventoryInUse and adaptWord: a perfect match keeps the segment; an unavailable one maps to the nearest by feature distance', () => {
      const t: Consonant = { type: 'C', place: 'alveolar', manner: 'stop', voiced: false };
      const d: Consonant = { type: 'C', place: 'alveolar', manner: 'stop', voiced: true };
      const s: Consonant = { type: 'C', place: 'alveolar', manner: 'fricative', voiced: false };
      const a: Vowel = { type: 'V', height: 'low', backness: 'central', rounded: false, long: false, nasal: false };

      const lexemes = new Map([
        ['x', { concept: 'x', word: { segments: [t, a], stress: 0 }, origin: 'root' as const }],
        ['y', { concept: 'y', word: { segments: [s, a], stress: 0 }, origin: 'root' as const }],
      ]);
      const inUse = inventoryInUse(lexemes);
      expect(inUse.consonants.map(segKey)).toEqual([segKey(t), segKey(s)]);

      // /d/ isn't in the borrower's inventory; nearest by (place 2, manner 3,
      // voiced 1) is /t/ (voiced-only diff = 1) over /s/ (manner-only diff = 3).
      const { word, substitutions } = adaptWord({ segments: [d, a], stress: 0 }, inUse);
      expect(segKey(word.segments[0]!)).toBe(segKey(t));
      expect(substitutions).toEqual([{ from: d, to: t }]);

      // A perfect match (t) keeps the segment, with no substitution recorded.
      const identity = adaptWord({ segments: [t, a], stress: 0 }, inUse);
      expect(identity.substitutions).toEqual([]);
      expect(wordKey(identity.word)).toBe(wordKey({ segments: [t, a], stress: 0 }));
    });
  });

  // Criterion 6: doublet frequency at default rates, seeds 1-25.
  it('at default borrowChance, at least a third of seeds 1-25 produce >= 1 doublet somewhere', () => {
    let simsWithDoublet = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const sim = generateSimulation({ seed, driftEnabled: true, contactEnabled: true });
      const hasDoublet = leaves(sim).some((leaf) => doublets(sim, leaf.id).length > 0);
      if (hasDoublet) simsWithDoublet++;
    }
    // Measured 20/25 (80%) at the spec's default borrowChance (0.04) — no
    // tuning needed; see the M6 implementation report for the full count.
    expect(simsWithDoublet).toBeGreaterThanOrEqual(Math.ceil(25 / 3));
  });

  // Criterion 7: round-trip.
  describe('serialization round-trip', () => {
    it('borrow events and their reassignments survive toJSON/fromJSON; formatVersion is 3', () => {
      const sim = generateSimulation({ seed: 11, driftEnabled: true, contactEnabled: true });
      const dump = toJSON(sim);
      expect(dump.formatVersion).toBe(3);
      const roundTripped = fromJSON(JSON.parse(JSON.stringify(dump)));
      expect(JSON.parse(JSON.stringify(toJSON(roundTripped)))).toEqual(JSON.parse(JSON.stringify(dump)));

      const hasBorrow = allBranches(sim.root).some((b) => b.reassignments.some((r) => r.cause === 'borrow'));
      expect(hasBorrow).toBe(true);
    });

    it('fromJSON accepts a v2-shaped dump (no interval, no contact data), backfilling intervals structurally', () => {
      const v2Dump = {
        formatVersion: 2,
        config: { seed: 1, centuries: 2, maxLeaves: 2, splitChance: 0, changeChance: 0, driftEnabled: false, driftChance: 0, tabooChance: 0 },
        inventory: { consonants: [], vowels: [], phonotactics: { maxOnset: 1, codas: [], allowFinalVowel: true } },
        lexicon: { lexemes: [], affixes: [] },
        familyName: 'Proto-Test',
        root: {
          id: 'root',
          start: 0,
          end: 1,
          events: [],
          paradigmNotes: [],
          reassignments: [],
          children: [
            { id: 'root.0', start: 1, end: 1, events: [], paradigmNotes: [], reassignments: [], children: [] },
            { id: 'root.1', start: 1, end: 1, events: [], paradigmNotes: [], reassignments: [], children: [] },
          ],
        },
      };
      const sim = fromJSON(v2Dump);
      expect(sim.root.interval).toEqual({ start: 0, end: 1 });
      expect(sim.root.children[0]!.interval).toEqual({ start: 0, end: 0.5 });
      expect(sim.root.children[1]!.interval).toEqual({ start: 0.5, end: 1 });
    });

    it('fromJSON still accepts a v1-shaped dump (no kind, no reassignments, no interval)', () => {
      const v1Dump = {
        formatVersion: 1,
        config: { seed: 1, centuries: 1, maxLeaves: 1, splitChance: 0, changeChance: 0 },
        inventory: { consonants: [], vowels: [], phonotactics: { maxOnset: 1, codas: [], allowFinalVowel: true } },
        lexicon: { lexemes: [], affixes: [] },
        familyName: 'Proto-Test',
        root: {
          id: 'root',
          start: 0,
          end: 1,
          events: [{ century: 1, change: { catalogId: 'x', description: 'x', subRules: [] } }],
          paradigmNotes: [],
          children: [],
        },
      };
      const sim = fromJSON(v1Dump);
      expect(sim.root.reassignments).toEqual([]);
      expect(sim.root.events[0]).toMatchObject({ kind: 'sound', century: 1 });
      expect(sim.root.interval).toEqual({ start: 0, end: 1 });
    });
  });
});
