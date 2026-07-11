#!/usr/bin/env node
// Etymon prototype — proof of concept for a simulated-historical-linguistics engine.
// Generates a proto-language, evolves it through ~20 centuries of sound change
// along a branching family tree, and prints cognate tables and etymologies.
//
// Usage: node prototype/etymon.mjs [seed]

const SEED = Number(process.argv[2] ?? 42);

// ---------------------------------------------------------------- randomness
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const shuffled = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ----------------------------------------------------------------- phonology
// Words are arrays of phoneme symbols. Features drive rule targeting.
const CONS = {
  p: { pl: 'lab', m: 'stop', v: 0 }, t: { pl: 'alv', m: 'stop', v: 0 }, k: { pl: 'vel', m: 'stop', v: 0 },
  b: { pl: 'lab', m: 'stop', v: 1 }, d: { pl: 'alv', m: 'stop', v: 1 }, g: { pl: 'vel', m: 'stop', v: 1 },
  f: { pl: 'lab', m: 'fric', v: 0 }, s: { pl: 'alv', m: 'fric', v: 0 }, h: { pl: 'glo', m: 'fric', v: 0 },
  v: { pl: 'lab', m: 'fric', v: 1 }, z: { pl: 'alv', m: 'fric', v: 1 }, sh: { pl: 'pal', m: 'fric', v: 0 },
  ch: { pl: 'pal', m: 'aff', v: 0 }, dj: { pl: 'pal', m: 'aff', v: 1 },
  m: { pl: 'lab', m: 'nas', v: 1 }, n: { pl: 'alv', m: 'nas', v: 1 },
  r: { pl: 'alv', m: 'liq', v: 1 }, l: { pl: 'alv', m: 'liq', v: 1 },
  w: { pl: 'lab', m: 'gli', v: 1 }, j: { pl: 'pal', m: 'gli', v: 1 },
};
const VOWELS = new Set(['i', 'e', 'a', 'o', 'u', 'y']);
const isV = (s) => VOWELS.has(s);
const isC = (s) => s in CONS;
const DISPLAY = { j: 'y', dj: 'j', y: 'ü' };
const show = (w) => w.map((s) => DISPLAY[s] ?? s).join('');

function makeInventory() {
  const core = ['p', 't', 'k', 'm', 'n', 's'];
  const extras = shuffled(['b', 'd', 'g', 'f', 'h', 'w', 'j', 'r', 'l', 'z']).slice(0, 4 + Math.floor(rnd() * 5));
  const cons = core.concat(extras);
  const vowels = chance(0.3) ? ['i', 'a', 'u'] : ['i', 'e', 'a', 'o', 'u'];
  const codas = ['m', 'n', 's', 'r', 'l', 't', 'k'].filter((c) => cons.includes(c));
  return { cons, vowels, codas };
}

function makeRoot(inv, used) {
  for (let tries = 0; tries < 50; tries++) {
    const w = [];
    const sylls = chance(0.15) ? 1 : 2;
    for (let s = 0; s < sylls; s++) {
      if (s > 0 || sylls === 1 || chance(0.8)) w.push(pick(inv.cons));
      w.push(pick(inv.vowels));
      if (chance(sylls === 1 ? 0.7 : 0.3)) w.push(pick(inv.codas));
    }
    const key = w.join('.');
    if (!used.has(key)) { used.add(key); return w; }
  }
  throw new Error('root space exhausted');
}

const CONCEPTS = [
  'water', 'fire', 'sun', 'moon', 'star', 'sky', 'earth', 'stone', 'tree', 'river',
  'mountain', 'fish', 'bird', 'dog', 'wolf', 'snake', 'eye', 'hand', 'blood', 'heart',
  'tongue', 'man', 'woman', 'child', 'people', 'house', 'road', 'king', 'name', 'night',
  'ice', 'salt',
];

// ------------------------------------------------------------- sound changes
// Each catalog entry instantiates a rule: { id, desc, apply(word) -> word }.
// apply() must return a NEW array if it changes anything.
// Guard: a rule never leaves a word vowel-less or shorter than 2 segments
// (stands in for analogical restoration of over-eroded forms).

