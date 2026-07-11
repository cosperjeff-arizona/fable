// Pure query functions over a `Simulation` (specs/M3.md's "src/query.ts").
//
// `trace`/`formIn`/`cognates` all bottom out in the same helper
// (`evolveAlongEvents`), which replays a proto Word through a branch's
// path-events using M2's `applySubRules` — the exact function the
// simulation itself used to build its cached per-branch working lexicon
// (src/history.ts's `applyChangeToBranch` calls `applyChange`, which is
// `applySubRules(word, change.subRules)`). Same code, same order of
// subRules, same word-guard behavior, so a trace's final form is
// guaranteed to match the simulation's own cached form and the cognate
// table (specs/M3.md acceptance criterion 2).

import type { Branch, ChangeEvent, Simulation } from './history.js';
import type { Word } from './phonology.js';
import { applySubRules } from './changes/apply.js';
import { romanize } from './romanize.js';

export function leaves(sim: Simulation): Branch[] {
  const out: Branch[] = [];
  const walk = (b: Branch): void => {
    if (b.children.length === 0) out.push(b);
    else for (const c of b.children) walk(c);
  };
  walk(sim.root);
  return out;
}

/** Root-to-`branchId` path, inclusive of both ends. Throws if no branch with
 * that id exists in the tree. */
export function pathTo(sim: Simulation, branchId: string): Branch[] {
  const path: Branch[] = [];
  const walk = (b: Branch): boolean => {
    path.push(b);
    if (b.id === branchId) return true;
    for (const c of b.children) if (walk(c)) return true;
    path.pop();
    return false;
  };
  if (!walk(sim.root)) throw new Error(`pathTo: no branch with id "${branchId}"`);
  return path;
}

function pathEvents(sim: Simulation, branchId: string): ChangeEvent[] {
  return pathTo(sim, branchId).flatMap((b) => b.events);
}

function protoWord(sim: Simulation, conceptId: string): Word {
  const lex = sim.lexicon.lexemes.find((l) => l.concept === conceptId);
  if (!lex) throw new Error(`unknown concept "${conceptId}"`);
  return { segments: lex.word.segments, stress: lex.word.stress };
}

export type TraceStep = {
  century: number;
  catalogId: string;
  description: string;
  form: Word;
  romanized: string;
};

/** Replay `events` over `word` in chronological order, recording only steps
 * that actually altered the form (mirrors specs/M2.md's `evolve`). */
function evolveAlongEvents(word: Word, events: readonly ChangeEvent[]): { form: Word; steps: TraceStep[] } {
  const steps: TraceStep[] = [];
  let cur = word;
  for (const ev of events) {
    const next = applySubRules(cur, ev.change.subRules);
    if (next !== cur) {
      steps.push({
        century: ev.century,
        catalogId: ev.change.catalogId,
        description: ev.change.description,
        form: next,
        romanized: romanize(next),
      });
      cur = next;
    }
  }
  return { form: cur, steps };
}

/** The proto root for `conceptId`, evolved through `branchId`'s full
 * ancestor path. */
export function formIn(sim: Simulation, conceptId: string, branchId: string): Word {
  return evolveAlongEvents(protoWord(sim, conceptId), pathEvents(sim, branchId)).form;
}

/** Etymology of `conceptId` in `branchId`: one step per form-altering change
 * along the path, oldest first. */
export function trace(sim: Simulation, conceptId: string, branchId: string): TraceStep[] {
  return evolveAlongEvents(protoWord(sim, conceptId), pathEvents(sim, branchId)).steps;
}

export type CognateRow = { branchId: string; name: string; form: Word };

/** One row per leaf, in tree order. */
export function cognates(sim: Simulation, conceptId: string): CognateRow[] {
  const word = protoWord(sim, conceptId);
  return leaves(sim).map((leaf) => ({
    branchId: leaf.id,
    name: leaf.name ?? leaf.id,
    form: evolveAlongEvents(word, pathEvents(sim, leaf.id)).form,
  }));
}
