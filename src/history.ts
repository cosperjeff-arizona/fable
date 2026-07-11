// The simulation driver (specs/M3.md's "src/history.ts — the driver").
//
// Grows a branching family tree over `centuries` centuries, evolving a
// per-branch working lexicon as it goes. Each branch draws all of its
// randomness from its own named stream (`branch:<id>`, via `makeStreams`),
// so the tree's *shape* (how many branches exist, when they split) never
// perturbs any other branch's history — see test/history.test.ts's
// stream-discipline test, which is specs/M3.md's acceptance criterion 7.

import { makeStreams, type Stream } from './prng.js';
import { generateInventory, type Inventory, type Word } from './phonology.js';
import { generateLexicon, type Lexeme, type Lexicon } from './lexicon.js';
import { CONCEPTS } from './concepts.js';
import { romanize } from './romanize.js';
import { applyChange } from './changes/apply.js';
import { sampleChange } from './changes/sample.js';
import { detectParadigmCollapse, type ParadigmNote } from './changes/paradigms.js';
import type { LangState, SoundChange, SubRule } from './changes/rules.js';
import { serializeLexicon, type SerializedLexicon } from './serialize.js';
import {
  DEFAULT_DRIFT_CONFIG,
  cloneDriftState,
  driftStep,
  initDriftState,
  type DriftEvent,
  type DriftState,
  type LexemeReassignment,
} from './drift.js';
import {
  DEFAULT_CONTACT_CONFIG,
  adjacentPairs,
  borrowStep,
  rootInterval,
  splitInterval,
  type BorrowEvent,
  type Interval,
} from './contact.js';

export type SimConfig = {
  seed: number;
  centuries: number; // default 20
  maxLeaves: number; // default 6
  splitChance: number; // default 0.18 per century per living branch (while under maxLeaves)
  changeChance: number; // default 0.45 per century per branch
  /** specs/M5.md: semantic drift/taboo/coinage. Defaults to `false` here
   * (library default) so every existing direct `generateSimulation({seed})`
   * caller — including all pre-M5 tests and their golden snapshots — is
   * completely unaffected; src/cli.ts's `generate`/`dict`/`trace`/etc.
   * default it to `true` (opt-out via `--no-drift`) at the CLI layer, which
   * is where specs/M5.md's user-facing flag actually lives. */
  driftEnabled: boolean;
  driftChance: number; // default 0.10 /branch/century
  tabooChance: number; // default 0.02 /branch/century
  /** specs/M6.md: contact/borrowing between adjacent living branches.
   * Defaults to `false` here (library default), mirroring `driftEnabled` —
   * every existing direct `generateSimulation({seed})` caller (including
   * every pre-M6 test/golden) is unaffected; src/cli.ts's commands default
   * it to `true` (opt-out via `--no-contact`), which is where specs/M6.md's
   * user-facing flag actually lives. */
  contactEnabled: boolean;
  borrowChance: number; // default 0.04 /adjacent branch pair/century
};

export const DEFAULT_SIM_CONFIG: Omit<SimConfig, 'seed'> = {
  centuries: 20,
  maxLeaves: 6,
  splitChance: 0.18,
  changeChance: 0.45,
  driftEnabled: false,
  driftChance: DEFAULT_DRIFT_CONFIG.driftChance,
  tabooChance: DEFAULT_DRIFT_CONFIG.tabooChance,
  contactEnabled: false,
  borrowChance: DEFAULT_CONTACT_CONFIG.borrowChance,
};

/** The instantiated, JSON-serializable rule data for one applied change —
 * *not* just a catalog id, since factories sample variants (e.g. which
 * chain-shift direction) and traces must replay the resolved subRules
 * exactly, without re-sampling (specs/M3.md). */
export type AppliedChange = { catalogId: string; description: string; subRules: SubRule[] };

export type SoundChangeEvent = { kind: 'sound'; century: number; change: AppliedChange };

/** specs/M5.md: "M3's `ChangeEvent` becomes a union" of the pre-existing
 * sound-change event and the new drift/taboo events, in one chronological
 * per-branch log. Sound-change replay (src/query.ts) filters to `kind ===
 * 'sound'` and is otherwise untouched — see that file's `pathEvents`. */
export type ChangeEvent = SoundChangeEvent | DriftEvent | BorrowEvent;

