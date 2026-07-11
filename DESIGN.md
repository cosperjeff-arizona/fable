# Etymon — a simulated-historical-linguistics engine

## The idea

Every tool that generates constructed languages today generates them *flat*: a phonology, a
grammar, a word list, frozen at a single moment. Real languages aren't like that. Every word
in English is the visible tip of a two-thousand-year derivation — `shirt` and `skirt` are the
same Proto-Germanic word, once inherited and once borrowed back from Norse. That depth is what
makes real languages feel real, and no generator produces it.

**Etymon simulates the depth instead of faking the surface.** It generates a proto-language,
then runs *time* forward: centuries of typologically real sound changes, population splits,
semantic drift, and borrowing between neighboring branches. The output is not one language but
a **language family** — daughters that are genuinely related because they genuinely share
history, with every word carrying a complete, inspectable etymology.

The pitch in one command:

```
$ etymon trace blood --lang gukm
Gukm "elg" (blood) < Proto-Hanak *salgit
    > halgit   c. year 100:  weakening of initial s (s > h / #_)
    > halgi    c. year 200:  loss of word-final stops
    > helgi    c. year 400:  umlaut before i (a > e)
    > elgi     c. year 1000: loss of h in all positions
    > elg      c. year 1300: apocope of final vowels
```

That derivation was not written by anyone. It *happened*, in a simulation, and the tool can
prove it step by step.

### Why this is novel

- **Vulgarlang / Awkwords / gen tools**: single static languages. No history, no families.
- **Lexurgy / Zompist SCA²**: apply sound-change rules *you write by hand* — they're
  calculators, not simulators. Etymon invents plausible change sequences itself.
- **Academic phylogenetics** (e.g. computational cognate detection): runs *backward* from
  real data. Etymon runs *forward* from nothing.

The forward-simulation niche — automated, plausible, whole-family diachrony with queryable
etymologies — is empty as far as I can tell.

### Who it's for

