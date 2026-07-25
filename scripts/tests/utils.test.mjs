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
const {
  seedRandom, shuffleArrayWith, prepareQuestions, pickQuestions,
  buildSurvivalQueue, questionId,
  dailyKeyFor, dayBeforeKey, nextDailyStreak, displayedDailyStreak,
  SCORING, scoreAnswer, boardKey
} = require(join(root, 'js', 'utils.js'));

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

test('pickQuestions avoids excluded questions until fresh supply runs out', () => {
  const withId = bank.map(q => ({ ...q, _id: questionId(q) }));
  // Exclude a chunk larger than a round; a full round should avoid all of them
  const excludeIds = withId.slice(0, 40).map(q => q._id);
  const picked = pickQuestions(withId, 15, { diffPools: DIFF_POOLS.medium, exclude: new Set(excludeIds) }, seedRandom('excl'));
  assert.equal(picked.length, 15);
  assert.ok(picked.every(q => !excludeIds.includes(q._id)), 'a recently-seen question leaked into the round');

  // When exclude covers nearly everything, it clamps rather than starving
  const nearlyAll = new Set(withId.slice(0, withId.length - 5).map(q => q._id));
  const forced = pickQuestions(withId, 15, { diffPools: DIFF_POOLS.medium, exclude: nearlyAll }, seedRandom('excl2'));
  assert.equal(forced.length, 15);
  assert.equal(new Set(forced).size, forced.length, 'exclude fallback produced duplicates');
});

test('buildSurvivalQueue ramps difficulty and never repeats a question', () => {
  const q = buildSurvivalQueue(bank, seedRandom('surv'));
  assert.equal(q.length, bank.length, 'queue should hold the whole bank');
  assert.equal(new Set(q).size, q.length, 'queue contains duplicates');
  // First five are easy; hard questions never appear before position 15
  assert.ok(q.slice(0, 5).every(x => x.d === 1), 'opening questions must be easy');
  assert.ok(q.slice(0, 15).every(x => x.d <= 2), 'hard questions surfaced too early');
  // Once the ramp reaches the top it stays hard until the d3 supply drains
  // (an endless queue eventually falls back to leftover easier questions)
  assert.ok(q.slice(25, 100).every(x => x.d === 3), 'the peak of the ramp must be hard');
});

test('questionId is stable per text and differs across questions', () => {
  assert.equal(questionId({ q: 'مرحبا' }), questionId({ q: 'مرحبا' }));
  assert.notEqual(questionId({ q: 'أ' }), questionId({ q: 'ب' }));
  const ids = new Set(bank.map(questionId));
  assert.equal(ids.size, bank.length, 'question id collision within the bank');
});

test('daily streak continues across consecutive days and resets after a gap', () => {
  const today = dailyKeyFor(new Date(2026, 6, 20));
  const yesterday = dayBeforeKey(today);
  const twoDaysAgo = dayBeforeKey(yesterday);

  // First ever completion → streak 1
  assert.equal(nextDailyStreak(null, 0, today), 1);
  // Played yesterday → increment
  assert.equal(nextDailyStreak(yesterday, 4, today), 5);
  // Gap of a day → reset to 1
  assert.equal(nextDailyStreak(twoDaysAgo, 9, today), 1);

  // Display: yesterday keeps the count, an older gap shows a broken streak
  assert.equal(displayedDailyStreak(yesterday, 4, today), 4);
  assert.equal(displayedDailyStreak(today, 4, today), 4);
  assert.equal(displayedDailyStreak(twoDaysAgo, 9, today), 0);
  assert.equal(displayedDailyStreak(null, 0, today), 0);
});

test('dayBeforeKey crosses month and year boundaries', () => {
  assert.equal(dayBeforeKey('2026-03-01'), '2026-02-28');
  assert.equal(dayBeforeKey('2026-01-01'), '2025-12-31');
  assert.equal(dayBeforeKey('2024-03-01'), '2024-02-29'); // leap year
});

// ---- scoring & high-score boards ----

test('scoreAnswer awards base, speed and streak components', () => {
  // Slow answer, no streak: base only
  assert.deepEqual(scoreAnswer(9, 1, 1), { points: 100, streakBonus: 0 });
  // Instant answer earns the full speed bonus
  assert.equal(scoreAnswer(0, 1, 1).points, SCORING.BASE + SCORING.SPEED_MAX);
  // The streak bonus starts at STREAK_MIN, not before
  assert.equal(scoreAnswer(9, SCORING.STREAK_MIN - 1, 1).streakBonus, 0);
  assert.equal(scoreAnswer(9, SCORING.STREAK_MIN, 1).streakBonus, SCORING.STREAK_MIN * SCORING.STREAK_STEP);
  // Difficulty multiplier applies to the total
  assert.equal(scoreAnswer(9, 1, 1.5).points, 150);
});

test('the streak bonus stops growing at STREAK_CAP', () => {
  const cap = SCORING.STREAK_CAP;
  assert.equal(scoreAnswer(9, cap, 1).streakBonus, cap * SCORING.STREAK_STEP);
  for (const streak of [cap + 1, cap + 10, 100]) {
    assert.equal(
      scoreAnswer(9, streak, 1).streakBonus,
      cap * SCORING.STREAK_STEP,
      `streak ${streak} kept compounding past the cap`
    );
  }
});

test('no difficulty is more than ~4.5x another on a perfect round', () => {
  // Regression guard on the balance: the uncapped streak bonus used to make a
  // perfect hard round worth 4.85x a perfect easy one on a *shared* board.
  const LEVELS = { easy: { n: 10, mult: 0.8 }, medium: { n: 15, mult: 1.0 }, hard: { n: 20, mult: 1.5 } };
  const perfect = ({ n, mult }) => {
    let total = 0;
    for (let i = 1; i <= n; i++) total += scoreAnswer(2.5, i, mult).points;
    return total;
  };
  const scores = Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, perfect(v)]));
  assert.ok(scores.easy < scores.medium && scores.medium < scores.hard, 'harder must still score higher');
  assert.ok(scores.hard / scores.easy < 4.5, `hard/easy ratio too wide: ${scores.hard / scores.easy}`);
});

test('boardKey separates difficulty levels but not arcade modes', () => {
  // Each level keeps its own record, so easy and medium can be competed for
  assert.notEqual(boardKey('classic', 'easy'), boardKey('classic', 'hard'));
  assert.equal(boardKey('classic', 'easy'), 'classic:easy');
  assert.notEqual(boardKey('classic', 'easy'), boardKey('category', 'easy'));
  // Arcade and daily rounds have no difficulty selection, so one board each
  for (const mode of ['survival', 'timeattack', 'daily']) {
    assert.equal(boardKey(mode, 'medium'), mode);
    assert.equal(boardKey(mode, 'hard'), mode);
  }
});
