# Etymon

**A simulated-historical-linguistics engine.** Etymon doesn't generate a constructed
language — it generates a *proto*-language and then simulates two thousand years of history:
typologically real sound changes, population splits, semantic drift, taboo replacement,
coinage, and contact/borrowing between neighboring branches. The result is a whole language
family in which every word of every daughter language has a complete, step-by-step etymology
that actually happened inside the simulation — and each daughter spells its words in its own
sampled orthographic tradition, not one flat transcription system.

```
$ etymon trace hearth --seed 42 --lang "North Jis"
North Jis "dishisnëstu" (hearth) — coined as "deshesnëstu" from stone + hearth (little), c. year 1200
    > dishisnëstu   c. year 1800: raising of e (e > i)
```

That derivation was not written by anyone. It *happened*, in a simulation, and the tool can
prove it step by step: "hearth" fell out of use, so this branch coined a new word for it out
of "stone" and a diminutive of the old "hearth" root — and that coinage kept eroding through
later sound changes exactly like any inherited word would.

See [DESIGN.md](DESIGN.md) for the full concept, architecture, and milestone history, and
[specs/](specs/) for the implementation spec of each milestone (`M1`–`M7`).

## Quickstart

Zero runtime dependencies; only `typescript` and `vitest` as dev dependencies.

```
npm install
npm run build
node dist/src/cli.js generate --seed 42
```

Or, without a separate build step, via the `npm run cli` wrapper (builds then runs):

```
npm run cli -- dict Gisi --seed 42
```

Run the test suite:

```
npm test
```

## CLI command reference

