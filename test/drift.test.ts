// M5 acceptance tests (specs/M5.md's "Acceptance criteria").

import { describe, expect, it } from 'vitest';
import {
  DRIFT_EDGES,
  REFILL_TEMPLATES,
  TABOO_CONCEPTS,
  checkGraphIntegrity,
  type DriftEvent,
} from '../src/drift.js';
import { compoundWord } from '../src/lexicon.js';
import { CONCEPTS } from '../src/concepts.js';
import { generateSimulation, type Branch, type ChangeEvent, type Simulation, type SoundChangeEvent } from '../src/history.js';
import { formIn, leaves, trace } from '../src/query.js';
import { renderGenerate } from '../src/render.js';
import { fromJSON, toJSON } from '../src/serialize.js';
import { wordKey, type Consonant, type Vowel, type Word } from '../src/phonology.js';
import { Stream } from '../src/prng.js';

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

function soundEventsOnly(events: readonly ChangeEvent[]): SoundChangeEvent[] {
  return events.filter((e): e is SoundChangeEvent => e.kind === 'sound');
}

describe('M5 acceptance', () => {
  // Criterion 5: graph integrity.
  describe('graph integrity', () => {
    it('checkGraphIntegrity does not throw (every DRIFT_EDGES/TABOO_CONCEPTS/REFILL_TEMPLATES id is a real concept)', () => {
      expect(() => checkGraphIntegrity()).not.toThrow();
    });

    it('every DRIFT_EDGES endpoint is a known concept id', () => {
      const known = new Set(CONCEPTS.map((c) => c.id));
      for (const e of DRIFT_EDGES) {
        expect(known.has(e.from), `unknown concept "${e.from}"`).toBe(true);
        expect(known.has(e.to), `unknown concept "${e.to}"`).toBe(true);
      }
    });

    it('every TABOO_CONCEPTS entry and euphemism part is a known concept id', () => {
      const known = new Set(CONCEPTS.map((c) => c.id));
      for (const t of TABOO_CONCEPTS) {
        expect(known.has(t.concept), `unknown concept "${t.concept}"`).toBe(true);
        for (const [a, b] of t.euphemisms) {
          expect(known.has(a), `unknown concept "${a}"`).toBe(true);
          expect(known.has(b), `unknown concept "${b}"`).toBe(true);
        }
      }
    });

    it('every REFILL_TEMPLATES key and part is a known concept id', () => {
      const known = new Set(CONCEPTS.map((c) => c.id));
      for (const [concept, templates] of Object.entries(REFILL_TEMPLATES)) {
        expect(known.has(concept), `unknown concept "${concept}"`).toBe(true);
        for (const [a, b] of templates) {
          expect(known.has(a), `unknown concept "${a}"`).toBe(true);
          expect(known.has(b), `unknown concept "${b}"`).toBe(true);
        }
      }
    });
  });

  // Criterion 1 (second half): with drift enabled, the sound-change event
  // sequence per branch is byte-identical to the drift-disabled run —
  // because drift draws exclusively from the separate `drift:<branchId>`
  // stream family.
  describe('sound-change stream independence from drift', () => {
    it.each(GOLDEN_SEEDS)('seed %i: sound-change events are identical with drift on vs off', (seed) => {
      const off = generateSimulation({ seed, driftEnabled: false });
      const on = generateSimulation({ seed, driftEnabled: true });
      const offById = new Map(allBranches(off.root).map((b) => [b.id, b] as const));
      const onById = new Map(allBranches(on.root).map((b) => [b.id, b] as const));
      expect(onById.size).toBeGreaterThan(0);
      for (const [id, offBranch] of offById) {
        const onBranch = onById.get(id);
        expect(onBranch, `branch ${id} missing when drift enabled`).toBeDefined();
        expect(JSON.stringify(soundEventsOnly(onBranch!.events))).toBe(JSON.stringify(soundEventsOnly(offBranch.events)));
      }
    });

    it('--no-drift-equivalent (driftEnabled: false) output is unchanged from the M3-era default', () => {
      // Sanity check mirroring test/history.test.ts's existing golden
      // tests: since DEFAULT_SIM_CONFIG.driftEnabled is false, an explicit
      // `driftEnabled: false` must render identically to omitting it.
      for (const seed of GOLDEN_SEEDS) {
        const implicit = generateSimulation({ seed });
        const explicit = generateSimulation({ seed, driftEnabled: false });
        expect(renderGenerate(explicit).join('\n')).toBe(renderGenerate(implicit).join('\n'));
      }
    });
  });

  // Criterion 2: new goldens (drift enabled) for seeds 1/42/2026, showing at
  // least one shift, one extend, and one taboo event combined.
  describe('drift-enabled goldens', () => {
    it.each(GOLDEN_SEEDS)('golden generate output with drift enabled, seed %i', (seed) => {
      const sim = generateSimulation({ seed, driftEnabled: true });
      expect(renderGenerate(sim).join('\n')).toMatchSnapshot();
    });

    it('across seeds 1/42/2026 combined, drift produces at least one shift, one extend, and one taboo event', () => {
      const kinds = new Set<DriftEvent['kind']>();
      for (const seed of GOLDEN_SEEDS) {
        const sim = generateSimulation({ seed, driftEnabled: true });
        for (const b of allBranches(sim.root)) {
          for (const ev of b.events) {
            if (ev.kind !== 'sound') kinds.add(ev.kind);
          }
        }
      }
      expect(kinds.has('shift'), 'expected at least one shift event').toBe(true);
      expect(kinds.has('extend'), 'expected at least one extend event').toBe(true);
      expect(kinds.has('taboo'), 'expected at least one taboo event').toBe(true);
    });
  });

  // Criterion 3: properties over >= 25 seeds.
  describe('drift properties (25 seeds)', () => {
    const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

    it('every concept is expressible (formIn resolves without throwing) in every leaf', () => {
      for (const seed of SEEDS) {
        const sim = generateSimulation({ seed, driftEnabled: true });
        for (const leaf of leaves(sim)) {
          for (const concept of CONCEPTS) {
            expect(() => formIn(sim, concept.id, leaf.id), `seed ${seed}, leaf ${leaf.id}, concept ${concept.id}`).not.toThrow();
          }
        }
      }
    });

    it('no branch exceeds one shift/extend drift event per century', () => {
      for (const seed of SEEDS) {
        const sim = generateSimulation({ seed, driftEnabled: true });
        for (const b of allBranches(sim.root)) {
          const counts = new Map<number, number>();
          for (const ev of b.events) {
            if (ev.kind === 'shift' || ev.kind === 'extend') {
              counts.set(ev.century, (counts.get(ev.century) ?? 0) + 1);
            }
          }
          for (const [century, count] of counts) {
            expect(count, `seed ${seed}, branch ${b.id}, century ${century}`).toBeLessThanOrEqual(1);
          }
        }
      }
    });

    it('no concept drifts (shift/extend) twice within 3 centuries on one path', () => {
      for (const seed of SEEDS) {
        const sim = generateSimulation({ seed, driftEnabled: true });
        for (const leaf of leaves(sim)) {
          const path = (function collectPath(): Branch[] {
            const out: Branch[] = [];
            const walk = (b: Branch): boolean => {
              out.push(b);
              if (b.id === leaf.id) return true;
              for (const c of b.children) if (walk(c)) return true;
              out.pop();
              return false;
            };
            walk(sim.root);
            return out;
          })();
          const driftEvents = path.flatMap((b) => b.events).filter((e): e is Extract<DriftEvent, { kind: 'shift' | 'extend' }> =>
            e.kind === 'shift' || e.kind === 'extend',
          );
          const lastTouch = new Map<string, number>();
          for (const ev of driftEvents) {
            for (const concept of [ev.from, ev.to]) {
              const last = lastTouch.get(concept);
              if (last !== undefined) {
                expect(ev.century - last, `seed ${seed}, leaf ${leaf.id}, concept ${concept}`).toBeGreaterThanOrEqual(3);
              }
              lastTouch.set(concept, ev.century);
            }
          }
        }
      }
    });
  });

  // Criterion 4: the erosion property — a scripted history where a coinage
  // at century N is followed by sound change, demonstrating the coined
  // word's final form differs from a freshly-built compound of the parts'
  // (independently-eroded) final forms.
  describe('erosion property', () => {
    const T: Consonant = { type: 'C', place: 'alveolar', manner: 'stop', voiced: false };
    const D: Consonant = { type: 'C', place: 'alveolar', manner: 'stop', voiced: true };
    const P: Consonant = { type: 'C', place: 'labial', manner: 'stop', voiced: false };
    const N: Consonant = { type: 'C', place: 'alveolar', manner: 'nasal', voiced: true };
    const a: Vowel = { type: 'V', height: 'low', backness: 'central', rounded: false, long: false, nasal: false };
    const e: Vowel = { type: 'V', height: 'mid', backness: 'front', rounded: false, long: false, nasal: false };

    // A rule that deletes any word-final consonant — deliberately
    // environment-sensitive (only fires at the *word* edge), so its effect
    // depends on whether a given consonant is word-final at the moment the
    // rule runs.
    const DELETE_FINAL_C = {
      catalogId: 'test-final-c-delete',
      description: 'test: delete word-final consonant',
      subRules: [{ match: { type: 'C' as const }, env: { after: [{ kind: 'boundary' as const }] }, action: { kind: 'delete' as const } }],
    };

    it('a coined word erodes differently than a fresh recompound of its parts (final forms)', () => {
      const dayWord: Word = { segments: [T, a, D], stress: 1 }; // "tad"
      const eyeWord: Word = { segments: [P, e, N], stress: 1 }; // "pen"

      const dummyInventory = { consonants: [], vowels: [], phonotactics: { maxOnset: 1 as const, codas: [], allowFinalVowel: true } };
      const coinedWord = compoundWord(
        { concept: 'day', word: dayWord, origin: 'root' },
        { concept: 'eye', word: eyeWord, origin: 'root' },
        dummyInventory,
        new Stream(1),
        [],
      ); // "tadpen" — no collision, so this is a pure concatenation

      const COINAGE_CENTURY = 5;
      const SOUND_CHANGE_CENTURY = 6;

      const sim: Simulation = {
        config: { seed: 0, centuries: 6, maxLeaves: 1, splitChance: 0, changeChance: 0, driftEnabled: true, driftChance: 0, tabooChance: 0 },
        inventory: dummyInventory as never,
        lexicon: {
          lexemes: [
            { concept: 'day', origin: 'root', parts: null, word: { ...dayWord, romanized: 'tad' } },
            { concept: 'eye', origin: 'root', parts: null, word: { ...eyeWord, romanized: 'pen' } },
            { concept: 'sun', origin: 'root', parts: null, word: { segments: [a], stress: 0, romanized: 'a' } }, // dead: overridden below
          ],
          affixes: [],
        },
        familyName: 'Proto-Test',
        root: {
          id: 'root',
          start: 0,
          end: 6,
          events: [{ kind: 'sound', century: SOUND_CHANGE_CENTURY, change: DELETE_FINAL_C }],
          paradigmNotes: [],
          reassignments: [
            {
              century: COINAGE_CENTURY,
              concept: 'sun',
              word: { segments: coinedWord.segments, stress: coinedWord.stress },
              cause: 'coinage',
              parts: ['day', 'eye'],
              origin: 'compound',
            },
          ],
          children: [],
        },
      };

      // Both 'day' and 'eye' independently replay the SAME sound-change
      // event along the same path (they were never reassigned), so each
      // loses its OWN word-final consonant.
      const dayFinal = formIn(sim, 'day', 'root'); // "ta" (loses final d)
      const eyeFinal = formIn(sim, 'eye', 'root'); // "pe" (loses final n)
      const freshRecompound: Word = { segments: [...dayFinal.segments, ...eyeFinal.segments], stress: 1 };

      // 'sun', however, was coined at century 5 from day+eye's *then*
      // forms, joining them into one word *before* the century-6 change
      // ran — so only the compound's own final segment (eye's n) is
      // word-final at that point; day's d is now compound-medial and
      // survives.
      const sunFinal = formIn(sim, 'sun', 'root'); // "tadpe" (only loses final n)

      expect(wordKey(sunFinal)).not.toBe(wordKey(freshRecompound));
      // Concretely: the coined word keeps day's medial /d/ that a fresh
      // recompound of the independently-eroded parts would have already
      // lost — this is the erosion property.
      expect(sunFinal.segments.some((s) => s.type === 'C' && s.place === 'alveolar' && s.manner === 'stop' && s.voiced)).toBe(true);
      expect(freshRecompound.segments.some((s) => s.type === 'C' && s.place === 'alveolar' && s.manner === 'stop' && s.voiced)).toBe(
        false,
      );

      // The trace itself starts at the coinage century with a semantic
      // step, then shows only the post-coinage sound change.
      const steps = trace(sim, 'sun', 'root');
      expect(steps[0]!.kind).toBe('semantic');
      expect(steps[0]!.century).toBe(COINAGE_CENTURY);
      expect(steps[0]!.description).toContain('day');
      expect(steps[0]!.description).toContain('eye');
      expect(steps[1]!.kind).toBe('sound');
      expect(steps[1]!.century).toBe(SOUND_CHANGE_CENTURY);
    });
  });

  // Criterion 6: determinism + round-trip.
  describe('serialization round-trip', () => {
    it('drift/taboo/coinage events and reassignments survive toJSON/fromJSON', () => {
      const sim = generateSimulation({ seed: 1, driftEnabled: true });
      const dump = toJSON(sim);
      // specs/M6.md bumped formatVersion from 2 to 3 (adds contact/borrowing
      // data); this drift/coinage round-trip still exercises the same M5
      // reassignment machinery regardless of the version number.
      expect(dump.formatVersion).toBe(3);
      const roundTripped = fromJSON(JSON.parse(JSON.stringify(dump)));
      expect(JSON.parse(JSON.stringify(toJSON(roundTripped)))).toEqual(JSON.parse(JSON.stringify(dump)));

      // Sanity: at least one branch actually carries drift data worth
      // round-tripping (otherwise this test would trivially pass).
      const hasDrift = allBranches(sim.root).some((b) => b.reassignments.length > 0 || b.events.some((e) => e.kind !== 'sound'));
      expect(hasDrift).toBe(true);
    });

    it('fromJSON accepts a v1-shaped dump, treating missing drift data as empty', () => {
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
          // v1 shape: no `kind` on events, no `reassignments` on the branch.
          events: [{ century: 1, change: { catalogId: 'x', description: 'x', subRules: [] } }],
          paradigmNotes: [],
          children: [
            { id: 'root.child', start: 1, end: 1, events: [], paradigmNotes: [], children: [] },
          ],
        },
      };
      const sim = fromJSON(v1Dump);
      expect(sim.root.reassignments).toEqual([]);
      expect(sim.root.events[0]).toMatchObject({ kind: 'sound', century: 1 });
      expect(sim.root.children[0]!.reassignments).toEqual([]);
    });
  });
});