Worldbuilders (D&D, fiction, games) who want naming languages with real texture; linguistics
students and teachers (watch Grimm's-law-style shifts play out); procedural-generation
enthusiasts; anyone who enjoys reading etymological dictionaries of places that don't exist.

## What exists now

`prototype/etymon.mjs` — a ~400-line, zero-dependency Node proof of concept. It already does:
seeded deterministic generation, a 22-consonant feature system, weighted phoneme inventories,
phonotactic root generation for 32 Swadesh-style concepts, a catalog of 16 real sound-change
types (lenition, umlaut, rhotacism, apocope, syncope, palatalization, chain shifts…), a
branching family tree over 20 centuries, cognate tables, per-branch change histories, and
step-by-step etymology traces. Daughter languages even name themselves after their own evolved
word for "people" (with North/South disambiguation when two branches' names converge —
which itself only happens when the simulation makes them converge).

Run it: `node prototype/etymon.mjs [seed]`

## Full-system architecture

TypeScript, zero runtime dependencies. A pure-functional core library (`@etymon/core`) with a
CLI and, later, a static web explorer on top. Everything is deterministic from `(seed, config)`.

```
src/
  prng.ts        seeded RNG, weighted choice, shuffle
  phonology.ts   feature system, inventory generation, syllable templates, phonotactics
  lexicon.ts     concept list (~200), root generation, morphology (affixes, compounding)
  changes/       sound-change catalog: each change = typed rewrite rule over feature matrices
  drift.ts       semantic drift graph, taboo replacement, coinage by compounding
  contact.ts     geography stub, borrowing + loanword adaptation to borrower phonology
  history.ts     simulation driver: tree of splits, per-branch event logs
  orthography.ts per-language romanization quirks (c/k, digraphs, diacritics)
  query.ts       trace, cognates, doublets, dictionaries
  render/        text, markdown, JSON, HTML outputs
cli.ts           etymon generate | trace | dict | cognates | doublets | tree
```

### Module notes (design decisions already made)

**Phonology.** Segments are feature bundles (place, manner, voice; height, backness,
rounding, length). Inventories are sampled respecting implicational universals (no voiced
stop series without the voiceless one, etc.). Sound changes target *features*, not symbol
lists — this is the key upgrade from the prototype, and what makes the catalog compose
correctly when changes create segments the proto-language never had.

**Sound-change catalog.** Each entry is data: `{ target: featureSet, result: featureDelta,
environment: pattern, plausibilityWeight }`. The engine picks changes conditioned on the
current state of the language (you can't lose final vowels twice; vowel-length changes need
length; chain shifts must not merge everything). Target: 40–60 changes covering the classic
typology — Grimm/Verner-style series shifts, nasalization + loss, tonogenesis is a stretch
goal.

**Semantic drift.** A hand-curated concept graph (~200 nodes) with weighted metaphor/metonymy
edges: moon→month, hand→five, breath→spirit, heart→courage, big-water→sea. Per century, small
probability a word's sense shifts along an edge, leaving a gap that gets refilled by
derivation or compounding ("night-sun" for moon). This is what makes daughter dictionaries
*diverge in meaning*, not just form.

**Contact and borrowing.** Branches sit on a 1-D or hex-grid geography; adjacent branches
exchange vocabulary (weighted toward culture/technology concepts: king, salt, road, iron).
Loanwords are *adapted* — mapped to the nearest native phonemes — then evolve normally from
the borrowing date. This mechanically produces **doublets** (inherited vs. borrowed cognates
in one language, à la shirt/skirt) and **false friends**, both queryable.

**Orthography.** Each daughter gets its own romanization conventions (⟨c⟩ vs ⟨k⟩, ⟨th⟩ vs ⟨þ⟩,
diacritics) so dictionaries look like different traditions, not one transcription system.

**Web explorer** (last milestone): a static, self-contained HTML page — clickable family
tree, searchable dictionaries, animated word-derivation timelines, a "cognate hunt" view.

## Testing strategy

Perfect fit for cheap-model implementation because everything is checkable:

1. **Determinism**: same seed + config ⇒ byte-identical output (golden snapshot tests).
2. **Property tests**: every generated/evolved word satisfies the language's phonotactics;
   every trace replays to the attested form; feature matrices stay well-formed.
3. **Plausibility audits**: statistical checks (mean word length within bounds, no language
   loses >60 % of proto contrasts, homophone rate capped).

## Milestones (sized for offloading)

Each milestone has crisp acceptance criteria; M2 is the heart and the one that gets the most
design attention (see `specs/`).

- **M1 — phonology + lexicon** (port prototype to typed feature system; 200 concepts;
  morphology). *Accept: golden tests, phonotactic property tests pass.* Spec: `specs/M1.md`.
- **M2 — sound-change engine** (feature-based rule application; catalog of ~40 changes with
  plausibility conditioning). *Accept: every catalog change has unit tests with hand-checked
  before/after forms; conditioning prevents degenerate sequences.* Spec: `specs/M2.md`.
- **M3 — history driver** (tree, event logs, per-branch evolution; CLI `generate`/`tree`;
  JSON dump of a full simulation).
- **M4 — explorer-lite** (static HTML page reading the M3 JSON dump: family tree,
  dictionaries, animated trace playback). Pulled forward for demo value and to pressure-test
  the JSON schema early.
- **M5 — semantic drift + coinage** (drift graph, taboo replacement, derivation).
- **M6 — contact** (geography, borrowing, loanword adaptation; `doublets` query).
- **M7 — outputs + polish** (markdown dictionaries, per-language orthographies, full explorer).

## Decisions (formerly open questions)

1. **Lexicon scale**: 200 curated concepts, organized by semantic domain. The drift graph and
   compounding rules only pay off when concepts are chosen to connect; auto-generated bulk
   would be dead weight.
2. **Web explorer**: a minimal read-only version is promoted to M4 (right after the history
   driver). The polished version stays last.
3. **Grammar evolution**: full syntax evolution is out of scope for v1. However, since
   inflectional affixes are phonological material, sound change erodes them for free — apocope
   deletes final vowels and case endings die with them. v1 therefore tracks inflectional
   paradigms, detects when sound change collapses their distinctions, and reports the
   typological consequence in each language's profile ("case system collapsed; fixed word
   order emerged"). Real syntax simulation can bolt on in v2.
