// The web app's generation worker: runs the real engine — the same
// generateSimulation/toJSON the CLI uses — off the UI thread, so churning
// through seeds never freezes the page. The UI only ever sees the JSON
// dump (plus pre-rendered doublet rows); the Simulation object itself
// never crosses the worker boundary.

import { generateSimulation } from '../history.js';
import { toJSON } from '../serialize.js';
import { leaves, doublets, formIn } from '../query.js';
import { orthographyFor, spell } from '../orthography.js';
import type { DoubletView, GenRequest, GenResponse } from './protocol.js';

// Merges with lib.dom's postMessage overloads (this project compiles the
// webapp against lib DOM, not lib WebWorker — see tsconfig.webapp.json);
// at runtime this is the worker-scope single-argument postMessage.
declare function postMessage(message: unknown): void;

self.onmessage = (e: MessageEvent) => {
  const req = e.data as GenRequest;
  let res: GenResponse;
  try {
    const t0 = Date.now();
    const sim = generateSimulation({
      seed: req.seed,
      centuries: req.centuries,
      maxLeaves: req.maxLeaves,
      driftEnabled: req.drift,
      contactEnabled: req.contact,
    });
    const dump = toJSON(sim, { derived: true });
    const doubletsByLeaf: Record<string, DoubletView[]> = {};
    for (const leaf of leaves(sim)) {
      const orthography = orthographyFor(sim, leaf.id);
      doubletsByLeaf[leaf.id] = doublets(sim, leaf.id).map((d) => ({
        concept: d.concept,
        borrowedSpelled: spell(formIn(sim, d.concept, leaf.id), orthography),
        borrowedRomanized: d.borrowedRomanized,
        nativeHome: d.native.home,
        nativeSpelled: spell(formIn(sim, d.native.home, leaf.id), orthography),
        nativeRomanized: d.native.romanized,
        nativeKind: d.native.kind,
        fromLabel: d.fromLabel,
        century: d.century,
      }));
    }
    res = { id: req.id, ok: true, dump, doublets: doubletsByLeaf, ms: Date.now() - t0 };
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  postMessage(res);
};
