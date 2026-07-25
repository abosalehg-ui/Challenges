// ============================================================
// UTILS — pure helpers shared by the game and the Node tests
// (browser globals; module.exports guard for node --test)
// ============================================================

// xmur3 string hash feeding a mulberry32 PRNG — deterministic per seed
function seedRandom(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  let s = (h ^ (h >>> 16)) >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleArrayWith(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shuffle each question's answers, keeping the correct index in sync
function prepareQuestions(list, rng) {
  return list.map(q => {
    const correctAnswer = q.a[q.c];
    const shuffledAnswers = shuffleArrayWith(q.a, rng);
    return { ...q, a: shuffledAnswers, c: shuffledAnswers.indexOf(correctAnswer) };
  });
}

// Pick `count` questions from `pool`, balanced across categories.
// opts.category: restrict to one category ('all' = no restriction).
// opts.diffPools: difficulty filters from strict to widest, e.g.
// [[2,3],[1,2,3]] — used to top up when the strict pool runs short.
// opts.exclude: a Set of question ids (q._id) to deprioritise so recently
//   played questions only reappear once fresher ones run out.
// Never returns undefined slots; clamps to what is available.
function pickQuestions(pool, count, opts = {}, rng = Math.random) {
  const { category = 'all', diffPools = [null], exclude = new Set() } = opts;

  const base = category === 'all' ? pool : pool.filter(q => q.cat === category);
  const first = diffPools[0];
  let filtered = first ? base.filter(q => first.includes(q.d)) : base;

  // Shuffle a bucket, floating not-recently-seen questions to the front so
  // exclude only bites when the fresh supply is exhausted. With an empty
  // exclude this is a plain shuffle (identical rng consumption as before).
  const prioritize = (arr) => {
    if (!exclude.size) return shuffleArrayWith(arr, rng);
    const fresh = arr.filter(q => !exclude.has(q._id));
    const stale = arr.filter(q => exclude.has(q._id));
    return shuffleArrayWith(fresh, rng).concat(shuffleArrayWith(stale, rng));
  };

  // Balanced pick per category
  const cats = {};
  filtered.forEach(q => {
    if (!cats[q.cat]) cats[q.cat] = [];
    cats[q.cat].push(q);
  });
  // Shuffle the category order so the remainder slot isn't always handed to
  // whichever category happens to sort first in the bank.
  const catKeys = shuffleArrayWith(Object.keys(cats), rng);
  if (!catKeys.length) return [];
  const perCat = Math.floor(count / catKeys.length);
  const remainder = count % catKeys.length;

  let selected = [];
  catKeys.forEach((cat, i) => {
    const c = perCat + (i < remainder ? 1 : 0);
    selected = selected.concat(prioritize(cats[cat]).slice(0, c));
  });

  // Top up: first from the rest of the same pool, then wider pools
  if (selected.length < count) {
    const chosen = new Set(selected);
    const topUp = (candidates) => {
      const rest = prioritize(candidates.filter(q => !chosen.has(q)));
      for (const q of rest) {
        if (selected.length >= count) break;
        selected.push(q);
        chosen.add(q);
      }
    };
    topUp(filtered);
    for (const diffs of diffPools.slice(1)) {
      if (selected.length >= count) break;
      topUp(diffs ? base.filter(q => diffs.includes(q.d)) : base);
    }
  }

  return shuffleArrayWith(selected, rng);
}

// Build a survival queue whose difficulty genuinely ramps: the first few
// questions are easy, then easy/medium, then medium/hard, then hard —
// instead of serving every easy question before the first medium one.
function buildSurvivalQueue(pool, rng) {
  const bands = { 1: [], 2: [], 3: [] };
  pool.forEach(q => { if (bands[q.d]) bands[q.d].push(q); });
  for (const d of [1, 2, 3]) bands[d] = shuffleArrayWith(bands[d], rng);
  const idx = { 1: 0, 2: 0, 3: 0 };
  const remaining = (d) => idx[d] < bands[d].length;

  // Allowed difficulty band by position (0-based) in the queue.
  const allowedAt = (i) => {
    if (i < 5) return [1];
    if (i < 15) return [1, 2];
    if (i < 25) return [2, 3];
    return [3];
  };

  const queue = [];
  for (let i = 0; i < pool.length; i++) {
    let avail = allowedAt(i).filter(remaining);
    // Once a band is drained, fall back to whatever is left (hardest first).
    if (!avail.length) avail = [3, 2, 1].filter(remaining);
    if (!avail.length) break;
    const d = avail[Math.floor(rng() * avail.length)];
    queue.push(bands[d][idx[d]++]);
  }
  return queue;
}

// ---- Scoring (pure, so the balance is unit-testable) ----
// STREAK_CAP is the fix for a runaway curve: the bonus used to grow linearly
// without limit, so by question 20 a streak was worth 200 against a base of
// 100 and two thirds of a score came from round length rather than skill.
const SCORING = {
  BASE: 100,
  SPEED_WINDOW: 5,   // seconds within which a speed bonus is earned
  SPEED_MAX: 50,     // maximum speed bonus
  STREAK_MIN: 3,     // streak length at which the bonus starts
  STREAK_STEP: 10,
  STREAK_CAP: 10     // streak length beyond which the bonus stops growing
};

// `streak` is the streak *including* this answer. Returns the points awarded
// and the raw streak bonus (for the on-screen popup).
function scoreAnswer(timeTaken, streak, multiplier) {
  let points = SCORING.BASE;
  if (timeTaken < SCORING.SPEED_WINDOW) {
    points += Math.round((SCORING.SPEED_WINDOW - timeTaken) / SCORING.SPEED_WINDOW * SCORING.SPEED_MAX);
  }
  let streakBonus = 0;
  if (streak >= SCORING.STREAK_MIN) {
    streakBonus = Math.min(streak, SCORING.STREAK_CAP) * SCORING.STREAK_STEP;
    points += streakBonus;
  }
  return { points: Math.round(points * multiplier), streakBonus };
}

// Which high-score board a round belongs to. Difficulty levels used to share a
// single global record, which made "hard" strictly dominant (a perfect hard
// round scored ~4.8x a perfect easy one) and left easy and medium unable to
// ever register a personal best. One board per level fixes that.
function boardKey(mode, difficulty) {
  if (mode === 'survival' || mode === 'timeattack' || mode === 'daily') return mode;
  return `${mode}:${difficulty}`;
}

// Stable short id derived from question text — used to track recently seen
// questions without editing the bank. djb2 hash, base36.
function questionId(q) {
  const s = String((q && q.q) || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---- Daily-challenge streak math (pure, so it can be unit tested) ----
// Format a Date as the local 'YYYY-MM-DD' key used for the daily challenge.
function dailyKeyFor(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// The daily key for the day before the given 'YYYY-MM-DD' key.
function dayBeforeKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return dailyKeyFor(dt);
}

// New streak value after completing today's challenge: continue when the
// last completion was yesterday, otherwise restart at 1.
function nextDailyStreak(lastKey, prevStreak, todayKey) {
  if (lastKey === todayKey) return prevStreak || 1;
  if (lastKey === dayBeforeKey(todayKey)) return (prevStreak || 0) + 1;
  return 1;
}

// Streak to display: a gap of more than one day means the streak is broken.
function displayedDailyStreak(lastKey, storedStreak, todayKey) {
  if (!lastKey) return 0;
  if (lastKey === todayKey || lastKey === dayBeforeKey(todayKey)) return storedStreak || 0;
  return 0;
}

if (typeof module !== 'undefined') {
  module.exports = {
    seedRandom, shuffleArrayWith, prepareQuestions, pickQuestions,
    buildSurvivalQueue, questionId,
    dailyKeyFor, dayBeforeKey, nextDailyStreak, displayedDailyStreak,
    SCORING, scoreAnswer, boardKey
  };
}
