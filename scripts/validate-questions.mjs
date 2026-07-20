#!/usr/bin/env node
// ============================================================
// Question-bank validator — zero dependencies.
// Errors (exit 1): invalid JSON, schema violations, duplicate
// answers within a question, duplicate questions bank-wide.
// Warnings: missing explanation, category×difficulty counts below
// what the game modes need (prints a distribution table).
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'data', 'questions.json');

// Per-category targets so every mode can fill a full round from a
// single category (hard needs 20 of d2-3; easy needs 10 of d1)
const TARGETS = { 1: 14, 2: 28, 3: 18 };

let errors = 0;
let warnings = 0;
const err = (msg) => { errors++; console.error(`❌ ${msg}`); };
const warn = (msg) => { warnings++; console.warn(`⚠️  ${msg}`); };

// Normalize Arabic text for duplicate detection: strip tashkeel,
// tatweel, punctuation and whitespace differences
const normalize = (s) => String(s)
  .replace(/[ً-ٰٟـ]/g, '')
  .replace(/[؟?!،,.:؛;()«»"'\-]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

let data;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  err(`invalid JSON in ${file}: ${e.message}`);
  process.exit(1);
}

const categories = Object.keys(data.categories || {});
if (!categories.length) err('missing "categories" map');
const questions = data.questions;
if (!Array.isArray(questions)) {
  err('missing "questions" array');
  process.exit(1);
}

const seen = new Map();
questions.forEach((q, i) => {
  const where = `question #${i + 1}${q && q.q ? ` («${String(q.q).slice(0, 40)}…»)` : ''}`;
  if (!q || typeof q !== 'object') return err(`${where}: not an object`);
  if (typeof q.q !== 'string' || !q.q.trim()) err(`${where}: "q" must be a non-empty string`);
  if (!categories.includes(q.cat)) err(`${where}: unknown category "${q.cat}"`);
  if (![1, 2, 3].includes(q.d)) err(`${where}: "d" must be 1, 2 or 3 (got ${q.d})`);
  if (!Array.isArray(q.a) || q.a.length !== 4) {
    err(`${where}: "a" must be an array of exactly 4 answers`);
  } else {
    if (q.a.some(a => typeof a !== 'string' || !a.trim())) err(`${where}: answers must be non-empty strings`);
    const normAnswers = q.a.map(normalize);
    if (new Set(normAnswers).size !== 4) err(`${where}: duplicate answers within the question`);
  }
  // Editorial convention: the correct answer is stored first (c === 0);
  // the game shuffles answers at runtime.
  if (q.c !== 0) err(`${where}: "c" must be 0 — put the correct answer first (got ${q.c})`);
  if (typeof q.e !== 'string' || !q.e.trim()) warn(`${where}: missing explanation "e"`);

  // Question text is rendered as textContent; still reject raw HTML angle
  // brackets so authored content never depends on escaping behaviour.
  const fields = [q.q, ...(Array.isArray(q.a) ? q.a : []), q.e].filter(v => typeof v === 'string');
  if (fields.some(v => /[<>]/.test(v))) err(`${where}: "<" or ">" is not allowed in question text/answers/explanation`);

  const key = normalize(q.q || '');
  if (key) {
    if (seen.has(key)) err(`${where}: duplicate of question #${seen.get(key) + 1}`);
    else seen.set(key, i);
  }
});

// Distribution table + coverage warnings
const dist = {};
categories.forEach(c => { dist[c] = { 1: 0, 2: 0, 3: 0 }; });
questions.forEach(q => { if (dist[q.cat] && dist[q.cat][q.d] !== undefined) dist[q.cat][q.d]++; });

console.log('\nDistribution (target per category: d1 ≥ 14, d2 ≥ 28, d3 ≥ 18):');
console.log('category      |  d1 |  d2 |  d3 | total');
console.log('--------------|-----|-----|-----|------');
for (const c of categories) {
  const d = dist[c];
  const total = d[1] + d[2] + d[3];
  console.log(`${c.padEnd(13)} | ${String(d[1]).padStart(3)} | ${String(d[2]).padStart(3)} | ${String(d[3]).padStart(3)} | ${String(total).padStart(4)}`);
  for (const lvl of [1, 2, 3]) {
    if (d[lvl] < TARGETS[lvl]) warn(`${c}: only ${d[lvl]} questions at difficulty ${lvl} (target ≥ ${TARGETS[lvl]})`);
  }
}
console.log(`\ntotal questions: ${questions.length}`);

if (errors) {
  console.error(`\n${errors} error(s), ${warnings} warning(s)`);
  process.exit(1);
}
console.log(`✅ questions.json valid — ${warnings} warning(s)`);
