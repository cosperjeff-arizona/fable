// M3 acceptance tests (specs/M3.md's "Acceptance criteria" 1-7).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateSimulation, type Branch } from '../src/history.js';
import { cognates, formIn, leaves, trace } from '../src/query.js';
import { renderGenerate } from '../src/render.js';
import { fromJSON, toJSON } from '../src/serialize.js';
import { wordKey } from '../src/phonology.js';
import { CONCEPTS } from '../src/concepts.js';

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

describe('M3 acceptance', () => {
  // Criterion 1: golden full-text output of `generate`.
  it.each(GOLDEN_SEEDS)('golden generate output, seed %i', (seed) => {
    const sim = generateSimulation({ seed });
    expect(renderGenerate(sim).join('\n')).toMatchSnapshot();
  });

  // Criterion 2: trace fidelity — trace final form === formIn === cognate row.
  it('trace, formIn, and cognates agree for every leaf (10 seeds x 20 concepts)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const sim = generateSimulation({ seed });
      const sample = CONCEPTS.slice(0, 20);
      for (const concept of sample) {
        const rows = cognates(sim, concept.id);
        for (const leaf of leaves(sim)) {
          const steps = trace(sim, concept.id, leaf.id);
          const viaForm = formIn(sim, concept.id, leaf.id);
          const viaRow = rows.find((r) => r.branchId === leaf.id)!.form;
          expect(wordKey(viaForm)).toBe(wordKey(viaRow));
          if (steps.length > 0) {
            expect(wordKey(steps[steps.length - 1]!.form)).toBe(wordKey(viaForm));
          } else {
            const proto = sim.lexicon.lexemes.find((l) => l.concept === concept.id)!;
            expect(wordKey(viaForm)).toBe(wordKey({ segments: proto.word.segments, stress: proto.word.stress }));
          }
        }
      }
    }
  });

  // Criterion 3: JSON round-trip, and the committed example dump is exactly
  // what seed 42 regenerates to. Both sides are JSON-normalized so
  // `undefined` fields (dropped by JSON) compare equal to missing ones.
  it('toJSON/fromJSON round-trips', () => {
    const sim = generateSimulation({ seed: 42 });
    const dump = toJSON(sim);
    expect(JSON.parse(JSON.stringify(toJSON(fromJSON(JSON.parse(JSON.stringify(dump))))))).toEqual(
      JSON.parse(JSON.stringify(dump)),
    );
  });

  it('examples/seed42.json matches a fresh seed-42 simulation', () => {
    const onDisk = JSON.parse(readFileSync('examples/seed42.json', 'utf8'));
    const fresh = JSON.parse(JSON.stringify(toJSON(generateSimulation({ seed: 42 }))));
    expect(onDisk).toEqual(fresh);
  });

  // Criterion 4: unique leaf names.
  it('leaf names are unique (25 seeds)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const names = leaves(generateSimulation({ seed })).map((l) => l.name);
      expect(names.every((n) => typeof n === 'string' && n.length > 0)).toBe(true);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  // Criterion 5: no silent branches.
  it('every branch spanning >= 2 centuries has >= 1 event (25 seeds)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const sim = generateSimulation({ seed });
      for (const b of allBranches(sim.root)) {
        if (b.end - b.start >= 2) {
          expect(b.events.length, `seed ${seed}, branch ${b.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  // Criterion 6: performance.
  it('a full default simulation completes in < 2s', () => {
    const t0 = Date.now();
    generateSimulation({ seed: 12345 });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  // Criterion 7: stream discipline — tree shape must not reshuffle branch
  // histories. Root logs must be identical across maxLeaves settings, and
  // any branch id present in both trees must have identical events over the
  // centuries where both instances were alive.
  it('maxLeaves 2 vs 6 yields identical histories for shared branch ids', () => {
    for (const seed of GOLDEN_SEEDS) {
      const a = generateSimulation({ seed, maxLeaves: 2 });
      const b = generateSimulation({ seed, maxLeaves: 6 });
      const byIdA = new Map(allBranches(a.root).map((br) => [br.id, br]));
      const byIdB = new Map(allBranches(b.root).map((br) => [br.id, br]));
      let shared = 0;
      for (const [id, brA] of byIdA) {
        const brB = byIdB.get(id);
        if (!brB) continue;
        shared++;
        const horizon = Math.min(brA.end, brB.end);
        const evA = brA.events.filter((e) => e.century <= horizon);
        const evB = brB.events.filter((e) => e.century <= horizon);
        expect(JSON.stringify(evA), `seed ${seed}, branch ${id}`).toBe(JSON.stringify(evB));
      }
      expect(shared).toBeGreaterThan(0);
      expect(JSON.stringify(byIdA.get('root')!.events)).toBe(JSON.stringify(byIdB.get('root')!.events));
    }
  });
});