export type Branch = {
  id: string; // 'root', 'root.0', 'root.0.1', …
  start: number;
  end: number;
  /** specs/M6.md's geography: this branch's sub-interval of the root's
   * [0, 1] span. Assigned once, at branch creation (root gets the whole
   * span; a split's two children get the left/right halves — see
   * src/contact.ts's `rootInterval`/`splitInterval`), and never changes
   * afterward. Purely a function of tree shape — no randomness involved. */
  interval: Interval;
  events: ChangeEvent[];
  paradigmNotes: ParadigmNote[];
  /** specs/M5.md's erosion mechanism: every time a concept's word "cell" is
   * (re)assigned to a freshly-built form (drift shift/extend target, or a
   * coinage refilling a gap / replacing a taboo word), one record here
   * captures that form *as of* the reassignment century, so src/query.ts
   * can replay sound changes forward from it without ever rebuilding from a
   * proto root. Empty when drift is disabled or a branch's path never had a
   * drift event. */
  reassignments: LexemeReassignment[];
  children: Branch[];
  name?: string; // leaves only; see naming
};

export type Simulation = {
  config: SimConfig;
  inventory: Inventory; // proto inventory
  lexicon: SerializedLexicon;
  familyName: string;
  root: Branch;
};

// ------------------------------------------------------------- naming

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

const DIRECTIONS = ['North', 'South', 'East', 'West'];

/** Port of the prototype's leaf-disambiguation logic (directional prefixes
 * in tree order), plus a final uniqueness-guaranteeing pass so criterion 4
 * (unique names) holds even in freak cases the four cardinal directions
 * don't cover (e.g. > 4 branches converging on the same evolved word, or a
 * disambiguated name coincidentally colliding with another leaf's name). */
function assignLeafNames(orderedLeaves: { branch: Branch; word: Word }[]): void {
  for (const leaf of orderedLeaves) leaf.branch.name = cap(romanize(leaf.word));

  const groups = new Map<string, Branch[]>();
  for (const { branch } of orderedLeaves) {
    const arr = groups.get(branch.name!) ?? [];
    arr.push(branch);
    groups.set(branch.name!, arr);
  }
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    group.forEach((branch, i) => {
      branch.name = i < DIRECTIONS.length ? `${DIRECTIONS[i]} ${branch.name}` : `${branch.name} (${i + 1})`;
    });
  }

  const seen = new Set<string>();
  for (const { branch } of orderedLeaves) {
    let name = branch.name!;
    let suffix = 2;
    while (seen.has(name)) name = `${branch.name} (${suffix++})`;
    seen.add(name);
    branch.name = name;
  }
}

// --------------------------------------------------------- driver state

type ActiveBranch = {
  id: string;
  start: number;
  branch: Branch;
  stream: Stream;
  driftStream: Stream; // specs/M5.md: separate `drift:<branchId>` stream family
  driftState: DriftState;
  // evolved through this branch's path so far via SOUND CHANGE ONLY — never
  // touched by drift. This is what `sampleChange`'s applicability/dry-run
  // checks and leaf naming read, so drift being on or off (and any
  // driftChance/tabooChance value) can *never* change which sound changes
  // get sampled: those checks are a deterministic function of *this* map's
  // content, which is drift-blind by construction (acceptance criterion 1
  // — see test/drift.test.ts's "sound-change stream independence" suite,
  // which caught a real bug here: letting drift mutate the same map
  // sampleChange conditions on changed dry-run outcomes even though the
  // sound-change *stream* was untouched).
  workingLexemes: Map<string, Lexeme>;
  // Mirrors `workingLexemes`'s sound-change evolution exactly, but ALSO
  // carries every drift/coinage/taboo reassignment. This is the branch's
  // "semantic present" — what coinage's REFILL_TEMPLATES/anchor lookups
  // treat as each concept's *current* word. Nothing outside src/drift.ts's
  // coinage machinery and this file's own bookkeeping ever reads it.
  semanticLexemes: Map<string, Lexeme>;
  liveChanges: SoundChange[]; // full ancestor+own path, in order (not serialized)
  collapsedRoles: Set<string>;
};

function langStateFor(active: ActiveBranch, protoAffixes: Lexicon['affixes']): LangState {
  return {
    lexicon: { lexemes: active.workingLexemes, affixes: protoAffixes },
    changeHistory: active.liveChanges.map((c) => c.id),
  };
}

function evolveLexemeMap(lexemes: Map<string, Lexeme>, change: SoundChange): Map<string, Lexeme> {
  const next = new Map(lexemes);
  for (const [id, lexeme] of next) {
    const newWord = applyChange(lexeme.word, change);
    if (newWord !== lexeme.word) next.set(id, { ...lexeme, word: newWord });
  }
  return next;
}

