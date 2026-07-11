// JSON dump of a full Simulation (specs/M3.md's "JSON dump").
//
// Everything M3's history.ts puts into a `Simulation` is already
// plain-JSON-shaped (Simulation.lexicon is typed `SerializedLexicon`, not the
// live `Map`-based `Lexicon` — see below), so `toJSON`/`fromJSON` are mostly
// a thin, validated wrapper rather than a deep transform. The one real piece
// of "flattening" work is `serializeLexicon`, which turns the live
// `Map<string, Lexeme>`-based Lexicon (src/lexicon.ts) into arrays, and
// stamps every Word with both its structured segments (so the explorer can
// keep evolving it, e.g. for hover-tracing) and its precomputed romanization
// (so the explorer never has to reimplement romanize.ts).

import type { Affix, Lexeme, Lexicon } from './lexicon.js';
import type { Segment } from './phonology.js';
import { romanize } from './romanize.js';
import type { Simulation } from './history.js';
import { leaves, trace } from './query.js';

export type SerializedWord = { segments: Segment[]; stress: number; romanized: string };

export type SerializedLexeme = {
  concept: string;
  origin: Lexeme['origin'];
  parts: string[] | null;
  word: SerializedWord;
};

export type SerializedAffix = {
  role: Affix['role'];
  kind: Affix['kind'];
  slot: Affix['slot'];
  form: Segment[];
  romanized: string;
};

export type SerializedLexicon = {
  lexemes: SerializedLexeme[];
  affixes: SerializedAffix[];
};

/** Flatten a live (Map-based) Lexicon into its JSON-serializable form. */
export function serializeLexicon(lexicon: Lexicon): SerializedLexicon {
  const lexemes: SerializedLexeme[] = [...lexicon.lexemes.values()].map((l) => ({
    concept: l.concept,
    origin: l.origin,
    parts: l.parts ?? null,
    word: { segments: l.word.segments, stress: l.word.stress, romanized: romanize(l.word) },
  }));
  const affixes: SerializedAffix[] = lexicon.affixes.map((a) => ({
    role: a.role,
    kind: a.kind,
    slot: a.slot,
    form: a.form,
    romanized: romanize({ segments: a.form, stress: 0 }),
  }));
  return { lexemes, affixes };
}

// ---------------------------------------------------------- derived section
//
// specs/M4.md's "Dump extension": a `derived` section computed by the real
// engine (src/query.ts's `formIn`/`trace`) at dump time, so the explorer
// never has to reimplement sound change — it only ever displays what's
// already in the JSON. Additive and optional: `fromJSON` passes it through
// untouched, and dumps without it (pre-M4, or generated with
// `{ derived: false }`) still validate.

export type DerivedDictionaryEntry = {
  concept: string;
  romanized: string; // final form in this leaf
  trace: { century: number; romanized: string; description: string }[]; // form-altering steps only
};

export type DerivedLeaf = {
  branchId: string;
  name: string;
  dictionary: DerivedDictionaryEntry[];
};

export type Derived = { leaves: DerivedLeaf[] };

export type EtymonDumpV1 = Simulation & { formatVersion: 1; derived?: Derived };

const REQUIRED_FIELDS = ['config', 'inventory', 'lexicon', 'familyName', 'root'] as const;

/** Compute the `derived` section: for every leaf x concept, the final
 * romanized form and its form-altering trace steps, via the same
 * `formIn`/`trace` helpers the CLI's `trace`/`dict` commands use. */
function computeDerived(sim: Simulation): Derived {
  return {
    leaves: leaves(sim).map((leaf) => ({
      branchId: leaf.id,
      name: leaf.name ?? leaf.id,
      dictionary: sim.lexicon.lexemes.map((lexeme) => {
        const steps = trace(sim, lexeme.concept, leaf.id);
        const last = steps[steps.length - 1];
        return {
          concept: lexeme.concept,
          romanized: last ? last.romanized : lexeme.word.romanized,
          trace: steps.map((s) => ({ century: s.century, romanized: s.romanized, description: s.description })),
        };
      }),
    })),
  };
}

/** `{ formatVersion: 1, ...sim }` — see specs/M3.md's "JSON dump" section.
 * Pass `{ derived: true }` to additionally compute specs/M4.md's `derived`
 * section (family tree x lexicon, evolved and traced for every leaf). */
export function toJSON(sim: Simulation, options?: { derived?: boolean }): EtymonDumpV1 {
  const dump: EtymonDumpV1 = { formatVersion: 1, ...sim };
  if (options?.derived) dump.derived = computeDerived(sim);
  return dump;
}

/** Inverse of `toJSON`. Validates the format version and required top-level
 * shape, then hands back the embedded Simulation. Since every field of
 * Simulation is already plain data (no Maps, no functions), no deep
 * reconstruction is needed — this is a structural-validation pass, not a
 * transform. */
export function fromJSON(dump: unknown): Simulation {
  if (typeof dump !== 'object' || dump === null) {
    throw new Error('fromJSON: expected an object');
  }
  const d = dump as Record<string, unknown>;
  if (d.formatVersion !== 1) {
    throw new Error(`fromJSON: unsupported formatVersion ${JSON.stringify(d.formatVersion)}`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in d)) throw new Error(`fromJSON: missing required field "${field}"`);
  }
  const { formatVersion: _formatVersion, ...rest } = d;
  return rest as unknown as Simulation;
}
