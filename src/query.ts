// Pure query functions over a `Simulation` (specs/M3.md's "src/query.ts";
// extended by specs/M5.md for semantic drift/taboo/coinage).
//
// `trace`/`formIn`/`cognates` all bottom out in `resolveConcept`, which
// replays a word through a branch's path using M2's `applySubRules` — the
// exact function the simulation itself used to build its cached per-branch
// working lexicon. Before M5 the base was always the concept's proto root,
// replayed through every sound-change event on the path (specs/M3.md
// acceptance criterion 2). M5 adds one branch: if the branch's path has a
// `LexemeReassignment` for this concept (a drift shift/extend target, or a
// coinage that refilled a gap or replaced a taboo word), the base becomes
// *that* reassignment's stored form — captured by src/history.ts at the
// moment of coinage from the branch's then-current evolved lexemes — and
// only sound changes *after* that century are replayed on top of it. This
// is the erosion property: a coined word keeps eroding from its coinage
// shape, never from the family's proto root (specs/M5.md acceptance
// criterion 4). When no reassignment exists (drift disabled, or this
// concept's path never had one), behavior is byte-identical to pre-M5.

import type { Branch, ChangeEvent, Simulation, SoundChangeEvent } from './history.js';
import type { DriftEvent, LexemeReassignment } from './drift.js';
import { archaicSlot } from './contact.js';
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

function isSoundEvent(ev: ChangeEvent): ev is SoundChangeEvent {
  return ev.kind === 'sound';
}

/** Note: 'shift'/'extend'/'taboo' only — NOT 'borrow' (specs/M6.md's
 * `BorrowEvent`, which `semanticNotes`/etc. read straight off
 * `LexemeReassignment` instead — see `pathReassignments`). Before M6,
 * `ChangeEvent` was just `SoundChangeEvent | DriftEvent`, so "not sound" and
 * "is drift" were equivalent; with `BorrowEvent` added to the union that's
 * no longer true, so this checks `kind` explicitly. */
function isDriftEvent(ev: ChangeEvent): ev is DriftEvent {
  return ev.kind === 'shift' || ev.kind === 'extend' || ev.kind === 'taboo';
}

function pathSoundEvents(sim: Simulation, branchId: string): SoundChangeEvent[] {
  return pathEvents(sim, branchId).filter(isSoundEvent);
}

function pathDriftEvents(sim: Simulation, branchId: string): DriftEvent[] {
  return pathEvents(sim, branchId).filter(isDriftEvent);
}

/** Every reassignment recorded for `conceptId` along `branchId`'s ancestor
 * path, oldest first (branches are visited root-to-leaf, and each branch's
 * own `reassignments` array is already chronological — see
 * src/history.ts's per-century loop). */
function pathReassignments(sim: Simulation, branchId: string, conceptId: string): LexemeReassignment[] {
  return pathTo(sim, branchId).flatMap((b) => b.reassignments.filter((r) => r.concept === conceptId));
}

function latestReassignment(sim: Simulation, branchId: string, conceptId: string): LexemeReassignment | undefined {
  const list = pathReassignments(sim, branchId, conceptId);
  return list[list.length - 1];
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
  /** 'semantic' for a reassignment milestone (coinage/shift/extend/taboo
   * origin); 'sound' for an ordinary sound-change step. Additive over
   * specs/M3.md's TraceStep — existing consumers that never read `kind`
   * are unaffected. */
  kind: 'sound' | 'semantic';
  /** specs/M7.md addition: for a 'semantic' step, the reassignment's cause
   * and (for coinage/taboo-coinage) its parts — lets render.ts build
   * cause-specific display text (e.g. embedding this step's own `form` as
   * an "origin-time" spelled form) without parsing `description`. Present
   * only when `kind === 'semantic'`; `undefined` for ordinary sound steps. */
  cause?: LexemeReassignment['cause'];
  parts?: string[];
};

/** Replay `events` over `word` in chronological order, recording only steps
 * that actually altered the form (mirrors specs/M2.md's `evolve`). */
