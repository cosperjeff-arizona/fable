#!/usr/bin/env node
// Tiny demo: prints a generated inventory and 30 sample lexicon entries, so
// a human can eyeball quality. Usage: npm run demo -- --seed 42

import { makeStreams } from '../src/prng.js';
import { generateInventory, symbolFor, type Vowel } from '../src/phonology.js';
import { CONCEPTS } from '../src/concepts.js';
import { generateLexicon } from '../src/lexicon.js';
import { romanize } from '../src/romanize.js';

function parseSeed(argv: string[]): number {
  const idx = argv.indexOf('--seed');
  if (idx >= 0 && argv[idx + 1] !== undefined) {
    const n = Number(argv[idx + 1]);
    if (!Number.isNaN(n)) return n;
  }
  return 42;
}

const seed = parseSeed(process.argv.slice(2));
const streams = makeStreams(seed);
const inventory = generateInventory(streams.phonology);
const lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);

const lines: string[] = [];
lines.push(`ETYMON demo — seed ${seed}`);
lines.push('');

lines.push(`Consonants (${inventory.consonants.length}): ${inventory.consonants.map(symbolFor).join(' ')}`);
const vowelQualityKey = (v: Vowel) => `${v.height}:${v.backness}:${v.rounded}:${v.nasal}`;
const seenQualities = new Set<string>();
const vowelSymbols: string[] = [];
for (const v of inventory.vowels) {
  const key = vowelQualityKey(v);
  if (seenQualities.has(key)) continue;
  seenQualities.add(key);
  vowelSymbols.push(symbolFor(v));
}
const hasLength = inventory.vowels.some((v) => v.long);
lines.push(`Vowels (${vowelSymbols.length}${hasLength ? ', length contrast' : ''}): ${vowelSymbols.join(' ')}`);
lines.push(
  `Phonotactics: maxOnset=${inventory.phonotactics.maxOnset}, ` +
    `codas=[${inventory.phonotactics.codas.map(symbolFor).join(' ')}], ` +
    `allowFinalVowel=${inventory.phonotactics.allowFinalVowel}`,
);
lines.push('');

lines.push(`Affixes (${lexicon.affixes.length}):`);
for (const affix of lexicon.affixes) {
  lines.push(
    `  ${affix.kind.padEnd(13)} ${affix.role.padEnd(14)} ${affix.slot.padEnd(7)} -${affix.form
      .map(symbolFor)
      .join('')}`,
  );
}
lines.push('');

lines.push('Sample entries (30, spread across domains):');
const domains: string[] = [];
for (const c of CONCEPTS) if (!domains.includes(c.domain)) domains.push(c.domain);
const perDomain = 3;
const sample = domains.flatMap((d) => CONCEPTS.filter((c) => c.domain === d).slice(0, perDomain));
for (const concept of sample) {
  const lexeme = lexicon.lexemes.get(concept.id);
  if (!lexeme) {
    lines.push(`  ${concept.id.padEnd(14)} <missing>`);
    continue;
  }
  const originNote = lexeme.origin === 'root' ? '' : ` (${lexeme.origin}: ${lexeme.parts?.join(' + ')})`;
  lines.push(`  ${concept.id.padEnd(14)} ${romanize(lexeme.word)}${originNote}`);
}

console.log(lines.join('\n'));