function guarded(apply) {
  return (w) => {
    const out = apply(w);
    if (out.length < 2 || !out.some(isV)) return w;
    return out;
  };
}

const CATALOG = [
  () => ({
    id: 'voicing', desc: 'intervocalic voicing (p t k > b d g between vowels)',
    apply: guarded((w) => w.map((s, i) =>
      i > 0 && i < w.length - 1 && isV(w[i - 1]) && isV(w[i + 1])
        ? ({ p: 'b', t: 'd', k: 'g' }[s] ?? s) : s)),
  }),
  () => ({
    id: 'lenition', desc: 'intervocalic lenition (b d g > v z h between vowels)',
    apply: guarded((w) => w.map((s, i) =>
      i > 0 && i < w.length - 1 && isV(w[i - 1]) && isV(w[i + 1])
        ? ({ b: 'v', d: 'z', g: 'h' }[s] ?? s) : s)),
  }),
  () => ({
    id: 'final-v-loss', desc: 'apocope: loss of final vowels after a consonant',
    apply: guarded((w) =>
      w.length >= 3 && isV(w[w.length - 1]) && isC(w[w.length - 2]) ? w.slice(0, -1) : w),
  }),
  () => ({
    id: 'palatalization', desc: 'palatalization of velars before front vowels (k g > ch j / _i,e)',
    apply: guarded((w) => w.map((s, i) =>
      (w[i + 1] === 'i' || w[i + 1] === 'e' || w[i + 1] === 'y')
        ? ({ k: 'ch', g: 'dj' }[s] ?? s) : s)),
  }),
  () => {
    const variant = pick([
      { map: { a: 'o', o: 'u' }, desc: 'back-vowel chain raising (a > o > u)' },
      { map: { u: 'y' }, desc: 'fronting of u (u > ü)' },
      { map: { e: 'i' }, desc: 'raising of e (e > i)' },
      { map: { a: 'e' }, desc: 'fronting of a (a > e)' },
    ]);
    return {
      id: 'vowel-shift', desc: variant.desc,
      apply: guarded((w) => w.map((s) => variant.map[s] ?? s)),
    };
  },
  () => ({
    id: 'cluster-simpl', desc: 'simplification of initial consonant clusters',
    apply: guarded((w) => (isC(w[0]) && isC(w[1]) ? w.slice(1) : w)),
  }),
  () => ({
    id: 'final-stop-loss', desc: 'loss of word-final stops',
    apply: guarded((w) =>
      w.length >= 3 && isC(w[w.length - 1]) && CONS[w[w.length - 1]].m === 'stop'
        ? w.slice(0, -1) : w),
  }),
  () => ({
    id: 'debuccalization', desc: 'weakening of initial s (s > h / #_)',
    apply: guarded((w) => (w[0] === 's' ? ['h', ...w.slice(1)] : w)),
  }),
  () => ({
    id: 'h-loss', desc: 'loss of h in all positions',
    apply: guarded((w) => (w.includes('h') ? w.filter((s) => s !== 'h') : w)),
  }),
  () => ({
    id: 'final-devoicing', desc: 'final devoicing (b d g > p t k / _#)',
    apply: guarded((w) => {
      const last = w[w.length - 1];
      const dev = { b: 'p', d: 't', g: 'k' }[last];
      return dev ? [...w.slice(0, -1), dev] : w;
    }),
  }),
  () => ({
    id: 'rhotacism', desc: 'rhotacism (s z > r between vowels)',
    apply: guarded((w) => w.map((s, i) =>
      i > 0 && i < w.length - 1 && isV(w[i - 1]) && isV(w[i + 1]) && (s === 's' || s === 'z')
        ? 'r' : s)),
  }),
  () => ({
    id: 'umlaut', desc: 'umlaut: back vowels fronted before i in the next syllable (u > ü, o > e, a > e)',
    apply: guarded((w) => w.map((s, i) => {
      if (!{ u: 1, o: 1, a: 1 }[s]) return s;
      for (let k = i + 1; k < w.length; k++) if (isV(w[k])) return w[k] === 'i' ? ({ u: 'y', o: 'e', a: 'e' }[s]) : s;
      return s;
    })),
  }),
  () => ({
    id: 'syncope', desc: 'syncope: loss of medial unstressed vowels',
    apply: guarded((w) => {
      const vIdx = w.map((s, i) => (isV(s) ? i : -1)).filter((i) => i >= 0);
      if (vIdx.length < 3) return w;
      const i = vIdx[1];
      // skip if deletion would create a triple cluster
      const left = w.slice(0, i).filter(isC).length && isC(w[i - 1]);
      const cluster = (isC(w[i - 2]) && left) || (isC(w[i + 1]) && isC(w[i + 2]));
      if (cluster) return w;
      return [...w.slice(0, i), ...w.slice(i + 1)];
    }),
  }),
  () => ({
    id: 'nasal-assim', desc: 'nasal place assimilation (n > m before labials)',
    apply: guarded((w) => w.map((s, i) =>
      s === 'n' && w[i + 1] && CONS[w[i + 1]]?.pl === 'lab' ? 'm' : s)),
  }),
  () => ({
    id: 'w-fortition', desc: 'fortition of w (w > v)',
    apply: guarded((w) => w.map((s) => (s === 'w' ? 'v' : s))),
  }),
];