function replaySound(word: Word, events: readonly SoundChangeEvent[]): { form: Word; steps: TraceStep[] } {
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
        kind: 'sound',
      });
      cur = next;
    }
  }
  return { form: cur, steps };
}

function reassignmentDescription(sim: Simulation, r: LexemeReassignment): string {
  switch (r.cause) {
    case 'shift-target':
      return `semantic shift: originally '${r.sourceConcept}'; came to mean '${r.concept}'`;
    case 'extend-target':
      return `semantic extension: colexified with '${r.sourceConcept}'`;
    case 'coinage':
      return `coined from ${(r.parts ?? []).join(' + ')}`;
    case 'taboo-coinage':
      return `taboo replacement, coined from ${(r.parts ?? []).join(' + ')}`;
    case 'borrow':
      return `borrowed from ${branchDisplayLabel(sim, r.fromBranchId!)} "${r.sourceRomanized}" (${r.adaptationNote})`;
    case 'loan-displacement':
      return r.concept === archaicSlot(r.sourceConcept ?? '')
        ? `archaic/register variant, displaced by a loanword for '${r.sourceConcept}'`
        : `native word for '${r.sourceConcept}', displaced by a loanword`;
  }
}

/** Core resolver (specs/M5.md's erosion property): the base form + form-
 * altering steps for `conceptId` in `branchId`, honoring the latest
 * reassignment on the path if there is one. */
function resolveConcept(sim: Simulation, conceptId: string, branchId: string): { form: Word; steps: TraceStep[] } {
  const soundEvents = pathSoundEvents(sim, branchId);
  const reassignment = latestReassignment(sim, branchId, conceptId);

  if (!reassignment) {
    return replaySound(protoWord(sim, conceptId), soundEvents);
  }

  const base: Word = { segments: reassignment.word.segments, stress: reassignment.word.stress };
  const laterEvents = soundEvents.filter((e) => e.century > reassignment.century);
  const semanticStep: TraceStep = {
    century: reassignment.century,
    catalogId: '',
    description: reassignmentDescription(sim, reassignment),
    form: base,
    romanized: romanize(base),
    kind: 'semantic',
    cause: reassignment.cause,
    parts: reassignment.parts,
  };
  const { form, steps } = replaySound(base, laterEvents);
  return { form, steps: [semanticStep, ...steps] };
}

/** The proto root for `conceptId`, evolved through `branchId`'s full
 * ancestor path — or, if drift reassigned this concept's word somewhere
 * along that path, evolved from the reassignment's stored form instead
 * (specs/M5.md). */
export function formIn(sim: Simulation, conceptId: string, branchId: string): Word {
  return resolveConcept(sim, conceptId, branchId).form;
}

/** Etymology of `conceptId` in `branchId`: one step per form-altering
 * change along the path, oldest first — plus, if this concept's word was
 * ever reassigned (coined, shifted into, extended into, or replaced by a
 * taboo euphemism), a leading 'semantic' step at the reassignment century
 * (specs/M5.md: "trace for a coined word starts at the coinage century"). */
export function trace(sim: Simulation, conceptId: string, branchId: string): TraceStep[] {
  return resolveConcept(sim, conceptId, branchId).steps;
}

/** Human-readable semantic-history lines for `conceptId` in `branchId`
 * (specs/M5.md's `dict` "notes"): drift/extend/taboo event notes that
 * mention this concept, plus a coinage note if its current word was coined,
 * oldest first. */
export function semanticNotes(sim: Simulation, conceptId: string, branchId: string): string[] {
  const notes: string[] = [];
  for (const ev of pathDriftEvents(sim, branchId)) {
    if (ev.kind === 'taboo' && ev.concept === conceptId) notes.push(ev.note);
    else if ((ev.kind === 'shift' || ev.kind === 'extend') && (ev.to === conceptId || ev.from === conceptId)) {
      notes.push(ev.note);
    }
  }
  for (const r of pathReassignments(sim, branchId, conceptId)) {
    if (r.cause === 'coinage' || r.cause === 'taboo-coinage') {
      notes.push(`coined c. year ${r.century * 100} from ${(r.parts ?? []).join(' + ')}`);
    } else if (r.cause === 'borrow') {
      notes.push(`borrowed from ${branchDisplayLabel(sim, r.fromBranchId!)}, c. year ${r.century * 100}`);
    } else if (r.cause === 'loan-displacement') {
      notes.push(`archaic/register variant (displaced by a loanword for '${r.sourceConcept}', c. year ${r.century * 100})`);
    }
  }
  return notes;
}

