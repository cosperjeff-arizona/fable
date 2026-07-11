// M4 acceptance tests (specs/M4.md's "Acceptance criteria" 2-4). Criterion 1
// (existing tests stay green, examples/seed42.json regenerated) is covered
// by test/history.test.ts's updated fidelity test; criterion 5 (manual
// visual review) isn't automatable.

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSimulation } from '../src/history.js';
import { leaves, formIn, trace } from '../src/query.js';
import { toJSON } from '../src/serialize.js';
import { embedDump, EXPLORER_TEMPLATE } from '../src/explorer/template.js';

const FORBIDDEN_SUBSTRINGS = ['http://', 'https://', 'fetch(', 'import('];

/** Pull the embedded dump's raw JSON text back out of an explorer HTML
 * document (the text between "var DUMP = " and the following IIFE). JSON
 * allows `\/` as an escape for `/`, so this text is valid JSON as-is —
 * `embedDump`'s `</script` escaping never needs undoing before parsing. */
function extractDumpJson(html: string): string {
  const marker = 'var DUMP = ';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('extractDumpJson: marker not found');
  const jsonStart = start + marker.length;
  const end = html.indexOf('\n(function () {', jsonStart);
  if (end === -1) throw new Error('extractDumpJson: end marker not found');
  return html.slice(jsonStart, end).replace(/;\s*$/, '');
}

describe('M4 acceptance', () => {
  // Criterion 2: derived-section fidelity.
  it('derived section matches formIn/trace for 20 (concept, leaf) pairs', () => {
    const sim = generateSimulation({ seed: 7 });
    const dump = toJSON(sim, { derived: true });
    expect(dump.derived).toBeDefined();
    const allLeaves = leaves(sim);
    const concepts = sim.lexicon.lexemes.map((l) => l.concept);
    let idx = 3;
    for (let i = 0; i < 20; i++) {
      idx = (idx + 37) % concepts.length; // deterministic spread across the ~200 concepts
      const concept = concepts[idx]!;
      const leaf = allLeaves[i % allLeaves.length]!;
      const expectedSteps = trace(sim, concept, leaf.id);
      const expectedFormRomanized = (() => {
        const proto = sim.lexicon.lexemes.find((l) => l.concept === concept)!;
        return expectedSteps.length > 0 ? expectedSteps[expectedSteps.length - 1]!.romanized : proto.word.romanized;
      })();
      // formIn must agree too (sanity: it's the same replay `trace` used).
      formIn(sim, concept, leaf.id);

      const derivedLeaf = dump.derived!.leaves.find((l) => l.branchId === leaf.id)!;
      const entry = derivedLeaf.dictionary.find((d) => d.concept === concept)!;
      expect(entry.romanized).toBe(expectedFormRomanized);
      expect(entry.trace).toEqual(
        expectedSteps.map((s) => ({ century: s.century, romanized: s.romanized, description: s.description })),
      );
    }
  });

  it('derived is omitted unless requested', () => {
    const sim = generateSimulation({ seed: 3 });
    expect(toJSON(sim).derived).toBeUndefined();
    expect(toJSON(sim, { derived: false }).derived).toBeUndefined();
  });

  // Criterion 3: `explore` emits one self-contained file.
  it('explore emits a single self-contained HTML file with the dump embedded', () => {
    const sim = generateSimulation({ seed: 42 });
    const dump = toJSON(sim, { derived: true });
    const html = embedDump(dump);

    const dir = mkdtempSync(join(tmpdir(), 'etymon-explorer-'));
    const outPath = join(dir, 'etymon-explorer.html');
    try {
      writeFileSync(outPath, html);
      const onDisk = readFileSync(outPath, 'utf8');

      // Parses as text and contains the embedded JSON.
      expect(typeof onDisk).toBe('string');
      const parsedDump = JSON.parse(extractDumpJson(onDisk));
      expect(parsedDump.familyName).toBe(sim.familyName);

      // Self-containment: no external requests of any kind.
      for (const needle of FORBIDDEN_SUBSTRINGS) {
        expect(onDisk.includes(needle), `should not contain "${needle}"`).toBe(false);
      }

      // No unreplaced placeholder.
      expect(onDisk.includes('__ETYMON_DUMP_JSON__')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the raw template also passes the self-containment check', () => {
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      expect(EXPLORER_TEMPLATE.includes(needle), `should not contain "${needle}"`).toBe(false);
    }
  });

  // Criterion 4: escaping.
  it('escapes </script>-hostile content in the embedded dump', () => {
    const hostile = {
      formatVersion: 1,
      familyName: 'Proto-</script><script>alert(1)</script>Foo',
      config: { seed: 1, centuries: 1, maxLeaves: 1, splitChance: 0, changeChance: 0 },
      inventory: {},
      lexicon: {
        lexemes: [
          {
            concept: '</script>evil',
            origin: 'root',
            parts: null,
            word: { segments: [], stress: 0, romanized: '</script>' },
          },
        ],
        affixes: [],
      },
      root: { id: 'root', start: 0, end: 1, events: [], paradigmNotes: [], children: [] },
      derived: {
        leaves: [
          {
            branchId: 'root',
            name: '</script>',
            dictionary: [{ concept: '</script>evil', romanized: '</script>', trace: [] }],
          },
        ],
      },
    };

    const html = embedDump(hostile);

    // Exactly one real </script> tag remains: the template's own closing
    // tag. Every hostile "</script" sequence from the dump was escaped.
    const closingScriptTags = html.match(/<\/script/gi) ?? [];
    expect(closingScriptTags.length).toBe(1);

    // The dump's logical content survives the round trip unchanged — the
    // escaping is purely textual, not a data transform.
    const parsed = JSON.parse(extractDumpJson(html));
    expect(parsed.familyName).toBe(hostile.familyName);
    expect(parsed.lexicon.lexemes[0].concept).toBe('</script>evil');
    expect(parsed.derived.leaves[0].name).toBe('</script>');
  });
});
