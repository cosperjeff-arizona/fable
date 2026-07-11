#!/usr/bin/env node
// The `etymon` CLI (specs/M3.md's "src/cli.ts").
//
// Hand-rolled argv parsing, zero deps. All text formatting lives in
// src/render.ts (pure functions, unit-tested directly); this file is just
// argv parsing, simulation setup, and I/O.
//
// Commands: generate | dict | trace | cognates | tree | explore. Every
// command re-runs the simulation from --seed unless --from <dump.json> is
// given.

import { generateSimulation, type Simulation } from './history.js';
import { leaves } from './query.js';
import { toJSON, fromJSON } from './serialize.js';
import { findLeaf, renderCognates, renderDict, renderDoublets, renderGenerate, renderTrace, renderTree } from './render.js';
import { embedDump } from './explorer/template.js';
import { readFileSync, writeFileSync } from 'node:fs';

// Minimal ambient declarations for the Node surface this CLI touches. No
// devDependency on @types/node (matches scripts/demo.ts's precedent) —
// this project's runtime surface is tiny enough to hand-declare. The
// 'node:fs' module itself is declared in src/node-shims.d.ts.
declare const process: { argv: string[]; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

// ------------------------------------------------------------- argv parsing

type ParsedArgs = { command: string | undefined; positionals: string[]; flags: Record<string, string> };

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (tok.startsWith('--')) {
      const name = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[name] = 'true';
        i += 1;
      } else {
        flags[name] = next;
        i += 2;
      }
    } else {
      positionals.push(tok);
      i += 1;
    }
  }
  const command = positionals.shift();
  return { command, positionals, flags };
}

function intFlag(flags: Record<string, string>, name: string, fallback: number): number {
  const raw = flags[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${name}: expected a number, got "${raw}"`);
  return n;
}

function loadSimulation(flags: Record<string, string>): Simulation {
  if (flags.from) {
    const raw = readFileSync(flags.from, 'utf8');
    return fromJSON(JSON.parse(raw));
  }
  const seed = intFlag(flags, 'seed', 42);
  const centuries = intFlag(flags, 'centuries', 20);
  const maxLeaves = intFlag(flags, 'max-leaves', 6);
  // specs/M5.md's "--no-drift" flag: the CLI defaults semantic drift/taboo/
  // coinage ON (opt-out), unlike the library-level `generateSimulation`
  // default (off), which exists purely so every pre-M5 direct caller/test
  // is untouched. Acceptance criterion 1: `--no-drift` reproduces the exact
  // M3-era output.
  const driftEnabled = !('no-drift' in flags);
  // specs/M6.md's "--no-contact" flag: same opt-out pattern as --no-drift —
  // the CLI defaults contact/borrowing ON, unlike the library-level
  // `generateSimulation` default (off), which exists purely so every pre-M6
  // direct caller/test is untouched. Acceptance criterion 1: `--no-contact`
  // reproduces the exact pre-M6 output byte-for-byte.
  const contactEnabled = !('no-contact' in flags);
  return generateSimulation({ seed, centuries, maxLeaves, driftEnabled, contactEnabled });
}

// ------------------------------------------------------------------ commands

function cmdGenerate(sim: Simulation, flags: Record<string, string>): void {
  console.log(renderGenerate(sim).join('\n'));
  if (flags.json) {
    // Always includes `derived` (specs/M4.md): the JSON dump is the one
    // place the derived section gets computed, so any dump written to disk
    // is explorer-ready without a second pass.
    writeFileSync(flags.json, JSON.stringify(toJSON(sim, { derived: true }), null, 2));
    console.log(`\nWrote ${flags.json}`);
  }
}

/** specs/M4.md's `explore` command: embed a `{ derived: true }` dump into
 * src/explorer/template.ts's self-contained HTML template and write it out.
 * The escaping (so a concept/description containing literal "</script>"
 * text can't break out of the embedded <script> block) lives in
 * `embedDump` itself, so it's exercised the same way whether the HTML was
 * produced by this command or directly in a test. */
function cmdExplore(sim: Simulation, flags: Record<string, string>): void {
  const out = flags.out ?? 'etymon-explorer.html';
  writeFileSync(out, embedDump(toJSON(sim, { derived: true })));
  console.log(`Wrote ${out}`);
}

function cmdDict(sim: Simulation, langName: string): void {
  console.log(renderDict(sim, findLeaf(sim, langName)).join('\n'));
}

function cmdDoublets(sim: Simulation, langName: string): void {
  console.log(renderDoublets(sim, findLeaf(sim, langName)).join('\n'));
}

function cmdTrace(sim: Simulation, concept: string, flags: Record<string, string>): void {
  const targets = flags.lang ? [findLeaf(sim, flags.lang)] : leaves(sim);
  console.log(renderTrace(sim, concept, targets).join('\n'));
}

// ---------------------------------------------------------------------- main

const USAGE = `Usage: etymon <command> [options]

Commands:
  generate --seed N [--centuries N] [--max-leaves N] [--json dump.json] [--no-drift] [--no-contact]
  dict <language> --seed N [--no-drift] [--no-contact]
  trace <concept> --seed N [--lang <name>] [--no-drift] [--no-contact]
  cognates <concept> --seed N [--no-drift] [--no-contact]
  doublets <language> --seed N [--no-drift] [--no-contact]
  tree --seed N [--no-drift] [--no-contact]
  explore --seed N [--centuries N] [--max-leaves N] [--out explorer.html] [--no-drift] [--no-contact]

Semantic drift, taboo replacement, and coinage (specs/M5.md) are on by
default; pass --no-drift to reproduce pre-M5 output exactly. Contact and
borrowing between neighboring branches (specs/M6.md) are also on by
default; pass --no-contact to reproduce pre-M6 output exactly.

All commands accept --from dump.json instead of --seed to load a previously
generated simulation.`;

function main(): void {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));
  if (!command) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  try {
    switch (command) {
      case 'generate':
        cmdGenerate(loadSimulation(flags), flags);
        break;
      case 'tree':
        console.log(renderTree(loadSimulation(flags)).join('\n'));
        break;
      case 'dict': {
        const lang = positionals[0];
        if (!lang) throw new Error('dict: expected a language name argument');
        cmdDict(loadSimulation(flags), lang);
        break;
      }
      case 'trace': {
        const concept = positionals[0];
        if (!concept) throw new Error('trace: expected a concept argument');
        cmdTrace(loadSimulation(flags), concept, flags);
        break;
      }
      case 'cognates': {
        const concept = positionals[0];
        if (!concept) throw new Error('cognates: expected a concept argument');
        console.log(renderCognates(loadSimulation(flags), concept).join('\n'));
        break;
      }
      case 'doublets': {
        const lang = positionals[0];
        if (!lang) throw new Error('doublets: expected a language name argument');
        cmdDoublets(loadSimulation(flags), lang);
        break;
      }
      case 'explore':
        cmdExplore(loadSimulation(flags), flags);
        break;
      default:
        console.log(USAGE);
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(`etymon: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

main();