/** Current sense(s) `conceptId`'s word covers in `branchId` (specs/M5.md's
 * `dict` "senses"): itself, plus any concept it's colexified with via an
 * `extend` drift event (in either direction — it may have received another
 * concept's word, or lent its own word to another concept). Always
 * contains at least `conceptId`. */
export function senses(sim: Simulation, conceptId: string, branchId: string): string[] {
  const result = new Set<string>([conceptId]);
  const own = latestReassignment(sim, branchId, conceptId);
  if (own?.cause === 'extend-target' && own.sourceConcept) result.add(own.sourceConcept);
  for (const lex of sim.lexicon.lexemes) {
    if (lex.concept === conceptId) continue;
    const r = latestReassignment(sim, branchId, lex.concept);
    if (r?.cause === 'extend-target' && r.sourceConcept === conceptId) result.add(lex.concept);
  }
  return [...result];
}

/** True if `conceptId`'s current word in `branchId` was coined (refilling a
 * drift gap, or a generic re-derivation), including as a taboo euphemism. */
export function isCoined(sim: Simulation, conceptId: string, branchId: string): boolean {
  const r = latestReassignment(sim, branchId, conceptId);
  return r?.cause === 'coinage' || r?.cause === 'taboo-coinage';
}

/** True if `conceptId`'s current word in `branchId` is a taboo euphemism. */
export function isTabooed(sim: Simulation, conceptId: string, branchId: string): boolean {
  return latestReassignment(sim, branchId, conceptId)?.cause === 'taboo-coinage';
}

export type CoinageInfo = { century: number; origin: 'compound' | 'derived'; parts: string[]; taboo: boolean };

/** If `conceptId`'s current word in `branchId` was coined (refill or taboo
 * euphemism), the coinage's century/parts/origin; `null` if it's still the
 * concept's own inherited word. Used by `dict`/`trace` rendering, which
 * needs the *current* compounding, not the (possibly stale) proto-level
 * derivation recorded in `sim.lexicon`. */
export function coinageInfo(sim: Simulation, conceptId: string, branchId: string): CoinageInfo | null {
  const r = latestReassignment(sim, branchId, conceptId);
  if (!r || (r.cause !== 'coinage' && r.cause !== 'taboo-coinage')) return null;
  return { century: r.century, origin: r.origin ?? 'compound', parts: r.parts ?? [], taboo: r.cause === 'taboo-coinage' };
}

/** True if `conceptId`'s word in `branchId` genuinely descends from the
 * family's proto root via sound change alone — i.e. was never reassigned
 * by drift/taboo/coinage. Non-cognate forms are the honest exception in a
 * cognate table (specs/M5.md's `cognates` `†` marker). */
export function isCognate(sim: Simulation, conceptId: string, branchId: string): boolean {
  return latestReassignment(sim, branchId, conceptId) === undefined;
}

/** True if `conceptId`'s current word in `branchId` is a loan (specs/M6.md's
 * `cognates` `‡` marker, distinct from M5's coined `†`). */
export function isBorrowed(sim: Simulation, conceptId: string, branchId: string): boolean {
  return latestReassignment(sim, branchId, conceptId)?.cause === 'borrow';
}

export type LoanInfo = { century: number; fromBranchId: string; fromLabel: string };

/** If `conceptId`'s current word in `branchId` is a loan, its century and
 * lending branch (specs/M6.md: "`dict` marks loans with their source
 * language and century"); `null` if it isn't. */
export function loanInfo(sim: Simulation, conceptId: string, branchId: string): LoanInfo | null {
  const r = latestReassignment(sim, branchId, conceptId);
  if (!r || r.cause !== 'borrow' || !r.fromBranchId) return null;
  return { century: r.century, fromBranchId: r.fromBranchId, fromLabel: branchDisplayLabel(sim, r.fromBranchId) };
}

