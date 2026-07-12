// Message types shared between the web app's UI thread (src/webapp/app.ts)
// and its generation worker (src/webapp/worker.ts). Types only — nothing
// here emits JS beyond an empty module.

import type { EtymonDump } from '../serialize.js';

/** UI → worker: run one full simulation with these parameters. `id` is a
 * monotonically increasing request counter so the UI can discard stale
 * responses when the user churns through seeds faster than the worker
 * generates them (latest request wins). */
export type GenRequest = {
  id: number;
  seed: number;
  centuries: number;
  maxLeaves: number;
  drift: boolean;
  contact: boolean;
};

/** One doublet row, pre-rendered to plain strings in the worker so the UI
 * never needs the Simulation object (only the structured-cloneable dump
 * crosses the worker boundary). Mirrors src/query.ts's DoubletEntry plus
 * each form re-spelled in the leaf's own orthography (specs/M7.md). */
export type DoubletView = {
  concept: string;
  borrowedSpelled: string;
  borrowedRomanized: string;
  nativeHome: string;
  nativeSpelled: string;
  nativeRomanized: string;
  nativeKind: 'archaic' | 'displaced';
  fromLabel: string;
  century: number;
};

export type GenResponse =
  | { id: number; ok: true; dump: EtymonDump; doublets: Record<string, DoubletView[]>; ms: number }
  | { id: number; ok: false; error: string };