function applyChangeToBranch(active: ActiveBranch, change: SoundChange, century: number, protoLexicon: Lexicon): void {
  active.workingLexemes = evolveLexemeMap(active.workingLexemes, change);
  active.semanticLexemes = evolveLexemeMap(active.semanticLexemes, change);
  active.liveChanges = [...active.liveChanges, change];

  const applied: AppliedChange = { catalogId: change.id, description: change.describe(), subRules: change.subRules };
  active.branch.events.push({ kind: 'sound', century, change: applied });

  const notes = detectParadigmCollapse(
    { lexemes: protoLexicon.lexemes, affixes: protoLexicon.affixes },
    active.liveChanges,
    change,
    century,
    active.collapsedRoles,
    active.stream,
  );
  for (const note of notes) {
    active.collapsedRoles.add(note.affixRole);
    active.branch.paradigmNotes.push(note);
  }
}

/** Run one century's drift/taboo sampling for `active` (specs/M5.md), no-op
 * if `driftEnabled` is false. Mutates `active.semanticLexemes`/`driftState`
 * (never `active.workingLexemes` — see that field's doc comment) and
 * appends to the branch's `events`/`reassignments` logs. Always draws from
 * `active.driftStream` (the separate `drift:<branchId>` family), so this
 * never perturbs `active.stream` — the sound-change stream whose sequence
 * acceptance criterion 1 pins byte-identical. */
function driftStepForBranch(active: ActiveBranch, century: number, config: SimConfig, inventory: Inventory, protoAffixes: Lexicon['affixes']): void {
  if (!config.driftEnabled) return;
  const result = driftStep(
    century,
    active.semanticLexemes,
    protoAffixes,
    inventory,
    active.driftState,
    active.driftStream,
    { driftChance: config.driftChance, tabooChance: config.tabooChance },
  );
  active.semanticLexemes = result.workingLexemes;
  for (const ev of result.events) active.branch.events.push(ev);
  for (const r of result.reassignments) active.branch.reassignments.push(r);
}

/** Guarantee at least one event on every branch whose span is >= 2 centuries
 * (specs/M3.md): force-sample at the midpoint if the century loop never
 * landed one. Called exactly once per branch, right when its `end` becomes
 * final (either it split, or the simulation ended). */
function finalizeBranch(active: ActiveBranch, endCentury: number, protoLexicon: Lexicon): void {
  active.branch.end = endCentury;
  if (active.branch.events.length > 0) return;
  if (endCentury - active.start < 2) return;
  const midpoint = active.start + Math.max(1, Math.floor((endCentury - active.start) / 2));
  const change = sampleChange(langStateFor(active, protoLexicon.affixes), active.stream);
  if (change) applyChangeToBranch(active, change, midpoint, protoLexicon);
}

// ------------------------------------------------------------- driver