// ------------------------------------------------------------- family tree
// Node: { start, end, changes: [{century, rule}], children: [node] }
const END = 20; // centuries simulated (~2000 years)

function fillChanges(node, usedIds) {
  for (let c = node.start + 1; c <= node.end; c++) {
    if (!chance(0.45)) continue;
    for (let tries = 0; tries < 12; tries++) {
      const rule = pick(CATALOG)();
      if (usedIds.has(rule.id)) continue;
      usedIds.add(rule.id);
      node.changes.push({ century: c, rule });
      break;
    }
  }
  if (node.changes.length === 0 && node.end > node.start) {
    const rule = pick(CATALOG)();
    node.changes.push({ century: node.start + 1, rule });
    usedIds.add(rule.id);
  }
}

function buildTree() {
  const t1 = 3 + Math.floor(rnd() * 3);
  const root = { start: 0, end: t1, changes: [], children: [] };
  fillChanges(root, new Set());
  let leafBudget = 4;
  const grow = (start, depth, inherited) => {
    const canSplit = depth < 2 && leafBudget > 2 && start < 12 && chance(0.6);
    if (canSplit) {
      const t = Math.min(start + 4 + Math.floor(rnd() * 4), END - 3);
      const node = { start, end: t, changes: [], children: [] };
      fillChanges(node, new Set(inherited));
      leafBudget -= 1;
      const ids = new Set([...inherited, ...node.changes.map((c) => c.rule.id)]);
      node.children = [grow(t, depth + 1, ids), grow(t, depth + 1, ids)];
      return node;
    }
    const node = { start, end: END, changes: [], children: [] };
    fillChanges(node, new Set(inherited));
    return node;
  };
  const rootIds = new Set(root.changes.map((c) => c.rule.id));
  root.children = [grow(t1, 1, rootIds), grow(t1, 1, rootIds)];
  return root;
}

function leavesOf(node, path = []) {
  const p = [...path, node];
  if (node.children.length === 0) return [{ node, path: p }];
  return node.children.flatMap((c) => leavesOf(c, p));
}

function changeLog(path) {
  return path.flatMap((n) => n.changes);
}

function evolve(word, log) {
  const steps = [{ form: word, note: null }];
  let cur = word;
  for (const { century, rule } of log) {
    const next = rule.apply(cur);
    if (show(next) !== show(cur)) {
      steps.push({ form: next, note: `c. year ${century * 100}: ${rule.desc}` });
      cur = next;
    }
  }
  return { form: cur, steps };
}

