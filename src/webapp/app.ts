// The live web app (webapp/index.html loads this as an ES module). Unlike
// the M4 explorer — a static page around one embedded dump — this app owns
// a generation worker (src/webapp/worker.ts) running the real engine, so
// seed/centuries/leaves/drift/contact controls regenerate a whole family
// live. Rendering reads the same dump `derived` section the explorer reads;
// the display conventions (leaf spellings, † coined / ‡ borrowed marks,
// neutral romanization for proto forms) deliberately match src/render.ts
// and src/explorer/template.ts.

import type { Branch } from '../history.js';
import type { DerivedDictionaryEntry, DerivedLeaf, DerivedTraceStep, EtymonDump } from '../serialize.js';
import type { DoubletView, GenRequest, GenResponse } from './protocol.js';

type State = {
  dump: EtymonDump | null;
  doublets: Record<string, DoubletView[]>;
  leafId: string | null;
  concept: string | null;
  filterQuery: string;
};

const state: State = { dump: null, doublets: {}, leafId: null, concept: null, filterQuery: '' };

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------- controls

type Controls = {
  seed: number;
  centuries: number;
  maxLeaves: number;
  drift: boolean;
  contact: boolean;
};

const DEFAULT_CONTROLS: Controls = { seed: 42, centuries: 20, maxLeaves: 6, drift: true, contact: true };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function readControls(): Controls {
  const num = (id: string, fallback: number, lo: number, hi: number) => {
    const raw = Number.parseInt(byId<HTMLInputElement>(id).value, 10);
    return Number.isFinite(raw) ? clamp(raw, lo, hi) : fallback;
  };
  return {
    seed: num('seed', DEFAULT_CONTROLS.seed, 0, 2 ** 31 - 1),
    centuries: num('centuries', DEFAULT_CONTROLS.centuries, 1, 50),
    maxLeaves: num('max-leaves', DEFAULT_CONTROLS.maxLeaves, 1, 12),
    drift: byId<HTMLInputElement>('drift').checked,
    contact: byId<HTMLInputElement>('contact').checked,
  };
}

function writeControls(c: Controls): void {
  byId<HTMLInputElement>('seed').value = String(c.seed);
  byId<HTMLInputElement>('centuries').value = String(c.centuries);
  byId<HTMLInputElement>('max-leaves').value = String(c.maxLeaves);
  byId<HTMLInputElement>('drift').checked = c.drift;
  byId<HTMLInputElement>('contact').checked = c.contact;
}

/** Controls round-trip through location.hash (#seed=42&centuries=20&…) so a
 * reload — or a shared link — lands on the same simulation. */
function controlsFromHash(): Controls {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const num = (key: string, fallback: number) => {
    const raw = Number.parseInt(params.get(key) ?? '', 10);
    return Number.isFinite(raw) ? raw : fallback;
  };
  const flag = (key: string, fallback: boolean) => {
    const raw = params.get(key);
    return raw === null ? fallback : raw !== '0';
  };
  return {
    seed: num('seed', DEFAULT_CONTROLS.seed),
    centuries: num('centuries', DEFAULT_CONTROLS.centuries),
    maxLeaves: num('leaves', DEFAULT_CONTROLS.maxLeaves),
    drift: flag('drift', DEFAULT_CONTROLS.drift),
    contact: flag('contact', DEFAULT_CONTROLS.contact),
  };
}

function controlsToHash(c: Controls): void {
  const hash = `#seed=${c.seed}&centuries=${c.centuries}&leaves=${c.maxLeaves}&drift=${c.drift ? 1 : 0}&contact=${c.contact ? 1 : 0}`;
  history.replaceState(null, '', hash);
}

// ------------------------------------------------------------------ worker

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

let requestCounter = 0;
let inFlight = false;
let queued: Controls | null = null;