/** Display label for any branch id, leaf or not (specs/M6.md: a lending
 * branch may itself have split further after the loan happened, so it isn't
 * always a leaf by the time we render). Root gets the family name; a leaf
 * gets its assigned name; any other (internal) branch falls back to
 * "branch to year N", mirroring src/render.ts's `branchLabel` for Branch
 * objects — this is the id-keyed counterpart query functions need since
 * they only ever have a bare branch id (e.g. a `LexemeReassignment`'s
 * `fromBranchId`), not the Branch object itself. */
export function branchDisplayLabel(sim: Simulation, branchId: string): string {
  if (branchId === sim.root.id) return sim.familyName;
  const path = pathTo(sim, branchId);
  const branch = path[path.length - 1]!;
  return branch.children.length === 0 ? (branch.name ?? branch.id) : `branch to year ${branch.end * 100}`;
}

export type CognateRow = { branchId: string; name: string; form: Word; cognate: boolean; borrowed: boolean };

/** One row per leaf, in tree order. */
export function cognates(sim: Simulation, conceptId: string): CognateRow[] {
  return leaves(sim).map((leaf) => ({
    branchId: leaf.id,
    name: leaf.name ?? leaf.id,
    form: formIn(sim, conceptId, leaf.id),
    cognate: isCognate(sim, conceptId, leaf.id),
    borrowed: isBorrowed(sim, conceptId, leaf.id),
  }));
}

// ------------------------------------------------------------- doublets

/** specs/M6.md's `doublets` query: concepts where `branchId` holds both an
 * inherited/native line and a borrowed line — the etymological money shot
 * (shirt/skirt). `native` names the concept (or synthetic slot id) the
 * displaced native word now lives under: either the borrowed-over concept's
 * own id (drift never had anywhere to shift it, so it was demoted onto a
 * synthetic `<concept>~archaic` slot) or a different real concept it was
 * shifted into via a drift edge — `kind` tells the two cases apart. Both
 * `concept` (the borrowed line) and `native.home` (the native line) are
 * valid ids to hand to `trace`/`formIn` directly; that they replay
 * correctly there is specs/M6.md's acceptance criterion 4. */
export type DoubletEntry = {
  concept: string;
  native: { home: string; romanized: string; kind: 'archaic' | 'displaced' };
  borrowedRomanized: string;
  fromBranchId: string;
  fromLabel: string;
  century: number;
};

export function doublets(sim: Simulation, branchId: string): DoubletEntry[] {
  const path = pathTo(sim, branchId);
  const allReassignments = path.flatMap((b) => b.reassignments);

  // Chronological, so a later Map.set for the same key naturally overwrites
  // an earlier one — "latest reassignment wins", matching `latestReassignment`
  // elsewhere in this file.
  const latestBorrowByConcept = new Map<string, LexemeReassignment>();
  for (const r of allReassignments) if (r.cause === 'borrow') latestBorrowByConcept.set(r.concept, r);

  const latestDisplacementBySource = new Map<string, LexemeReassignment>();
  for (const r of allReassignments) {
    if (r.cause === 'loan-displacement' && r.sourceConcept) latestDisplacementBySource.set(r.sourceConcept, r);
  }

  const out: DoubletEntry[] = [];
  for (const [concept, borrowR] of latestBorrowByConcept) {
    const displacement = latestDisplacementBySource.get(concept);
    if (!displacement || !borrowR.fromBranchId) continue; // defensive; borrowStep always pairs these
    const nativeHome = displacement.concept;
    out.push({
      concept,
      native: {
        home: nativeHome,
        romanized: romanize(formIn(sim, nativeHome, branchId)),
        kind: nativeHome === archaicSlot(concept) ? 'archaic' : 'displaced',
      },
      borrowedRomanized: romanize(formIn(sim, concept, branchId)),
      fromBranchId: borrowR.fromBranchId,
      fromLabel: branchDisplayLabel(sim, borrowR.fromBranchId),
      century: borrowR.century,
    });
  }
  return out.sort((a, b) => a.concept.localeCompare(b.concept));
}
