// Pure text rendering for the CLI (specs/M3.md: "Output style: follow the
// prototype's report... `*` before proto forms and `>` derivation chains").
// Split out from src/cli.ts so tests can exercise the exact text a command
// produces without spawning a process or triggering cli.ts's argv-driven
// `main()`.

import type { Branch, Simulation } from './history.js';
import { cognates, formIn, leaves, trace } from './query.js';
import { CONCEPTS } from './concepts.js';
import { romanize } from './romanize.js';
import type { Word } from './phonology.js';

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

export function changeHistory(sim: Simulation): string[] {
  const out: string[] = ['Sound changes by branch:'];
  const walk = (node: Branch): void => {
    const label = branchLabel(sim, node);
    for (const ev of node.events) {
      out.push(`  [${label}] year ${ev.century * 100}: ${ev.change.description}`);
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
    const note = proto.origin === 'root' ? '' : ` (${proto.origin}: ${proto.parts?.join(' + ')})`;
    lines.push(`  ${concept.id.padEnd(width)} ${evolved}${note}`);
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
    lines.push(`${leaf.name ?? leaf.id} "${finalRomanized}" (${concept}) < ${sim.familyName} *${proto.word.romanized}`);
    for (const step of steps) {
      lines.push(`    > ${step.romanized}   c. year ${step.century * 100}: ${step.description}`);
    }
  }
  return lines;
}

export function renderCognates(sim: Simulation, concept: string): string[] {
  const proto = sim.lexicon.lexemes.find((l) => l.concept === concept);
  if (!proto) throw new Error(`unknown concept "${concept}"`);
  const rows = cognates(sim, concept);
  const cols = ['concept', `*${sim.familyName.replace(/^Proto-/, '')}`, ...rows.map((r) => r.name)];
  const dataRow = [concept, `*${proto.word.romanized}`, ...rows.map((r) => form(r.form))];
  return [`Cognates — ${concept}:`, ...table(cols, [dataRow])];
}
