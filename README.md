# Etymon

**A simulated-historical-linguistics engine.** Etymon doesn't generate a constructed
language — it generates a *proto*-language and then simulates two thousand years of history:
typologically real sound changes, population splits, semantic drift, and borrowing. The
result is a whole language family in which every word of every daughter language has a
complete, step-by-step etymology that actually happened inside the simulation.

See [DESIGN.md](DESIGN.md) for the full concept, architecture, and roadmap.

## Prototype

A zero-dependency proof of concept lives in `prototype/etymon.mjs`:

```
node prototype/etymon.mjs [seed]
```

Sample output (seed 7):

```
Sample etymologies:
  South Gukm "elg" (blood) < Proto-Hanak *salgit
      > halgit   c. year 100: weakening of initial s (s > h / #_)
      > halgi   c. year 200: loss of word-final stops
      > helgi   c. year 400: umlaut: back vowels fronted before i in the next syllable
      > elgi   c. year 1000: loss of h in all positions
      > elg   c. year 1300: apocope: loss of final vowels after a consonant
```

It also prints the family tree, each branch's sound-change history, and a full cognate
table across all daughter languages. Every run is deterministic in its seed. Nobody wrote
that derivation of *salgit* — it happened, century by century, and the tool can prove it.
