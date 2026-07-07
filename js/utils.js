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
// Never returns undefined slots; clamps to what is available.
function pickQuestions(pool, count, opts = {}, rng = Math.random) {
  const { category = 'all', diffPools = [null] } = opts;

  const base = category === 'all' ? pool : pool.filter(q => q.cat === category);
  const first = diffPools[0];
  let filtered = first ? base.filter(q => first.includes(q.d)) : base;

  // Balanced pick per category
  const cats = {};
  filtered.forEach(q => {
    if (!cats[q.cat]) cats[q.cat] = [];
    cats[q.cat].push(q);
  });
  const catKeys = Object.keys(cats);
  if (!catKeys.length) return [];
  const perCat = Math.floor(count / catKeys.length);
  const remainder = count % catKeys.length;

  let selected = [];
  catKeys.forEach((cat, i) => {
    const c = perCat + (i < remainder ? 1 : 0);
    selected = selected.concat(shuffleArrayWith(cats[cat], rng).slice(0, c));
  });

  // Top up: first from the rest of the same pool, then wider pools
  if (selected.length < count) {
    const chosen = new Set(selected);
    const topUp = (candidates) => {
      const rest = shuffleArrayWith(candidates.filter(q => !chosen.has(q)), rng);
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

if (typeof module !== 'undefined') {
  module.exports = { seedRandom, shuffleArrayWith, prepareQuestions, pickQuestions };
}