function requestGeneration(c: Controls): void {
  if (inFlight) {
    queued = c; // latest request wins; stale responses are dropped by id
    return;
  }
  inFlight = true;
  requestCounter += 1;
  const req: GenRequest = { id: requestCounter, ...c };
  setStatus('generating…', true);
  worker.postMessage(req);
}

worker.onmessage = (e: MessageEvent) => {
  const res = e.data as GenResponse;
  inFlight = false;
  if (queued) {
    const next = queued;
    queued = null;
    requestGeneration(next);
    return; // this response is stale by construction — a newer request exists
  }
  if (res.id !== requestCounter) return;
  if (!res.ok) {
    setStatus(`error: ${res.error}`, false);
    return;
  }
  setStatus(`generated in ${res.ms} ms`, false);
  loadResult(res.dump, res.doublets);
};

function setStatus(text: string, busy: boolean): void {
  byId('status').textContent = text;
  document.body.classList.toggle('busy', busy);
}

// ------------------------------------------------------------- dump access

function collectLeaves(branch: Branch, out: Branch[] = []): Branch[] {
  if (branch.children.length === 0) out.push(branch);
  else for (const child of branch.children) collectLeaves(child, out);
  return out;
}

function findPath(branch: Branch, targetId: string, prefix: Branch[]): Branch[] | null {
  const path = [...prefix, branch];
  if (branch.id === targetId) return path;
  for (const child of branch.children) {
    const found = findPath(child, targetId, path);
    if (found) return found;
  }
  return null;
}

function findDerivedLeaf(dump: EtymonDump, leafId: string): DerivedLeaf | null {
  return dump.derived?.leaves.find((l) => l.branchId === leafId) ?? null;
}

function findEntry(leaf: DerivedLeaf | null, concept: string): DerivedDictionaryEntry | null {
  return leaf?.dictionary.find((e) => e.concept === concept) ?? null;
}

// ------------------------------------------------------------------ render

function renderHeader(dump: EtymonDump): void {
  const leafCount = collectLeaves(dump.root).length;
  byId('family-name').textContent = dump.familyName;
  byId('family-meta').textContent =
    `seed ${dump.config.seed} — ${leafCount} daughter language${leafCount === 1 ? '' : 's'}` +
    ` — ${dump.config.centuries * 100} years simulated`;
}

function renderTreeNode(branch: Branch, selectedLeafId: string | null): string {
  const span = `${branch.start * 100}–${branch.end * 100}`;
  if (branch.children.length === 0) {
    const cls = 'leaf-btn' + (branch.id === selectedLeafId ? ' selected' : '');
    return (
      `<li><button type="button" class="${cls}" data-branch-id="${escapeHtml(branch.id)}">` +
      `${escapeHtml(branch.name ?? branch.id)} <span class="muted small">[${span}]</span></button></li>`
    );
  }
  const children = branch.children.map((c) => renderTreeNode(c, selectedLeafId)).join('');
  return `<li><span class="split-label">split, year ${branch.end * 100}</span><ul>${children}</ul></li>`;
}

function renderTree(dump: EtymonDump, selectedLeafId: string | null): void {
  const root = dump.root;
  const rootSpan = `${root.start * 100}–${root.end * 100}`;
  let html = `<div class="tree-root-label">${escapeHtml(dump.familyName)} <span class="muted small">[${rootSpan}]</span></div>`;
  const children = root.children.length === 0 ? renderTreeNode(root, selectedLeafId) : root.children.map((c) => renderTreeNode(c, selectedLeafId)).join('');
  html += `<ul class="tree-root">${children}</ul>`;
  byId('tree').innerHTML = html;
}

// Drift/taboo/paradigm notes bake in their own "c. year N" (src/drift.ts,
// src/changes/paradigms.ts), which would duplicate the year column this
// list renders — same strip as the M4 explorer.
function stripYearSuffix(text: string): string {
  return text.replace(/,?\s*c\.\s*year\s*\d+\s*$/, '');
}