// ------------------------------------------------------------------ generate
const inv = makeInventory();
const used = new Set();
const lexicon = new Map(CONCEPTS.map((c) => [c, makeRoot(inv, used)]));
const tree = buildTree();
const leaves = leavesOf(tree);

// Each daughter language is named after its own evolved word for "people".
const cap = (s) => s[0].toUpperCase() + s.slice(1);
for (const leaf of leaves) {
  leaf.name = cap(show(evolve(lexicon.get('people'), changeLog(leaf.path)).form));
}
// disambiguate identical names with directional prefixes, as real families do
const byName = new Map();
for (const leaf of leaves) byName.set(leaf.name, [...(byName.get(leaf.name) ?? []), leaf]);
for (const group of byName.values()) {
  if (group.length > 1) {
    const dirs = ['North', 'South', 'East', 'West'];
    group.forEach((leaf, i) => { leaf.name = `${dirs[i]} ${leaf.name}`; });
  }
}
const familyName = 'Proto-' + cap(show(lexicon.get('tongue')));

// -------------------------------------------------------------------- report
const out = [];
out.push(`ETYMON — seed ${SEED}`);
out.push(`Family: ${familyName} (${leaves.length} daughter languages, ${END * 100} years)`);
out.push('');

// family tree
out.push('Family tree:');
const drawTree = (node, prefix, isLast, isRoot) => {
  const label = node.children.length
    ? (isRoot ? familyName : `(split, year ${node.end * 100})`)
    : leaves.find((l) => l.node === node).name;
  const span = `${node.start * 100}–${node.end * 100}`;
  if (isRoot) out.push(`  ${label}  [${span}]`);
  else out.push(`  ${prefix}${isLast ? '└─ ' : '├─ '}${label}  [${span}]`);
  const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
  node.children.forEach((c, i) => drawTree(c, childPrefix, i === node.children.length - 1, false));
};
drawTree(tree, '', true, true);
out.push('');

// sound-change history per branch
out.push('Sound changes by branch:');
const describeBranch = (node, name) => {
  for (const { century, rule } of node.changes) {
    out.push(`  [${name}] year ${century * 100}: ${rule.desc}`);
  }
};
describeBranch(tree, familyName);
const walk = (node) => {
  for (const child of node.children) {
    const name = child.children.length
      ? `branch to year ${child.end * 100}`
      : leaves.find((l) => l.node === child).name;
    describeBranch(child, name);
    walk(child);
  }
};
walk(tree);
out.push('');

// cognate table
out.push('Cognate table:');
const cols = ['concept', familyName.replace('Proto-', '*proto '), ...leaves.map((l) => l.name)];
const rows = CONCEPTS.map((concept) => {
  const proto = '*' + show(lexicon.get(concept));
  const forms = leaves.map((l) => show(evolve(lexicon.get(concept), changeLog(l.path)).form));
  return [concept, proto, ...forms];
});
const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
const fmt = (r) => '  ' + r.map((cell, i) => cell.padEnd(widths[i])).join('  ');
out.push(fmt(cols));
out.push('  ' + widths.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) out.push(fmt(r));
out.push('');

// sample etymologies: show the words with the richest histories
out.push('Sample etymologies:');
const candidates = CONCEPTS.flatMap((concept) =>
  leaves.map((leaf) => ({ concept, leaf, steps: evolve(lexicon.get(concept), changeLog(leaf.path)).steps })))
  .sort((a, b) => b.steps.length - a.steps.length);
const seen = new Set();
const showcase = candidates.filter(({ concept }) => !seen.has(concept) && seen.add(concept)).slice(0, 3);
for (const { concept, leaf, steps } of showcase) {
  const final = steps[steps.length - 1];
  out.push(`  ${leaf.name} "${show(final.form)}" (${concept}) < ${familyName} *${show(steps[0].form)}`);
  for (const step of steps.slice(1)) {
    out.push(`      > ${show(step.form)}   ${step.note}`);
  }
}

console.log(out.join('\n'));
