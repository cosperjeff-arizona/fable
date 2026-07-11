// Pure text rendering for the CLI (specs/M3.md: "Output style: follow the
// prototype's report... `*` before proto forms and `>` derivation chains").
// Split out from src/cli.ts so tests can exercise the exact text a command
// produces without spawning a process or triggering cli.ts's argv-driven
// `main()`.

import type { Branch, Simulation } from './history.js';
import { coinageInfo, cognates, formIn, leaves, semanticNotes, senses, trace } from './query.js';
import { CONCEPTS } from './concepts.js';
import { romanize } from './romanize.js';
import type { Word } from './phonology.js';
import type { DriftEvent } from './drift.js';

export function findLeaf(sim: Simulation, needle: string): Branch {
  const lower = needle.toLowerCase();
  const all = leaves(sim);
  const byName = all.find((b) => (b.name ?? '').toLowerCase() === lower);
  if (byName) return byName;
  const byId = all.find((b) => b.id.toLowerCase() === lower);
  if (byId) return byId;
  const available = all.map((b) => b.name ?? b.id).join(', ');
  throw new Error(`no daughter language named "${needle}". Available: ${available}`);
}

function branchLabel(sim: Simulation, branch: Branch): string {
  if (branch.id === sim.root.id) return sim.familyName;
  if (branch.children.length === 0) return branch.name ?? branch.id;
  return `branch to year ${branch.end * 100}`;
}

export function header(sim: Simulation): string[] {
  const years = sim.config.centuries * 100;
  return [
    `ETYMON — seed ${sim.config.seed}`,
    `Family: ${sim.familyName} (${leaves(sim).length} daughter languages, ${years} years)`,
  ];
}

export function drawTree(sim: Simulation): string[] {
  const out: string[] = ['Family tree:'];
  const walk = (node: Branch, prefix: string, isLast: boolean, isRoot: boolean): void => {
    const label = node.children.length > 0 ? (isRoot ? sim.familyName : `(split, year ${node.end * 100})`) : (node.name ?? node.id);
    const span = `${node.start * 100}–${node.end * 100}`;
    if (isRoot) out.push(`  ${label}  [${span}]`);
    else out.push(`  ${prefix}${isLast ? '└─ ' : '├─ '}${label}  [${span}]`);
    const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    node.children.forEach((c, i) => walk(c, childPrefix, i === node.children.length - 1, false));
  };
  walk(sim.root, '', true, true);
  return out;
}

/** specs/M5.md's addition to `generate`'s output: a short label for a
 * drift/taboo event, in the same "no year, caller prepends it" style as a
 * sound change's `description` — keeps `changeHistory` uniform across
 * event kinds. The fuller narrative (with the year already baked in) lives
 * on the event's own `note` field and is what `dict`/`trace` show instead
 * (specs/M5.md's literal note examples, e.g. "originally 'sun'; came to
 * mean 'day' c. year 900"). */
function driftEventLabel(ev: DriftEvent): string {
  switch (ev.kind) {
    case 'shift':
      return `semantic shift: '${ev.from}' > '${ev.to}'`;
    case 'extend':
      return `semantic extension: '${ev.from}' also means '${ev.to}'`;
    case 'taboo':
      return `taboo replacement: '${ev.concept}' renamed`;
  }
}

export function changeHistory(sim: Simulation): string[] {
  const out: string[] = ['Sound changes by branch:'];
  const walk = (node: Branch): void => {
    const label = branchLabel(sim, node);
    for (const ev of node.events) {
      const text = ev.kind === 'sound' ? ev.change.description : driftEventLabel(ev);
      out.push(`  [${label}] year ${ev.century * 100}: ${text}`);
    }
    for (const note of node.paradigmNotes) {
      out.push(`  [${label}] year ${note.century * 100}: paradigm collapse — ${note.note}`);
    }
    for (const child of node.children) walk(child);
  };
  walk(sim.root);
  return out;
}

function form(word: Word): string {
  return romanize(word);
}

function table(cols: string[], rows: string[][]): string[] {
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i]!.length)));
  const fmt = (r: string[]): string => '  ' + r.map((cell, i) => cell.padEnd(widths[i]!)).join('  ');
  return [fmt(cols), '  ' + widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(fmt)];
}