function renderBranchHistory(dump: EtymonDump, leafId: string): void {
  const path = findPath(dump.root, leafId, []) ?? [];
  const items: { century: number; paradigm: boolean; text: string }[] = [];
  for (const branch of path) {
    for (const ev of branch.events) {
      const text = ev.kind === 'sound' ? ev.change.description : stripYearSuffix(ev.note);
      items.push({ century: ev.century, paradigm: false, text });
    }
    for (const note of branch.paradigmNotes) {
      items.push({ century: note.century, paradigm: true, text: stripYearSuffix(note.note) });
    }
  }
  items.sort((a, b) => a.century - b.century);
  const container = byId('branch-history');
  if (items.length === 0) {
    container.innerHTML = '<p class="muted small">No recorded sound changes.</p>';
    return;
  }
  const rows = items
    .map((item) => `<li${item.paradigm ? ' class="paradigm-note"' : ''}><span class="year">year ${item.century * 100}</span>${escapeHtml(item.text)}</li>`)
    .join('');
  container.innerHTML = `<ul class="history-list">${rows}</ul>`;
}

function originMark(entry: DerivedDictionaryEntry): string {
  return entry.borrowed ? ' ‡' : entry.coined ? ' †' : '';
}

function renderDictionary(dump: EtymonDump, leafId: string, filterQuery: string): void {
  const leaf = findDerivedLeaf(dump, leafId);
  const container = byId('dict-list');
  byId('dict-leaf-name').textContent = leaf ? `— ${leaf.name}` : '';
  if (!leaf) {
    container.innerHTML = '<p class="muted small">No dictionary available.</p>';
    return;
  }
  const needle = filterQuery.trim().toLowerCase();
  const rows = leaf.dictionary.filter((entry) => {
    if (!needle) return true;
    const word = entry.spelled ?? entry.romanized;
    return entry.concept.toLowerCase().includes(needle) || word.toLowerCase().includes(needle);
  });
  if (rows.length === 0) {
    container.innerHTML = '<p class="muted small">No matches.</p>';
    return;
  }
  const html = rows
    .map((entry) => {
      const cls = 'dict-row' + (entry.concept === state.concept ? ' selected' : '');
      const word = entry.spelled ?? entry.romanized;
      return (
        `<li><button type="button" class="${cls}" data-concept="${escapeHtml(entry.concept)}">` +
        `<span class="concept muted">${escapeHtml(entry.concept)}</span> — ` +
        `<span class="word">${escapeHtml(word + originMark(entry))}</span></button></li>`
      );
    })
    .join('');
  container.innerHTML = `<ul class="dict-rows">${html}</ul>`;
}

// Timeline headlines show the leaf's own spelling, with the neutral
// phonemic romanization in parentheses only where the two differ
// (specs/M7.md, same as the M4 explorer).
function stepFormHtml(step: Pick<DerivedTraceStep, 'romanized' | 'spelled'>): string {
  const spelled = step.spelled ?? step.romanized;
  let html = escapeHtml(spelled);
  if (step.romanized !== spelled) html += ` <span class="muted small">(${escapeHtml(step.romanized)})</span>`;
  return html;
}

