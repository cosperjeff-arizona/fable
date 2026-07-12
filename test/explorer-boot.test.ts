// Boot-executes the explorer's embedded JavaScript against a stub DOM.
//
// The structural tests in test/explorer.test.ts verify the emitted HTML's
// shape but never *run* its script, so a runtime crash during rendering
// (e.g. reading `.change.description` on an M5 drift event, which has a
// flat `.note` instead — a real regression this test was written against)
// would pass every one of them while producing a visibly broken page.
// Here we extract the <script> body, evaluate it with minimal document/
// window stubs, and assert the initial render actually populated the
// panels. specs/M6.md adds a fourth event shape (`BorrowEvent`, also a flat
// `.note` — see src/contact.ts), so the "drift enabled" simulation below
// also enables contact, keeping this test a tripwire for that shape too.
import { describe, expect, it } from 'vitest';
import { generateSimulation } from '../src/history.js';
import { toJSON } from '../src/serialize.js';
import { embedDump } from '../src/explorer/template.js';

type StubElement = {
  innerHTML: string;
  textContent: string;
  addEventListener: () => void;
  classList: { add: () => void; remove: () => void };
  querySelectorAll: () => never[];
};

function makeStubDom() {
  const elements = new Map<string, StubElement>();
  const element = (id: string): StubElement => {
    let el = elements.get(id);
    if (!el) {
      el = {
        innerHTML: '',
        textContent: '',
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {} },
        querySelectorAll: () => [],
      };
      elements.set(id, el);
    }
    return el;
  };
  const document = {
    getElementById: element,
    addEventListener: () => {},
    body: { classList: { add: () => {}, remove: () => {} } },
    documentElement: {},
  };
  return { document, elements, element };
}

function extractScript(html: string): string {
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('no <script> block found in explorer HTML');
  return m[1]!;
}

describe('explorer boot', () => {
  it('the embedded script renders all panels without throwing (drift + contact enabled)', () => {
    const sim = generateSimulation({ seed: 42, driftEnabled: true, contactEnabled: true });
    const html = embedDump(toJSON(sim, { derived: true }));
    const script = extractScript(html);
    const dom = makeStubDom();

    const run = new Function('document', 'window', 'setTimeout', 'FileReader', script);
    run(dom.document, {}, () => {}, function FileReaderStub() {});

    expect(dom.element('family-name').textContent).toBe(sim.familyName);
    expect(dom.element('tree').innerHTML).toContain('leaf-btn');
    // dictionary rendered with real content for the initially selected leaf
    expect(dom.element('dict-list').innerHTML).toContain('water');
    expect(dom.element('dict-list').innerHTML).toContain('dict-row');
    // branch history rendered, including at least one entry
    expect(dom.element('branch-history').innerHTML).toContain('year');
    expect(dom.element('etymology').innerHTML.length).toBeGreaterThan(0);

    // specs/M7.md: the dictionary shows this leaf's own per-leaf spelling
    // (not just the neutral phonemic romanization) — a real tripwire for the
    // explorer regressing to `entry.romanized` alone.
    const dump = JSON.parse(JSON.stringify(toJSON(sim, { derived: true })));
    const firstLeaf = dump.derived.leaves[0];
    expect(firstLeaf.dictionary.length).toBeGreaterThan(0);
    for (const entry of firstLeaf.dictionary) {
      expect(typeof entry.spelled).toBe('string');
    }
    const spelledEntry = firstLeaf.dictionary.find((e: { spelled: string; romanized: string }) => e.spelled.length > 0);
    expect(spelledEntry).toBeDefined();
    expect(dom.element('dict-list').innerHTML).toContain(spelledEntry.spelled);
  });

  it('boots with drift disabled too (v1-era event stream)', () => {
    const sim = generateSimulation({ seed: 1 });
    const html = embedDump(toJSON(sim, { derived: true }));
    const dom = makeStubDom();
    const run = new Function('document', 'window', 'setTimeout', 'FileReader', extractScript(html));
    run(dom.document, {}, () => {}, function FileReaderStub() {});
    expect(dom.element('dict-list').innerHTML).toContain('dict-row');
  });

  // specs/M7.md's "Output nits": drift/taboo notes (and paradigm-collapse
  // notes) bake in their own "c. year N", which used to duplicate the
  // separate "year N" column every branch-history line already shows.
  // Checked by booting several seeds and asserting the substring "c. year"
  // never survives into the rendered branch-history panel (for the
  // initially-selected leaf) — a real tripwire for the year-stripping regex
  // regressing (this caught a real bug during implementation: a single
  // backslash inside this file's giant template-literal <script> silently
  // vanishes before the regex is ever parsed as JavaScript, since the outer
  // string's own escape processing consumes it first).
  it.each([1, 2, 3, 5, 8, 13, 21, 42])('no branch-history line duplicates the year (seed %i)', (seed) => {
    const sim = generateSimulation({ seed, driftEnabled: true, contactEnabled: true });
    const html = embedDump(toJSON(sim, { derived: true }));
    const dom = makeStubDom();
    const run = new Function('document', 'window', 'setTimeout', 'FileReader', extractScript(html));
    run(dom.document, {}, () => {}, function FileReaderStub() {});
    const historyHtml = dom.element('branch-history').innerHTML;
    expect(historyHtml.length, `seed ${seed}: expected a non-empty branch history`).toBeGreaterThan(0);
    expect(historyHtml, `seed ${seed}`).not.toContain('c. year');
  });
});