export function generateSimulation(config: Partial<Omit<SimConfig, 'seed'>> & { seed: number }): Simulation {
  const fullConfig: SimConfig = { ...DEFAULT_SIM_CONFIG, ...config };
  const { centuries, maxLeaves, splitChance, changeChance } = fullConfig;

  const streams = makeStreams(fullConfig.seed);
  const inventory = generateInventory(streams.phonology);
  const protoLexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);

  const rootBranch: Branch = {
    id: 'root',
    start: 0,
    end: 0,
    interval: rootInterval(),
    events: [],
    paradigmNotes: [],
    reassignments: [],
    children: [],
  };
  const rootActive: ActiveBranch = {
    id: 'root',
    start: 0,
    branch: rootBranch,
    stream: streams.branch('root'),
    driftStream: streams.drift('root'),
    driftState: initDriftState(),
    workingLexemes: new Map(protoLexicon.lexemes),
    semanticLexemes: new Map(protoLexicon.lexemes),
    liveChanges: [],
    collapsedRoles: new Set(),
  };

  let active: ActiveBranch[] = [rootActive];
  let leafCount = 1;

  const makeChild = (parent: ActiveBranch, id: string, startCentury: number, interval: Interval): ActiveBranch => ({
    id,
    start: startCentury,
    branch: { id, start: startCentury, end: startCentury, interval, events: [], paradigmNotes: [], reassignments: [], children: [] },
    stream: streams.branch(id),
    driftStream: streams.drift(id),
    driftState: cloneDriftState(parent.driftState),
    workingLexemes: new Map(parent.workingLexemes),
    semanticLexemes: new Map(parent.semanticLexemes),
    liveChanges: parent.liveChanges, // never mutated in place (always replaced wholesale); safe to share
    collapsedRoles: new Set(parent.collapsedRoles),
  });

  // specs/M6.md: one persistent stream per unordered pair of branch ids,
  // created lazily the first time a pair is drawn from and reused every
  // century thereafter (mirroring how `streams.branch(id)`/`streams.drift(id)`
  // are instantiated once per branch and then advanced in place) — a fresh
  // `Stream` every century would replay the exact same draws each time
  // instead of advancing, breaking determinism across centuries.
  const contactStreams = new Map<string, Stream>();
  const contactStreamFor = (idA: string, idB: string): Stream => {
    const key = [idA, idB].sort().join('|');
    let s = contactStreams.get(key);
    if (!s) {
      s = streams.contact(idA, idB);
      contactStreams.set(key, s);
    }
    return s;
  };

  for (let century = 1; century <= centuries; century++) {
    const snapshot = active.slice(); // freshly split children never join this century's pass

    // Phase 1: sound change + semantic drift, per branch on its own streams.
    for (const branchState of snapshot) {
      // 1. sound change, on the branch's own stream.
      if (branchState.stream.chance(changeChance)) {
        const change = sampleChange(langStateFor(branchState, protoLexicon.affixes), branchState.stream);
        if (change) applyChangeToBranch(branchState, change, century, protoLexicon);
      }

      // 1.5. semantic drift / taboo / coinage, on the branch's own SEPARATE
      // `drift:<branchId>` stream (specs/M5.md) — never perturbs the sound-
      // change stream above, so this step existing or not existing (and any
      // driftChance/tabooChance value) cannot alter the sound-change event
      // sequence pinned by acceptance criterion 1.
      driftStepForBranch(branchState, century, fullConfig, inventory, protoLexicon.affixes);
    }

    // Phase 2: contact/borrowing between adjacent living branches (specs/
    // M6.md), on each pair's own SEPARATE `contact:<idA>|<idB>` stream —
    // runs BEFORE this century's split decisions (phase 3) so that a branch
    // which splits this century still passes any loan it just received down
    // to both children (they clone `workingLexemes`/`semanticLexemes` at
    // split time); running it after would silently drop the loan into a
    // branch state about to be discarded.
    if (fullConfig.contactEnabled) {
      const living = snapshot.map((s) => ({ id: s.id, interval: s.branch.interval }));
      const byId = new Map(snapshot.map((s) => [s.id, s] as const));
      for (const [x, y] of adjacentPairs(living)) {
        const idA = x.id < y.id ? x.id : y.id;
        const idB = x.id < y.id ? y.id : x.id;
        const a = byId.get(idA)!;
        const b = byId.get(idB)!;
        const result = borrowStep(century, a, b, contactStreamFor(idA, idB), { borrowChance: fullConfig.borrowChance });
        if (!result) continue;
        const dest = result.destId === a.id ? a : b;
        dest.workingLexemes = result.workingLexemes;
        dest.semanticLexemes = result.semanticLexemes;
        for (const ev of result.events) dest.branch.events.push(ev);
        for (const r of result.reassignments) dest.branch.reassignments.push(r);
      }
    }

    // Phase 3: population splits.
    for (const branchState of snapshot) {
      // The chance draw is consumed unconditionally so a branch's stream
      // consumption stays fully local: if the draw were gated on the global
      // leafCount, another subtree's splits would shift this branch's
      // stream position and reshuffle its later history.
      const wantsSplit = branchState.stream.chance(splitChance);
      if (wantsSplit && leafCount < maxLeaves && century <= centuries - 3) {
        finalizeBranch(branchState, century, protoLexicon);
        const [leftInterval, rightInterval] = splitInterval(branchState.branch.interval);
        const childA = makeChild(branchState, `${branchState.id}.0`, century, leftInterval);
        const childB = makeChild(branchState, `${branchState.id}.1`, century, rightInterval);
        branchState.branch.children.push(childA.branch, childB.branch);
        const idx = active.indexOf(branchState);
        active.splice(idx, 1, childA, childB);
        leafCount += 1;
      }
    }
  }

  // Every branch still active at the end of the simulation becomes a leaf.
  for (const branchState of active) finalizeBranch(branchState, centuries, protoLexicon);

  // Naming: each leaf is named after its own evolved word for "people",
  // computed straight from the already-evolved (cached) working lexicon —
  // no re-evolving from proto needed here.
  const peopleByLeaf = active.map((branchState) => ({
    branch: branchState.branch,
    word: branchState.workingLexemes.get('people')!.word,
  }));
  assignLeafNames(peopleByLeaf);

  const protoTongue = protoLexicon.lexemes.get('tongue')!.word;
  const familyName = 'Proto-' + cap(romanize(protoTongue));

  return {
    config: fullConfig,
    inventory,
    lexicon: serializeLexicon(protoLexicon),
    familyName,
    root: rootBranch,
  };
}