Every command accepts `--seed N` to generate a fresh simulation, or `--from dump.json` to
load a previously generated one instead. Semantic drift/taboo/coinage and contact/borrowing
are **on by default** for every CLI command (`--no-drift` / `--no-contact` reproduce the
earlier milestones' output exactly, byte-for-byte).

```
Usage: etymon <command> [options]

Commands:
  generate --seed N [--centuries N] [--max-leaves N] [--json dump.json] [--no-drift] [--no-contact]
  dict <language> --seed N [--no-drift] [--no-contact]
  trace <concept> --seed N [--lang <name>] [--no-drift] [--no-contact]
  cognates <concept> --seed N [--no-drift] [--no-contact]
  doublets <language> --seed N [--no-drift] [--no-contact]
  tree --seed N [--no-drift] [--no-contact]
  explore --seed N [--centuries N] [--max-leaves N] [--out explorer.html] [--no-drift] [--no-contact]

All commands accept --from dump.json instead of --seed to load a previously
generated simulation.
```

### `generate` — the whole family tree and its sound-change history

```
$ etymon generate --seed 42
ETYMON — seed 42
Family: Proto-Dëhido (6 daughter languages, 2000 years)

Family tree:
  Proto-Dëhido  [0–500]
  ├─ (split, year 600)  [500–600]
  │  ├─ (split, year 700)  [600–700]
  │  │  ├─ (split, year 800)  [700–800]
  │  │  │  ├─ (split, year 900)  [800–900]
  │  │  │  │  ├─ North Jis  [900–2000]
  │  │  │  │  └─ Gisi  [900–2000]
  │  │  │  └─ Ges  [800–2000]
  │  │  └─ Jiri  [700–2000]
  │  └─ South Jis  [600–2000]
  └─ Gese  [500–2000]

Sound changes by branch:
  [Proto-Dëhido] year 200: fronting of u (u > y)
  [Proto-Dëhido] year 400: fronting of a (a > e), umlaut-free systems only
  [Proto-Dëhido] year 500: loss of word-final stops
  [branch to year 600] year 600: umlaut (a o u > e ø y before a following i/j)
  [branch to year 900] year 900: intervocalic voicing (p t k > b d g / V_V)
  [North Jis] year 1000: apocope (final unstressed V > ∅ / C_#)
  [North Jis] year 1200: chain raising (o > u, a > o)
  [North Jis] year 1200: semantic shift: 'hearth' > 'fire'
  ...
```

Pass `--json dump.json` to also write the full simulation (proto lexicon, per-branch event
logs, and a derived per-leaf dictionary/etymology section) as JSON — this is the same format
`examples/seed42.json` is committed in, and what `explore` embeds into its HTML page.

### `tree` — just the family tree

```
$ etymon tree --seed 42
ETYMON — seed 42
Family: Proto-Dëhido (6 daughter languages, 2000 years)

Family tree:
  Proto-Dëhido  [0–500]
  ├─ (split, year 600)  [500–600]
  │  ├─ (split, year 700)  [600–700]
  │  │  ├─ (split, year 800)  [700–800]
  │  │  │  ├─ (split, year 900)  [800–900]
  │  │  │  │  ├─ North Jis  [900–2000]
  │  │  │  │  └─ Gisi  [900–2000]
  │  │  │  └─ Ges  [800–2000]
  │  │  └─ Jiri  [700–2000]
  │  └─ South Jis  [600–2000]
  └─ Gese  [500–2000]
```

### `dict` — a daughter language's full dictionary, in its own orthography

Each daughter samples its own romanization conventions (⟨c⟩ vs ⟨k⟩, ⟨sh⟩ vs ⟨š⟩ vs ⟨x⟩,
umlauts vs digraphs, nasal vowels as diacritics or a written ⟨n⟩…) — two daughters' dictionaries
read like two different orthographic traditions, not one shared transcription:

```
$ etymon dict "North Jis" --seed 42
Dictionary of North Jis (branch root.0.0.0.0.0, years 900–2000):
  water         pivim
  fire          hisnës
                — originally 'hearth'; came to mean 'fire' c. year 1200
  sun           tën
  moon          jistür
  star          pin
  sky           busëm
  earth         izin
  stone         dischëjis
  sand          rimch
  dust          sich
  mountain      cërin
  hill          bist
  valley        süchuhërin (compound: river + mountain)
  river         süch
  lake          sühun
  sea           pivimrib (compound: water + big)
  rain          ji
  snow          rid
  ...
```

### `trace` — a word's full etymology, one step per change that actually altered it

A coined or taboo-replaced word's trace starts at its own coinage, naming the origin-time form
it was built from (which then keeps eroding through every later sound change, exactly like an
inherited word):

```
$ etymon trace hearth --seed 42
North Jis "dishisnëstu" (hearth) — coined as "deshesnëstu" from stone + hearth (little), c. year 1200
    > dishisnëstu   c. year 1800: raising of e (e > i)
Gisi "isnës" (hearth) < Proto-Dëhido *hasnës
    > hesnës   c. year 400: fronting of a (a > e), umlaut-free systems only
    > esnës   c. year 1600: loss of h in all positions
    > isnës   c. year 1900: raising of e (e > i)
Ges "esnes" (hearth) < Proto-Dëhido *hasnës
    > hesnes   c. year 400: fronting of a (a > e), umlaut-free systems only
    > esnes   c. year 1200: loss of h in all positions
Jiri "isnës" (hearth) < Proto-Dëhido *hasnës
    > hesnës   c. year 400: fronting of a (a > e), umlaut-free systems only
    > esnës   c. year 800: loss of h in all positions
    > isnës   c. year 900: raising of e (e > i)
South Jis "isnes" (hearth) < Proto-Dëhido *hasnës
    > hesnes   c. year 400: fronting of a (a > e), umlaut-free systems only
    > esnes   c. year 1000: loss of h in all positions
    > isnes   c. year 1600: raising of e (e > i)
Gese "esnes" (hearth) < Proto-Dëhido *hasnës
    > hesnes   c. year 400: fronting of a (a > e), umlaut-free systems only
    > esnes   c. year 1400: loss of h in all positions
```

Proto forms (marked with `*`) always print in the neutral phonemic romanization shared by the
whole family, regardless of any one daughter's own spelling conventions. Pass `--lang <name>`
to trace just one daughter instead of all of them.

### `cognates` — one concept across every daughter, side by side

```
$ etymon cognates hearth --seed 42
Cognates — hearth:
  concept  *Dëhido  North Jis      Gisi   Ges    Jiri   South Jis  Gese
  -------  -------  -------------  -----  -----  -----  ---------  -----
  hearth   *hasnës  dishisnëstu †  isnës  esnes  isnës  isnes      esnes
```

`†` marks a non-cognate cell — this daughter's word for the concept was coined or taboo-replaced
rather than inherited straight from the proto root; `‡` (see `doublets` below) marks a loan.

### `doublets` — inherited and borrowed cognates of the same proto root, in one language

Etymon's contact/borrowing model mechanically produces doublets the way English got shirt
(inherited) and skirt (borrowed back from Norse) from the same Proto-Germanic word:

```
$ etymon doublets Gisi --seed 42
Doublets in Gisi:
  bridge: "suecovinsë" (inherited < *suchobansë) vs "suecufins" (borrowed from North Jis, year 1800)
```

### `explore` — a self-contained HTML explorer

```
$ etymon explore --seed 42 --out etymon-explorer.html
Wrote etymon-explorer.html
```

Opening the file needs no server and no network access: it's a single HTML page with the full
simulation dump embedded and a small vanilla-JS UI — a clickable family tree, a searchable,
per-leaf-spelled dictionary, and an animated word-derivation timeline (semantic reassignment
milestones, coined/borrowed origin forms, and — where a leaf's own spelling differs from the
neutral phonemic romanization — the phonemic form alongside it in parentheses). Drop a
different `dump.json` (from `generate --json`) onto the page to load it without regenerating
the HTML.

## Repository layout

```
src/
  prng.ts          seeded RNG; independent named stream families (phonology, lexicon,
                    history, per-branch, drift, contact, orthography)
  phonology.ts      feature system, inventory generation, syllable templates, phonotactics
  lexicon.ts        concept roots, morphology (affixes), compounding/derivation
  concepts.ts       the ~200-concept Swadesh-style list + derivation table
  changes/          sound-change catalog + rule application engine
  drift.ts          semantic drift graph, taboo replacement, coinage (with M7's compound-
                    clipping and self-compound-avoidance tuning)
  contact.ts        geography, borrowing, loanword adaptation, doublets
  history.ts        simulation driver: branching family tree, per-branch event logs
  romanize.ts       the single neutral phonemic romanization (used for proto forms, and for
                    every JSON `romanized` field)
  orthography.ts    per-daughter-language orthographic conventions, sampled at query/render
                    time; `spell()` renders a word through one daughter's own conventions
  query.ts          trace, cognates, doublets, dictionaries — the phonemic query layer
  render.ts         pure text rendering for the CLI (leaf spellings, cognate tables, etc.)
  serialize.ts      JSON dump (+ optional derived per-leaf dictionary/etymology section)
  explorer/         the self-contained HTML explorer template
  cli.ts            etymon generate | tree | dict | trace | cognates | doublets | explore
prototype/etymon.mjs  the original ~400-line zero-dependency proof of concept
examples/seed42.json  a committed example dump (seed 42, drift + contact enabled)
specs/               per-milestone implementation specs (M1–M7)
test/                vitest suite: golden snapshots, unit tests, property tests
```

## Prototype

The original proof of concept still runs standalone:

```
node prototype/etymon.mjs [seed]
```

It already did seeded deterministic generation, a 22-consonant feature system, phonotactic
root generation, a catalog of real sound-change types, a branching family tree, cognate tables,
and step-by-step etymology traces — everything the full TypeScript system above ports to a
typed feature system and builds on top of.
