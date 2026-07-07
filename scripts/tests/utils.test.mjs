// node --test — unit tests for js/utils.js (browser-global file
// loaded via createRequire thanks to its module.exports guard)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { seedRandom, shuffleArrayWith, prepareQuestions, pickQuestions } = require(join(root, 'js', 'utils.js'));

const bank = JSON.parse(readFileSync(join(root, 'data', 'questions.json'), 'utf8')).questions;
const DIFF_POOLS = {
  easy:   [[1], [1, 2], [1, 2, 3]],
  medium: [[1, 2], [1, 2, 3]],
  hard:   [[2, 3], [1, 2, 3]]
};

test('seedRandom is deterministic per seed and varies across seeds', () => {
  const a = seedRandom('2026-07-07');
  const b = seedRandom('2026-07-07');
  const c = seedRandom('2026-07-08');
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  const seqC = Array.from({ length: 20 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  assert.ok(seqA.every(v => v >= 0 && v < 1));
});

test('shuffleArrayWith permutes without loss and leaves input intact', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = shuffleArrayWith(input, seedRandom('x'));
  assert.deepEqual([...out].sort((a, b) => a - b), input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('prepareQuestions keeps the correct answer under the new index', () => {
  const rng = seedRandom('shuffle');
  const prepared = prepareQuestions(bank, rng);
  assert.equal(prepared.length, bank.length);
  prepared.forEach((q, i) => {
    assert.equal(q.a[q.c], bank[i].a[bank[i].c]);
    assert.equal(q.a.length, 4);
  });
});

test('pickQuestions fills every mode-size round with no undefined slots', () => {
  for (const [diff, pools] of Object.entries(DIFF_POOLS)) {
    const count = { easy: 10, medium: 15, hard: 20 }[diff];
    const picked = pickQuestions(bank, count, { diffPools: pools }, seedRandom(diff));
    assert.equal(picked.length, count, `${diff} round short: ${picked.length}/${count}`);
    assert.ok(picked.every(Boolean));
    assert.equal(new Set(picked).size, picked.length, `${diff} round has duplicates`);
  }
});

test('pickQuestions respects a single-category filter and widens difficulty to fill', () => {
  const cats = [...new Set(bank.map(q => q.cat))];
  for (const cat of cats) {
    const picked = pickQuestions(bank, 20, { category: cat, diffPools: DIFF_POOLS.hard }, seedRandom(cat));
    assert.ok(picked.every(q => q.cat === cat), `${cat}: foreign category leaked in`);
    const avail = bank.filter(q => q.cat === cat).length;
    assert.equal(picked.length, Math.min(20, avail), `${cat}: got ${picked.length}`);
  }
});

test('pickQuestions clamps to the pool instead of crashing on oversized requests', () => {
  const picked = pickQuestions(bank, 9999, { diffPools: DIFF_POOLS.easy }, seedRandom('big'));
  assert.equal(picked.length, bank.length);
  assert.equal(new Set(picked).size, picked.length);
  assert.deepEqual(pickQuestions([], 10, {}, seedRandom('empty')), []);
});