export function renderGenerate(sim: Simulation): string[] {
  return [...header(sim), '', ...drawTree(sim), '', ...changeHistory(sim)];
}

export function renderTree(sim: Simulation): string[] {
  return [...header(sim), '', ...drawTree(sim)];
}

export function renderDict(sim: Simulation, leaf: Branch): string[] {
  const lines: string[] = [`Dictionary of ${leaf.name ?? leaf.id} (branch ${leaf.id}, years ${leaf.start * 100}–${leaf.end * 100}):`];
  const protoById = new Map(sim.lexicon.lexemes.map((l) => [l.concept, l] as const));
  const width = Math.max(...CONCEPTS.map((c) => c.id.length));
  for (const concept of CONCEPTS) {
    const proto = protoById.get(concept.id);
    if (!proto) continue;
    const evolved = form(formIn(sim, concept.id, leaf.id));
    // specs/M5.md: a concept whose word was coined/tabooed shows *that*
    // origin (current parts), not the family's original proto-level
    // derivation, which may no longer describe the concept's current word.
    const coinage = coinageInfo(sim, concept.id, leaf.id);
    const note = coinage
      ? ` (${coinage.taboo ? 'taboo replacement' : 'coined'}: ${coinage.parts.join(' + ')})`
      : proto.origin === 'root'
        ? ''
        : ` (${proto.origin}: ${proto.parts?.join(' + ')})`;
    const sensesList = senses(sim, concept.id, leaf.id);
    const sensesTag = sensesList.length > 1 ? ` [senses: ${sensesList.join(', ')}]` : '';
    lines.push(`  ${concept.id.padEnd(width)} ${evolved}${note}${sensesTag}`);
    for (const semanticNote of semanticNotes(sim, concept.id, leaf.id)) {
      lines.push(`  ${' '.repeat(width)} — ${semanticNote}`);
    }
  }
  return lines;
}

export function renderTrace(sim: Simulation, concept: string, targets: readonly Branch[]): string[] {
  const proto = sim.lexicon.lexemes.find((l) => l.concept === concept);
  if (!proto) throw new Error(`unknown concept "${concept}"`);
  const lines: string[] = [];
  for (const leaf of targets) {
    const steps = trace(sim, concept, leaf.id);
    const finalRomanized = steps.length > 0 ? steps[steps.length - 1]!.romanized : proto.word.romanized;
    // specs/M5.md: a coined/reassigned word's trace starts at its own
    // reassignment century — the genesis line names *that* origin instead
    // of the family's proto root, which this word no longer descends from.
    const genesis = steps.length > 0 && steps[0]!.kind === 'semantic' ? steps[0]! : null;
    if (genesis) {
      lines.push(`${leaf.name ?? leaf.id} "${finalRomanized}" (${concept}) — ${genesis.description}, c. year ${genesis.century * 100}`);
    } else {
      lines.push(`${leaf.name ?? leaf.id} "${finalRomanized}" (${concept}) < ${sim.familyName} *${proto.word.romanized}`);
    }
    const rest = genesis ? steps.slice(1) : steps;
    for (const step of rest) {
      const marker = step.kind === 'semantic' ? '~>' : '>';
      lines.push(`    ${marker} ${step.romanized}   c. year ${step.century * 100}: ${step.description}`);
    }
  }
  return lines;
}

export function renderCognates(sim: Simulation, concept: string): string[] {
  const proto = sim.lexicon.lexemes.find((l) => l.concept === concept);
  if (!proto) throw new Error(`unknown concept "${concept}"`);
  const rows = cognates(sim, concept);
  const cols = ['concept', `*${sim.familyName.replace(/^Proto-/, '')}`, ...rows.map((r) => r.name)];
  // specs/M5.md: a non-cognate cell (coined/tabooed word) is marked with †
  // so the table honestly shows lexical replacement rather than pretending
  // every daughter's form descends from the shared proto root.
  const dataRow = [concept, `*${proto.word.romanized}`, ...rows.map((r) => form(r.form) + (r.cognate ? '' : ' †'))];
  return [`Cognates — ${concept}:`, ...table(cols, [dataRow])];
}