function renderEtymology(dump: EtymonDump, leafId: string, concept: string | null): void {
  const container = byId('etymology');
  if (!concept) {
    container.innerHTML = '<p class="muted small">Select a word from the dictionary to see its etymology.</p>';
    return;
  }
  const leaf = findDerivedLeaf(dump, leafId);
  const proto = dump.lexicon.lexemes.find((l) => l.concept === concept) ?? null;
  const entry = findEntry(leaf, concept);
  if (!leaf || !proto || !entry) {
    container.innerHTML = '<p class="muted small">No etymology available.</p>';
    return;
  }

  // A coined/reassigned word's trace starts at its own reassignment century,
  // not the family proto root (specs/M5.md) — if the first step is a
  // 'semantic' milestone, show that as the timeline's genesis node.
  const allSteps = entry.trace;
  const hasSemanticGenesis = allSteps.length > 0 && allSteps[0]!.kind === 'semantic';
  const genesisStep = hasSemanticGenesis ? allSteps[0]! : null;
  const steps = hasSemanticGenesis ? allSteps.slice(1) : allSteps;
  const protoStepHtml = genesisStep
    ? `<div class="timeline-step proto semantic${steps.length === 0 ? ' final' : ''}">` +
      `<span class="form">${stepFormHtml(genesisStep)}</span>` +
      `<span class="label">year ${genesisStep.century * 100} — ${escapeHtml(genesisStep.description)}</span></div>`
    : // Proto forms keep the neutral phonemic romanization (specs/M7.md).
      `<div class="timeline-step proto${steps.length === 0 ? ' final' : ''}">` +
      `<span class="form">*${escapeHtml(proto.word.romanized)}</span>` +
      `<span class="label">${escapeHtml(dump.familyName)}</span></div>`;
  const stepsHtml = steps
    .map((step, i) => {
      const cls = 'timeline-step' + (i === steps.length - 1 ? ' final' : '') + (step.kind === 'semantic' ? ' semantic' : '');
      return (
        `<div class="${cls}"><span class="form">${stepFormHtml(step)}</span>` +
        `<span class="label">year ${step.century * 100} — ${escapeHtml(step.description)}</span></div>`
      );
    })
    .join('');

  const derivedLeaves = dump.derived?.leaves ?? [];
  const cognateHeaders = derivedLeaves.map((l) => `<th>${escapeHtml(l.name)}</th>`).join('');
  const cognateCells = derivedLeaves
    .map((l) => {
      const e = findEntry(l, concept);
      const cls = l.branchId === leafId ? ' class="selected"' : '';
      const word = e ? (e.spelled ?? e.romanized) + originMark(e) : '—';
      return `<td${cls} data-branch-id="${escapeHtml(l.branchId)}">${escapeHtml(word)}</td>`;
    })
    .join('');

  const senses = entry.senses ?? [];
  const notes = entry.notes ?? [];
  const sensesHtml = senses.length > 1 ? `<p class="muted small">senses: ${senses.map(escapeHtml).join(', ')}</p>` : '';
  const notesHtml = notes.length > 0 ? `<p class="muted small semantic-notes">${notes.map(escapeHtml).join('<br>')}</p>` : '';

  container.innerHTML =
    `<div class="etymology-header"><strong>${escapeHtml(concept)}</strong>` +
    (steps.length > 0 ? '<button type="button" id="play-btn">▶ Play</button>' : '') +
    '</div>' +
    sensesHtml +
    notesHtml +
    `<div class="timeline" id="timeline">${protoStepHtml}${stepsHtml}</div>` +
    '<h2>Cognates <span class="muted small">(click a column to switch language; † coined, ‡ borrowed)</span></h2>' +
    `<div class="cognate-table-wrap"><table class="cognate-table"><thead><tr>${cognateHeaders}</tr></thead>` +
    `<tbody><tr>${cognateCells}</tr></tbody></table></div>`;

  const playBtn = document.getElementById('play-btn');
  if (playBtn) playBtn.addEventListener('click', playTimeline);
}

function playTimeline(): void {
  const steps = byId('timeline').querySelectorAll('.timeline-step:not(.proto)');
  for (const step of steps) step.classList.add('pending');
  let index = 0;
  const revealNext = () => {
    if (index >= steps.length) return;
    steps[index]!.classList.remove('pending');
    index += 1;
    if (index < steps.length) setTimeout(revealNext, 600);
  };
  setTimeout(revealNext, 600);
}

