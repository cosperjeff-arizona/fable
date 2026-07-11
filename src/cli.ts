#!/usr/bin/env node
// The `etymon` CLI (specs/M3.md's "src/cli.ts").
//
// Hand-rolled argv parsing, zero deps. All text formatting lives in
// src/render.ts (pure functions, unit-tested directly); this file is just
// argv parsing, simulation setup, and I/O.
//
// Commands: generate | dict | trace | cognates | tree. Every command
// re-runs the simulation from --seed unless --from <dump.json> is given.

import { generateSimulation, type Simulation } from './history.js';
import { leaves } from './query.js';
import { toJSON, fromJSON } from './serialize.js';
import { findLeaf, renderCognates, renderDict, renderGenerate, renderTrace, renderTree } from './render.js';
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
  return generateSimulation({ seed, centuries, maxLeaves });
}

// ------------------------------------------------------------------ commands

function cmdGenerate(sim: Simulation, flags: Record<string, string>): void {
  console.log(renderGenerate(sim).join('\n'));
  if (flags.json) {
    writeFileSync(flags.json, JSON.stringify(toJSON(sim), null, 2));
    console.log(`\nWrote ${flags.json}`);
  }
}

function cmdDict(sim: Simulation, langName: string): void {
  console.log(renderDict(sim, findLeaf(sim, langName)).join('\n'));
}

function cmdTrace(sim: Simulation, concept: string, flags: Record<string, string>): void {
  const targets = flags.lang ? [findLeaf(sim, flags.lang)] : leaves(sim);
  console.log(renderTrace(sim, concept, targets).join('\n'));
}

// ---------------------------------------------------------------------- main

const USAGE = `Usage: etymon <command> [options]

Commands:
  generate --seed N [--centuries N] [--max-leaves N] [--json dump.json]
  dict <language> --seed N
  trace <concept> --seed N [--lang <name>]
  cognates <concept> --seed N
  tree --seed N

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