function renderDoublets(leafId: string): void {
  const container = byId('doublets');
  const rows = state.doublets[leafId] ?? [];
  if (rows.length === 0) {
    container.innerHTML = '<p class="muted small">No doublets in this language (inherited + borrowed reflexes of one proto root).</p>';
    return;
  }
  const html = rows
    .map(
      (d) =>
        `<li><strong>${escapeHtml(d.concept)}</strong>: ` +
        `<span class="word">${escapeHtml(d.borrowedSpelled)}</span> ` +
        `<span class="muted small">(borrowed from ${escapeHtml(d.fromLabel)}, year ${d.century * 100})</span>` +
        ` vs <span class="word">${escapeHtml(d.nativeSpelled)}</span> ` +
        `<span class="muted small">(inherited${d.nativeKind === 'archaic' ? ', archaic' : `, now '${escapeHtml(d.nativeHome)}'`})</span></li>`,
    )
    .join('');
  container.innerHTML = `<ul class="history-list">${html}</ul>`;
}

// -------------------------------------------------------------- controller

function selectLeaf(leafId: string): void {
  if (!state.dump) return;
  state.leafId = leafId;
  renderTree(state.dump, state.leafId);
  renderBranchHistory(state.dump, state.leafId);
  renderDictionary(state.dump, state.leafId, state.filterQuery);
  renderEtymology(state.dump, state.leafId, state.concept);
  renderDoublets(state.leafId);
}

function selectConcept(concept: string): void {
  if (!state.dump || !state.leafId) return;
  state.concept = concept;
  renderDictionary(state.dump, state.leafId, state.filterQuery);
  renderEtymology(state.dump, state.leafId, state.concept);
}

/** Swap in a freshly generated simulation, preserving the current view where
 * it still makes sense: the concept list is the same across every seed, so a
 * selected concept survives regeneration (watch one word mutate as you churn
 * seeds); the selected leaf carries over by position in the leaf list. */
function loadResult(dump: EtymonDump, doubletsByLeaf: Record<string, DoubletView[]>): void {
  const prevLeafIndex = state.dump ? collectLeaves(state.dump.root).findIndex((l) => l.id === state.leafId) : -1;
  state.dump = dump;
  state.doublets = doubletsByLeaf;
  renderHeader(dump);
  const newLeaves = collectLeaves(dump.root);
  const leaf = newLeaves[clamp(prevLeafIndex, 0, newLeaves.length - 1)] ?? newLeaves[0];
  if (!leaf) return;
  selectLeaf(leaf.id);
}

function downloadDump(): void {
  if (!state.dump) return;
  const blob = new Blob([JSON.stringify(state.dump)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `etymon-seed${state.dump.config.seed}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function init(): void {
  const initial = controlsFromHash();
  writeControls(initial);

  let debounceTimer: number | undefined;
  const regenerate = () => {
    const c = readControls();
    writeControls(c); // reflect clamping back into the inputs
    controlsToHash(c);
    requestGeneration(c);
  };
  const regenerateSoon = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(regenerate, 150);
  };

  for (const id of ['seed', 'centuries', 'max-leaves']) byId(id).addEventListener('input', regenerateSoon);
  for (const id of ['drift', 'contact']) byId(id).addEventListener('change', regenerate);
  byId('random-seed').addEventListener('click', () => {
    byId<HTMLInputElement>('seed').value = String(Math.floor(Math.random() * 1_000_000));
    regenerate();
  });
  byId('download').addEventListener('click', downloadDump);

  byId('filter').addEventListener('input', (e) => {
    state.filterQuery = (e.target as HTMLInputElement).value;
    if (state.dump && state.leafId) renderDictionary(state.dump, state.leafId, state.filterQuery);
  });
  byId('tree').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button.leaf-btn');
    if (btn) selectLeaf(btn.getAttribute('data-branch-id')!);
  });
  byId('dict-list').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button.dict-row');
    if (btn) selectConcept(btn.getAttribute('data-concept')!);
  });
  byId('etymology').addEventListener('click', (e) => {
    const cell = (e.target as HTMLElement).closest('td[data-branch-id]');
    if (cell) selectLeaf(cell.getAttribute('data-branch-id')!);
  });

  requestGeneration(initial);
}

init();
