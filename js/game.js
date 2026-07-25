// ============================================================
// GAME LOGIC — main game flow, modes, achievements
// ============================================================

const audio = new AudioEngine();

// Game configuration
const DIFFICULTY = {
  easy:   { time: 20, count: 10, mult: 0.8, label: 'سهل', icon: '🟢' },
  medium: { time: 15, count: 15, mult: 1.0, label: 'متوسط', icon: '🟡' },
  hard:   { time: 10, count: 20, mult: 1.5, label: 'صعب', icon: '🔴' }
};

const MODE = {
  classic:    { label: 'كلاسيكي', icon: '🎯' },
  daily:      { label: 'تحدي اليوم', icon: '📅' },
  category:   { label: 'حسب الفئة', icon: '🗂️' },
  survival:   { label: 'البقاء', icon: '🛡️', time: 12 },
  timeattack: { label: 'ضد الساعة', icon: '⏱️', total: 120 }
};

// Arcade modes: endless question queue, no fixed round length
const isArcadeMode = (mode) => mode === 'survival' || mode === 'timeattack';

// In survival, points scale with the question's own difficulty
const SURVIVAL_MULT = { 1: 1.0, 2: 1.25, 3: 1.5 };

// Time-attack pacing. Every millisecond here is taken straight out of the
// player's 120 seconds, so the reveal is only long enough to read the result:
// the old 600ms reveal plus a 100ms advance gap burned ~24% of a round.
const TA_REVEAL_MS = 250;
const ROUND_INTRO_MS = 300;

// A round is one of these at any moment. This replaces the answered /
// advancing / roundEnded flag soup, where each flag had been added to patch a
// specific input bug and their interactions were only true by inspection.
const PHASE = {
  IDLE: 'idle',             // menus; no round in flight
  PRESENTING: 'presenting', // question rendering — input intentionally dead
  AWAITING: 'awaiting',     // the only phase that accepts an answer
  REVEALING: 'revealing',   // answer shown / explanation up
  ADVANCING: 'advancing',   // moving to the next question
  PAUSED: 'paused',
  ENDED: 'ended'
};

const ACHIEVEMENTS = [
  { id: 'first_game',     label: 'أول جولة',           desc: 'أكمل أول جولة في اللعبة',                icon: '🎮' },
  { id: 'streak_5',       label: 'سلسلة الخمسة',       desc: '5 إجابات صحيحة متتالية',                icon: '🔥' },
  { id: 'streak_10',      label: 'سلسلة العشرة',       desc: '10 إجابات صحيحة متتالية',              icon: '💥' },
  { id: 'perfect_round',  label: 'الكمال',              desc: 'أكمل جولة بدون أي خطأ',                  icon: '💎' },
  { id: 'speedster',      label: 'سريع البديهة',       desc: 'أجب على 5 أسئلة في أقل من 3 ثوانٍ',    icon: '⚡' },
  { id: 'score_1000',     label: 'الألف',               desc: 'احصل على 1000 نقطة في جولة واحدة',     icon: '🏆' },
  { id: 'score_2000',     label: 'الألفان',             desc: 'احصل على 2000 نقطة في جولة واحدة',     icon: '👑' },
  { id: 'daily_player',   label: 'لاعب يومي',           desc: 'العب التحدي اليومي 3 أيام متتالية',    icon: '📅' },
  { id: 'hard_master',    label: 'محترف الصعب',         desc: 'أكمل جولة على مستوى صعب',                icon: '🎖️' },
  { id: 'no_help',        label: 'بدون مساعدة',         desc: 'أكمل جولة دون استخدام 50:50',           icon: '🧠' },
  { id: 'category_explorer', label: 'مستكشف الفئات',    desc: 'العب جولة في كل فئة من الفئات الست',    icon: '🗂️' },
  { id: 'category_perfect',  label: 'خبير متخصص',       desc: 'جولة كاملة بلا أخطاء في وضع الفئة',     icon: '🎓' },
  { id: 'survivor_10',    label: 'صامد',                desc: '10 إجابات صحيحة في وضع البقاء',         icon: '🛡️' },
  { id: 'survivor_25',    label: 'لا يُقهر',            desc: '25 إجابة صحيحة في وضع البقاء',          icon: '⚔️' },
  { id: 'time_racer',     label: 'سباق الزمن',          desc: '12 إجابة صحيحة في وضع ضد الساعة',       icon: '⏱️' }
];

// Rebindable actions. Answer selection stays on 1-4 (and the numpad) because
// those are positional and map onto the on-screen answer numbers.
const DEFAULT_KEYS = {
  next:  'Enter',
  fifty: 'KeyH',
  mute:  'KeyM',
  pause: 'KeyP',
  exit:  'Escape'
};
const KEY_ACTIONS = [
  { id: 'next',  label: 'الانتقال للسؤال التالي' },
  { id: 'fifty', label: 'استخدام 50:50' },
  { id: 'mute',  label: 'كتم/تشغيل الصوت' },
  { id: 'pause', label: 'إيقاف مؤقت' },
  { id: 'exit',  label: 'العودة للقائمة' }
];
let keybinds = { ...DEFAULT_KEYS };
let listeningFor = null; // action id currently capturing a new key

let gameState = {
  phase: PHASE.IDLE,
  phaseBeforePause: PHASE.IDLE,
  screen: 'startScreen',
  currentQ: 0,
  score: 0,
  streak: 0,
  maxStreak: 0,
  correctCount: 0,
  totalTime: 0,
  fastAnswers: 0,
  questions: [],
  bestScore: 0,
  difficulty: 'medium',
  mode: 'classic',
  category: 'all',
  fiftyUsed: false,
  questionsCount: 15,
  timePerQuestion: 15,
  mistakes: [],
  answeredCount: 0,
  eliminated: false,
  qStartRemaining: 0,
  dailyPractice: false,
  exitArmed: false,
  exitTimer: null
};

let allQuestions = [];
let categoriesMeta = {};
// Set once the service worker is registered; lets endGame hand control to a
// pending update at a moment when swapping the cache is safe.
let releasePendingWorker = null;

// ============================================================
// CLOCK — one rAF-driven countdown, used for both the per-question
// timer and the time-attack round timer.
// ============================================================
// setInterval(50ms) meant ~20 style writes a second whether or not anything
// changed, and it could not be paused. rAF ties updates to actual frames and
// gives pause/resume for free.
function createClock() {
  let raf = 0, endsAt = 0, total = 0, left = 0, running = false;
  let onTick = null, onDone = null;

  function frame() {
    raf = 0;
    if (!running) return;
    left = Math.max(0, (endsAt - performance.now()) / 1000);
    if (onTick) onTick(left, total);
    if (left <= 0) {
      running = false;
      const done = onDone;
      onDone = null;
      if (done) done();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    start(seconds, tick, done) {
      this.stop();
      total = seconds; left = seconds; onTick = tick; onDone = done;
      endsAt = performance.now() + seconds * 1000;
      running = true;
      if (onTick) onTick(left, total);
      raf = requestAnimationFrame(frame);
    },
    pause() {
      if (!running) return;
      left = Math.max(0, (endsAt - performance.now()) / 1000);
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    resume() {
      if (running || left <= 0 || !total) return;
      endsAt = performance.now() + left * 1000;
      running = true;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0; total = 0; left = 0; onTick = null; onDone = null;
    },
    get left() { return left; },
    get running() { return running; }
  };
}

const questionClock = createClock();
const roundClock = createClock();

// ============================================================
// LOAD QUESTIONS
// ============================================================
async function loadQuestions(attempt = 0) {
  try {
    const res = await fetch('data/questions.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.questions) || !data.questions.length) {
      throw new Error('empty question bank');
    }
    allQuestions = data.questions;
    categoriesMeta = data.categories || {};
    allQuestions.forEach(q => { q._id = questionId(q); });
    return true;
  } catch (e) {
    console.error('Failed to load questions:', e);
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      return loadQuestions(attempt + 1);
    }
    showToast('❌ تعذّر تحميل الأسئلة — تحقق من الاتصال', 'wrong');
    return false;
  }
}

// seedRandom / shuffleArrayWith / prepareQuestions / pickQuestions / scoreAnswer
// / boardKey live in js/utils.js
const shuffleArray = (arr) => shuffleArrayWith(arr, Math.random);

// ============================================================
// QUESTION SELECTION
// ============================================================
// Difficulty pools, from strict to widest — used to top up when the
// strict pool can't fill a full round
const DIFF_POOLS = {
  easy:   [[1], [1, 2], [1, 2, 3]],
  medium: [[1, 2], [1, 2, 3]],
  hard:   [[2, 3], [1, 2, 3]]
};

function selectQuestions() {
  // Arcade queues: survival ramps difficulty by position,
  // time-attack draws from the whole shuffled bank
  if (gameState.mode === 'survival') {
    return prepareQuestions(buildSurvivalQueue(allQuestions, Math.random), Math.random);
  }
  if (gameState.mode === 'timeattack') {
    return prepareQuestions(shuffleArray(allQuestions), Math.random);
  }

  if (gameState.mode === 'daily') {
    const seeded = seedRandom(Storage.getDailyKey());
    const picked = pickQuestions(allQuestions, 10, {}, seeded);
    // A practice replay draws the same ten questions but reshuffles them, so
    // it re-tests the player instead of replaying a memorised order.
    return gameState.dailyPractice
      ? prepareQuestions(shuffleArray(picked), Math.random)
      : prepareQuestions(picked, seeded);
  }

  // Classic / category: deprioritise recently played questions, then record
  // what was drawn so the next round pulls fresh material.
  const opts = {
    category: gameState.category,
    diffPools: DIFF_POOLS[gameState.difficulty],
    exclude: new Set(Storage.getRecent())
  };
  const picked = prepareQuestions(pickQuestions(allQuestions, gameState.questionsCount, opts), Math.random);
  Storage.pushRecent(picked.map(q => q._id));
  return picked;
}

// Arcade rounds never run out: extend the queue with fresh, correctly-paced
// material (survival keeps ramping; time-attack reshuffles the bank)
function ensureQueue() {
  if (!isArcadeMode(gameState.mode)) return;
  if (gameState.currentQ >= gameState.questions.length) {
    const extra = gameState.mode === 'survival'
      ? buildSurvivalQueue(allQuestions, Math.random)
      : shuffleArray(allQuestions);
    gameState.questions = gameState.questions.concat(prepareQuestions(extra, Math.random));
    gameState.questionsCount = gameState.questions.length;
  }
}

function isRoundOver() {
  if (gameState.mode === 'survival') return gameState.eliminated;
  if (gameState.mode === 'timeattack') return roundClock.left <= 0 && !roundClock.running;
  return gameState.currentQ >= gameState.questionsCount;
}

// ============================================================
// UI HELPERS
// ============================================================
function $(id) { return document.getElementById(id); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $(id);
  el.classList.add('active');
  gameState.screen = id;
  // Drives the pause button's visibility and lets the scene drop to an idle
  // frame rate while the player is sitting in a menu.
  document.body.dataset.screen = id;
  if (typeof Scene !== 'undefined' && Scene.setActive) Scene.setActive(id === 'gameScreen');
  // Without this the focus ring stays on the button that just disappeared,
  // stranding keyboard users and telling a screen reader nothing changed.
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

function showToast(text, type = 'success') {
  const toast = $('shareToast');
  toast.textContent = text;
  toast.dataset.type = type;
  toast.classList.add('visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('visible'), 2500);
}

// The OS preference OR the in-app toggle — the setting exists so a player can
// quiet the motion without changing a system-wide preference.
function motionReduced() {
  const os = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return Storage.isReducedMotion() || !!os;
}

// ============================================================
// THEME / MOTION / AUDIO SETTINGS
// ============================================================
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  Storage.setTheme(theme);
  if (typeof Scene !== 'undefined' && Scene.setTheme) Scene.setTheme(theme);
}

function applyReducedMotion(on) {
  Storage.setReducedMotion(on);
  if (on) document.body.dataset.reducedMotion = '1';
  else delete document.body.dataset.reducedMotion;
  if (typeof Scene !== 'undefined' && Scene.setReducedMotion) Scene.setReducedMotion(on);
  const box = $('settingMotion');
  if (box) box.checked = !!on;
}

function applyVolume(vol) {
  Storage.setVolume(vol);
  audio.setVolume(vol / 100);
  const slider = $('settingVolume');
  if (slider && Number(slider.value) !== vol) slider.value = vol;
  const label = $('volumeValue');
  if (label) label.textContent = `${vol}%`;
}

function applyMute(muted) {
  audio.setMuted(muted);
  Storage.setMuted(muted);
  const btn = $('btnMute');
  if (btn) {
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-label', muted ? 'تشغيل الصوت' : 'كتم الصوت');
    btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }
  // The settings toggle is a second view of the same state; without this it
  // keeps showing the old value after the M shortcut is used.
  const box = $('settingMute');
  if (box) box.checked = !!muted;
}

function toggleMute() {
  audio.play('click');
  applyMute(!Storage.isMuted());
}

// ============================================================
// MODE/DIFFICULTY SELECTION
// ============================================================
async function chooseMode(mode) {
  audio.play('click');
  // Recover from a failed initial load before committing to a round
  if (!allQuestions.length) {
    showToast('⏳ جارٍ تحميل الأسئلة...', 'wrong');
    if (!(await loadQuestions())) return;
  }
  gameState.mode = mode;
  gameState.category = 'all';
  gameState.dailyPractice = false;

  if (mode === 'daily') {
    // Today's scored attempt is one-shot by design (the streak depends on it),
    // but being locked out entirely turns a bad round into a dead end. Replays
    // are allowed as practice and simply do not record anything.
    if (Storage.isDailyDone()) {
      gameState.dailyPractice = true;
      showToast(`🎯 جولة تدريب — نتيجة اليوم المسجّلة: ${Storage.getDailyScore()}`, 'success');
    }
    gameState.difficulty = 'medium';
    startGameNow();
  } else if (mode === 'category') {
    renderCategoryScreen();
    showScreen('categoryScreen');
  } else if (mode === 'survival') {
    gameState.difficulty = 'medium';
    gameState.timePerQuestion = MODE.survival.time;
    startGameNow();
  } else if (mode === 'timeattack') {
    gameState.difficulty = 'medium';
    startGameNow();
  } else {
    renderDifficultyScreen();
    showScreen('difficultyScreen');
  }
}

function renderCategoryScreen() {
  const grid = $('categoryGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const entries = Object.entries(categoriesMeta).concat([['all', { icon: '🌐', label: 'كل الفئات' }]]);
  entries.forEach(([key, meta]) => {
    const btn = document.createElement('button');
    btn.className = 'difficulty-btn';
    const icon = document.createElement('div');
    icon.className = 'difficulty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = meta.icon;
    const info = document.createElement('div');
    info.className = 'difficulty-info';
    const label = document.createElement('div');
    label.className = 'difficulty-label';
    label.textContent = meta.label;
    info.appendChild(label);
    btn.append(icon, info);
    btn.onclick = () => chooseCategory(key);
    grid.appendChild(btn);
  });
}

// Each level now keeps its own record, so surface it where the level is picked
// — that is the target an easy or medium player is actually playing against.
function renderDifficultyScreen() {
  ['easy', 'medium', 'hard'].forEach(diff => {
    const el = $(`record-${diff}`);
    if (!el) return;
    const best = Storage.getBoardBest(boardKey(gameState.mode, diff));
    el.textContent = best ? `🏅 أفضل نتيجة لك: ${best}` : '';
  });
}

function chooseCategory(cat) {
  audio.play('click');
  gameState.category = cat;
  renderDifficultyScreen();
  showScreen('difficultyScreen');
}

function chooseDifficulty(diff) {
  audio.play('click');
  gameState.difficulty = diff;
  gameState.questionsCount = DIFFICULTY[diff].count;
  gameState.timePerQuestion = DIFFICULTY[diff].time;
  startGameNow();
}

// ============================================================
// GAME FLOW
// ============================================================
function startGameNow() {
  audio.init();
  applyMute(Storage.isMuted());
  audio.play('start');

  questionClock.stop();
  roundClock.stop();

  gameState.currentQ = 0;
  gameState.phase = PHASE.PRESENTING;
  gameState.score = 0;
  gameState.streak = 0;
  gameState.maxStreak = 0;
  gameState.correctCount = 0;
  gameState.totalTime = 0;
  gameState.fastAnswers = 0;
  gameState.fiftyUsed = false;
  gameState.mistakes = [];
  gameState.answeredCount = 0;
  gameState.eliminated = false;
  gameState.exitArmed = false;
  gameState.questions = selectQuestions();

  // Clamp to what was actually selected — the pool may not fill the round
  gameState.questionsCount = gameState.questions.length;
  if (gameState.mode === 'daily') gameState.timePerQuestion = 15;
  if (gameState.mode === 'survival') gameState.timePerQuestion = MODE.survival.time;

  if (!gameState.questionsCount) {
    showToast('❌ لا توجد أسئلة متاحة', 'wrong');
    gameState.phase = PHASE.IDLE;
    showScreen('startScreen');
    return;
  }

  $('scoreValue').textContent = '0';
  $('streakDisplay').classList.remove('visible');
  hidePause();

  const fiftyBtn = $('btnFifty');
  fiftyBtn.style.display = 'flex';
  fiftyBtn.classList.remove('used');

  // Mode indicator
  const modeInd = $('modeIndicator');
  if (modeInd) {
    const m = MODE[gameState.mode];
    const d = DIFFICULTY[gameState.difficulty];
    const cc = categoriesMeta[gameState.category];
    if (gameState.mode === 'daily') {
      modeInd.textContent = gameState.dailyPractice ? `${m.icon} ${m.label} • تدريب` : `${m.icon} ${m.label}`;
    } else if (isArcadeMode(gameState.mode)) {
      modeInd.textContent = `${m.icon} ${m.label}`;
    } else if (gameState.mode === 'category' && cc) {
      modeInd.textContent = `${cc.icon} ${cc.label} • ${d.icon}`;
    } else {
      modeInd.textContent = `${d.icon} ${d.label}`;
    }
  }

  // Show the timer full before the first question so the bar doesn't pop
  const total = gameState.mode === 'timeattack' ? MODE.timeattack.total : gameState.timePerQuestion;
  lastTimerPhase = ''; lastTimerSecond = -1;
  $('timerBar').classList.remove('warning', 'danger');
  $('timerBar').style.setProperty('transition', 'none', 'important');
  $('timerBar').style.width = '100%';
  $('timerText').textContent = total;

  showScreen('gameScreen');
  setTimeout(beginRound, ROUND_INTRO_MS);
}

// The time-attack clock starts here rather than alongside the screen
// transition — it used to run during the intro, handing the player a round
// that was already half a second old before the first question appeared.
function beginRound() {
  if (gameState.phase !== PHASE.PRESENTING) return;
  if (gameState.mode === 'timeattack') startRoundClock();
  showQuestion();
}

function showQuestion() {
  ensureQueue();
  if (isRoundOver() || !gameState.questions[gameState.currentQ]) {
    endGame();
    return;
  }

  gameState.phase = PHASE.PRESENTING;
  const q = gameState.questions[gameState.currentQ];

  $('questionCounter').textContent = isArcadeMode(gameState.mode)
    ? `سؤال ${gameState.currentQ + 1}`
    : `${gameState.currentQ + 1} / ${gameState.questionsCount}`;
  $('questionText').textContent = q.q;

  // Category badge
  const badge = $('categoryBadge');
  const cc = categoriesMeta[q.cat] || { icon: '❓', label: q.cat };
  badge.className = `category-badge cat-${q.cat}`;
  badge.textContent = `${cc.icon} ${cc.label}`;

  // Answers
  const grid = $('answersGrid');
  grid.innerHTML = '';
  q.a.forEach((ans, i) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.dataset.index = i;
    btn.setAttribute('aria-label', `الإجابة ${i + 1}: ${ans}`);
    const num = document.createElement('span');
    num.className = 'answer-num';
    num.setAttribute('aria-hidden', 'true');
    num.textContent = i + 1;
    const txt = document.createElement('span');
    txt.className = 'answer-text';
    txt.textContent = ans;
    btn.append(num, txt);
    btn.onclick = () => selectAnswer(i);
    grid.appendChild(btn);
  });

  // Hide explanation
  const exp = $('explanationCard');
  if (exp) exp.classList.remove('visible');

  gameState.qStartRemaining = roundClock.left;
  gameState.phase = PHASE.AWAITING;

  // Time-attack keeps its single round countdown; every other mode gets a
  // per-question timer.
  if (gameState.mode !== 'timeattack') {
    startQuestionClock();
  }
}

// ============================================================
// TIMERS
// ============================================================
let lastTimerPhase = '';
let lastTimerSecond = -1;

// The bar is animated by the compositor rather than by JavaScript: one width
// transition covering the whole countdown, instead of a style write per tick.
// The old interval rewrote width, text and className ~20 times a second
// whether or not anything had changed.
// setProperty(..., 'important') is deliberate — it has to outrank the
// reduced-motion rule that zeroes transition-duration globally. A countdown is
// information, not decoration, so it keeps moving when motion is reduced.
function armTimerBar(remaining, total) {
  const bar = $('timerBar');
  bar.style.setProperty('transition', 'none', 'important');
  bar.style.width = (remaining / total) * 100 + '%';
  void bar.offsetWidth; // flush, so the next change animates from here
  bar.style.setProperty('transition', `width ${remaining}s linear`, 'important');
  bar.style.width = '0%';
}

function freezeTimerBar() {
  const bar = $('timerBar');
  const width = getComputedStyle(bar).width;
  bar.style.setProperty('transition', 'none', 'important');
  bar.style.width = width;
}

// Runs per frame but only touches the DOM when a displayed value changes.
function paintTimer(remaining, total) {
  const secCeil = Math.ceil(remaining);
  if (secCeil !== lastTimerSecond) {
    $('timerText').textContent = secCeil;
    lastTimerSecond = secCeil;
  }

  const danger = Math.max(3, Math.floor(total * 0.2));
  const warn = Math.max(7, Math.floor(total * 0.5));
  const phase = remaining <= danger ? 'danger' : remaining <= warn ? 'warning' : '';
  if (phase !== lastTimerPhase) {
    // Rewriting className would drop the inline width/transition, so only the
    // state classes are touched.
    const bar = $('timerBar');
    bar.classList.remove('warning', 'danger');
    if (phase) bar.classList.add(phase);
    lastTimerPhase = phase;
  }
  return { phase, secCeil };
}

function startQuestionClock() {
  const total = gameState.timePerQuestion;
  lastTimerPhase = ''; lastTimerSecond = -1;
  $('timerBar').classList.remove('warning', 'danger');
  armTimerBar(total, total);
  let lastTick = 0;
  questionClock.start(total, (remaining) => {
    const { phase, secCeil } = paintTimer(remaining, total);
    if (phase === 'danger' && secCeil !== lastTick && secCeil > 0) {
      audio.play('tick');
      lastTick = secCeil;
    }
  }, () => {
    if (gameState.phase === PHASE.AWAITING) timeUp();
  });
}

function startRoundClock() {
  const total = MODE.timeattack.total;
  lastTimerPhase = ''; lastTimerSecond = -1;
  $('timerBar').classList.remove('warning', 'danger');
  armTimerBar(total, total);
  roundClock.start(total, (remaining) => paintTimer(remaining, total), () => {
    audio.play('timeup');
    document.querySelectorAll('.answer-btn').forEach(b => b.classList.add('disabled'));
    endGame();
  });
}

function elapsedOnQuestion() {
  return gameState.mode === 'timeattack'
    ? gameState.qStartRemaining - roundClock.left
    : gameState.timePerQuestion - questionClock.left;
}

// ============================================================
// ANSWERING
// ============================================================
function selectAnswer(idx) {
  if (gameState.phase !== PHASE.AWAITING) return;
  gameState.phase = PHASE.REVEALING;
  questionClock.stop();
  if (gameState.mode !== 'timeattack') freezeTimerBar();

  const q = gameState.questions[gameState.currentQ];
  const btns = document.querySelectorAll('.answer-btn');
  const timeTaken = Math.max(0, elapsedOnQuestion());
  gameState.totalTime += timeTaken;
  gameState.answeredCount++;

  btns.forEach(b => b.classList.add('disabled'));

  const diffMult = gameState.mode === 'survival'
    ? (SURVIVAL_MULT[q.d] || 1.0)
    : gameState.mode === 'timeattack'
      ? 1.0
      : (DIFFICULTY[gameState.difficulty]?.mult || 1.0);

  if (idx === q.c) {
    btns[idx].classList.add('correct');
    audio.play('correct');

    // Speedster counts only *correct* fast answers
    if (timeTaken < 3) gameState.fastAnswers++;

    gameState.streak++;
    if (gameState.streak > gameState.maxStreak) gameState.maxStreak = gameState.streak;

    const { points, streakBonus } = scoreAnswer(timeTaken, gameState.streak, diffMult);
    if (streakBonus > 0) {
      audio.play('streak');
      $('streakCount').textContent = gameState.streak;
      $('streakDisplay').classList.add('visible');
      spawnParticles(6, '#FFD700');
    }

    gameState.score += points;
    gameState.correctCount++;
    $('scoreValue').textContent = gameState.score;
    showBonusPopup(`+${points}`);
  } else {
    btns[idx].classList.add('wrong');
    btns[q.c].classList.add('reveal-correct');
    audio.play('wrong');
    gameState.streak = 0;
    $('streakDisplay').classList.remove('visible');
    gameState.mistakes.push({ q: q.q, cat: q.cat, correct: q.a[q.c], chosen: q.a[idx], e: q.e });
    if (gameState.mode === 'survival') gameState.eliminated = true;
  }

  // Time-attack skips the explanation card and auto-advances;
  // mistakes stay available in the post-round review
  if (gameState.mode === 'timeattack') {
    setTimeout(() => {
      if (gameState.phase === PHASE.REVEALING) advanceQuestion(0);
    }, TA_REVEAL_MS);
    return;
  }

  showExplanation(q);
}

function showExplanation(q) {
  const card = $('explanationCard');
  if (!card) return advanceQuestion();
  $('explanationText').textContent = q.e || 'لا يوجد شرح إضافي.';
  card.classList.add('visible');
}

// The ADVANCING phase is what stops a held Enter or a double tap from skipping
// a question during the gap before the next one renders.
function advanceQuestion(delayMs = 100) {
  if (gameState.phase !== PHASE.REVEALING) return;
  gameState.phase = PHASE.ADVANCING;
  $('explanationCard')?.classList.remove('visible');
  gameState.currentQ++;
  const go = () => { if (gameState.phase === PHASE.ADVANCING) showQuestion(); };
  if (delayMs > 0) setTimeout(go, delayMs);
  else requestAnimationFrame(go);
}

function timeUp() {
  gameState.phase = PHASE.REVEALING;
  audio.play('timeup');

  const q = gameState.questions[gameState.currentQ];
  const btns = document.querySelectorAll('.answer-btn');
  btns.forEach(b => b.classList.add('disabled'));
  btns[q.c].classList.add('reveal-correct');

  gameState.streak = 0;
  gameState.totalTime += gameState.timePerQuestion;
  gameState.answeredCount++;
  $('streakDisplay').classList.remove('visible');
  gameState.mistakes.push({ q: q.q, cat: q.cat, correct: q.a[q.c], chosen: null, e: q.e });
  if (gameState.mode === 'survival') gameState.eliminated = true;

  showExplanation(q);
}

// ============================================================
// PAUSE
// ============================================================
const inRound = () => gameState.screen === 'gameScreen' &&
  gameState.phase !== PHASE.ENDED && gameState.phase !== PHASE.IDLE;

function pauseGame() {
  if (!inRound() || gameState.phase === PHASE.PAUSED) return;
  gameState.phaseBeforePause = gameState.phase;
  gameState.phase = PHASE.PAUSED;
  questionClock.pause();
  roundClock.pause();
  freezeTimerBar();
  $('pauseOverlay').classList.add('visible');
  $('btnResume')?.focus({ preventScroll: true });
}

function resumeGame() {
  if (gameState.phase !== PHASE.PAUSED) return;
  audio.play('click');
  hidePause();
  gameState.phase = gameState.phaseBeforePause;
  // A round that was paused mid-reveal resumes without restarting its clock;
  // only a live question has a countdown to give back.
  if (gameState.phase === PHASE.AWAITING) {
    questionClock.resume();
    armTimerBar(questionClock.left, gameState.timePerQuestion);
  }
  if (gameState.mode === 'timeattack') {
    roundClock.resume();
    armTimerBar(roundClock.left, MODE.timeattack.total);
  }
}

function hidePause() {
  $('pauseOverlay')?.classList.remove('visible');
}

function togglePause() {
  if (gameState.phase === PHASE.PAUSED) resumeGame();
  else if (inRound()) { audio.play('click'); pauseGame(); }
}

function quitFromPause() {
  audio.play('click');
  hidePause();
  backToStart();
}

// ============================================================
// 50:50 LIFELINE
// ============================================================
function useFifty() {
  if (gameState.fiftyUsed || gameState.phase !== PHASE.AWAITING) return;
  audio.play('click');
  gameState.fiftyUsed = true;

  const q = gameState.questions[gameState.currentQ];
  const btns = document.querySelectorAll('.answer-btn');
  const wrongIndexes = [];
  q.a.forEach((_, i) => { if (i !== q.c) wrongIndexes.push(i); });
  shuffleArray(wrongIndexes).slice(0, 2).forEach(i => {
    btns[i].classList.add('faded');
    btns[i].disabled = true;
  });

  $('btnFifty').classList.add('used');
}

// ============================================================
// END GAME
// ============================================================
function endGame() {
  if (gameState.phase === PHASE.ENDED) return;
  gameState.phase = PHASE.ENDED;
  questionClock.stop();
  roundClock.stop();
  hidePause();
  $('streakDisplay').classList.remove('visible');

  const isArcade = isArcadeMode(gameState.mode);
  // Arcade rounds have no fixed length — stats are out of questions attempted
  const totalAsked = isArcade ? gameState.answeredCount : gameState.questionsCount;
  const score = gameState.score;
  // A daily practice replay is not a scored attempt: no record, no history,
  // no achievements, no effect on the streak.
  const scored = !gameState.dailyPractice;

  const board = boardKey(gameState.mode, gameState.difficulty);
  const prevBest = Storage.getBoardBest(board);
  const isNewRecord = scored ? Storage.setBoardBest(board, score) : false;
  gameState.bestScore = Storage.getBest();

  if (scored) {
    Storage.addHistory({
      score,
      correct: gameState.correctCount,
      total: totalAsked,
      maxStreak: gameState.maxStreak,
      mode: gameState.mode,
      difficulty: gameState.difficulty,
      category: gameState.category
    });

    if (gameState.mode === 'daily') {
      const streak = Storage.setDailyDone(score);
      if (streak >= 3) tryUnlock('daily_player');
    }

    // Achievements
    tryUnlock('first_game');
    if (gameState.maxStreak >= 5) tryUnlock('streak_5');
    if (gameState.maxStreak >= 10) tryUnlock('streak_10');
    if (!isArcade && gameState.correctCount === gameState.questionsCount) tryUnlock('perfect_round');
    if (gameState.fastAnswers >= 5) tryUnlock('speedster');
    if (score >= 1000) tryUnlock('score_1000');
    if (score >= 2000) tryUnlock('score_2000');
    if (!isArcade && gameState.difficulty === 'hard') tryUnlock('hard_master');
    // "no help" rewards finishing a full standard round without 50:50 —
    // not bailing out of an arcade round on the first question
    if (!isArcade && !gameState.fiftyUsed) tryUnlock('no_help');
    if (gameState.mode === 'category' && gameState.category !== 'all') {
      const played = Storage.addPlayedCategory(gameState.category);
      if (played.length >= Object.keys(categoriesMeta).length) tryUnlock('category_explorer');
      if (gameState.correctCount === gameState.questionsCount) tryUnlock('category_perfect');
    }
    if (gameState.mode === 'survival') {
      if (gameState.correctCount >= 10) tryUnlock('survivor_10');
      if (gameState.correctCount >= 25) tryUnlock('survivor_25');
    }
    if (gameState.mode === 'timeattack' && gameState.correctCount >= 12) tryUnlock('time_racer');
  }

  // Result UI
  let emoji, title;
  if (gameState.mode === 'survival') {
    emoji = '🛡️';
    title = gameState.correctCount > 0
      ? `صمدت لـ ${gameState.correctCount} إجابة صحيحة!`
      : 'حاول الصمود أكثر!';
  } else if (gameState.mode === 'timeattack') {
    emoji = '⏱️';
    title = `${gameState.correctCount} إجابة صحيحة في دقيقتين!`;
  } else {
    const ratio = gameState.correctCount / (totalAsked || 1);
    if (ratio >= 0.9) { emoji = '🏆'; title = 'أداء أسطوري!'; }
    else if (ratio >= 0.7) { emoji = '⭐'; title = 'أحسنت!'; }
    else if (ratio >= 0.5) { emoji = '👍'; title = 'جيد!'; }
    else { emoji = '💪'; title = 'حاول مجدداً!'; }
  }

  $('resultEmoji').textContent = emoji;
  $('resultTitle').textContent = title;
  $('resultScore').textContent = score;
  $('statCorrect').textContent = `${gameState.correctCount}/${totalAsked}`;
  $('statStreak').textContent = gameState.maxStreak;
  $('statAvgTime').textContent = (gameState.totalTime / (totalAsked || 1)).toFixed(1) + 'ث';

  // Label the retry button with the round it will actually replay
  const retryBtn = $('btnRetry');
  if (retryBtn) retryBtn.textContent = `🔄 ${replayLabel()}`;

  const reviewBtn = $('btnReview');
  if (reviewBtn) {
    const n = gameState.mistakes.length;
    reviewBtn.style.display = n ? 'flex' : 'none';
    reviewBtn.textContent = `📝 مراجعة الأخطاء (${n})`;
  }

  const newRecordEl = $('newRecord');
  if (isNewRecord && score > 0) {
    newRecordEl.classList.add('visible');
    audio.play('record');
    spawnParticles(20, '#FFD700');
    spawnParticles(15, '#FF6B35');
  } else {
    newRecordEl.classList.remove('visible');
  }

  // Every mode has its own board now, so every mode can show a target to beat
  const modeBestEl = $('modeBest');
  if (modeBestEl) {
    if (!scored) {
      modeBestEl.textContent = '🎯 جولة تدريب — لم تُسجَّل';
      modeBestEl.classList.add('visible');
    } else if (!isNewRecord && prevBest > 0) {
      modeBestEl.textContent = `🏅 أفضل نتيجة لك: ${prevBest}`;
      modeBestEl.classList.add('visible');
    } else {
      modeBestEl.classList.remove('visible');
    }
  }

  showScreen('resultsScreen');
  if (releasePendingWorker) releasePendingWorker();
}

function replayLabel() {
  if (isArcadeMode(gameState.mode)) return `${MODE[gameState.mode].label} مرة أخرى`;
  if (gameState.mode === 'daily') return 'جولة تدريب';
  const d = DIFFICULTY[gameState.difficulty];
  return `العب مرة أخرى (${d.label})`;
}

// Replays the round the player just finished, in place. This used to drop them
// on the main menu, which broke the die-and-retry loop that survival and
// time-attack are built around.
function replayRound() {
  audio.play('click');
  if (gameState.mode === 'daily') gameState.dailyPractice = true;
  startGameNow();
}

// ============================================================
// MISTAKE REVIEW
// ============================================================
function renderReview() {
  const list = $('reviewList');
  if (!list) return;
  list.innerHTML = '';
  gameState.mistakes.forEach(m => {
    const cc = categoriesMeta[m.cat] || { icon: '❓', label: m.cat };
    const item = document.createElement('div');
    item.className = 'review-item';
    const chosen = m.chosen === null ? '⏱️ انتهى الوقت' : m.chosen;
    const addLine = (cls, text) => {
      const div = document.createElement('div');
      div.className = cls;
      div.textContent = text;
      item.appendChild(div);
    };
    addLine('review-question', `${cc.icon} ${m.q}`);
    addLine('review-wrong', `إجابتك: ${chosen}`);
    addLine('review-correct', `الصحيح: ${m.correct}`);
    if (m.e) addLine('review-explanation', `💡 ${m.e}`);
    list.appendChild(item);
  });
}

function showReview() {
  audio.play('click');
  renderReview();
  showScreen('reviewScreen');
}

function backToResults() {
  audio.play('click');
  showScreen('resultsScreen');
}

function backToStart() {
  audio.play('click');
  gameState.exitArmed = false;
  clearTimeout(gameState.exitTimer);
  questionClock.stop();
  roundClock.stop();
  hidePause();
  gameState.phase = PHASE.IDLE;
  refreshStartScreen();
  showScreen('startScreen');
}

// Leaving mid-round discards all progress, so require a confirming second
// press within 2s instead of quitting on a single stray Esc / home tap.
function requestExit() {
  if (gameState.phase === PHASE.PAUSED) return quitFromPause();
  if (inRound() && !gameState.exitArmed) {
    audio.play('click');
    gameState.exitArmed = true;
    showToast('اضغط مجدداً للخروج من الجولة', 'wrong');
    clearTimeout(gameState.exitTimer);
    gameState.exitTimer = setTimeout(() => { gameState.exitArmed = false; }, 2000);
    return;
  }
  backToStart();
}

// ============================================================
// ACHIEVEMENTS
// ============================================================
function tryUnlock(id) {
  if (Storage.unlockAchievement(id)) {
    const ach = ACHIEVEMENTS.find(a => a.id === id);
    if (ach) {
      audio.play('achieve');
      showToast(`🏅 إنجاز جديد: ${ach.label}`, 'achieve');
    }
  }
}

function renderAchievements() {
  const list = $('achievementsList');
  if (!list) return;
  const unlocked = Storage.getAchievements();
  list.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const isUnlocked = unlocked.includes(a.id);
    const item = document.createElement('div');
    item.className = 'achievement-item' + (isUnlocked ? ' unlocked' : '');
    const icon = document.createElement('div');
    icon.className = 'achievement-icon';
    icon.textContent = isUnlocked ? a.icon : '🔒';
    const info = document.createElement('div');
    info.className = 'achievement-info';
    const label = document.createElement('div');
    label.className = 'achievement-label';
    label.textContent = a.label;
    const desc = document.createElement('div');
    desc.className = 'achievement-desc';
    desc.textContent = a.desc;
    info.append(label, desc);
    item.append(icon, info);
    list.appendChild(item);
  });

  $('achievementsCount').textContent = `${unlocked.length} / ${ACHIEVEMENTS.length}`;
}

function showAchievements() {
  audio.play('click');
  renderAchievements();
  showScreen('achievementsScreen');
}

// ============================================================
// HISTORY
// ============================================================
function renderHistory() {
  const list = $('historyList');
  if (!list) return;
  const history = Storage.getHistory();
  list.innerHTML = '';
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'لم تلعب أي جولة بعد';
    list.appendChild(empty);
    return;
  }
  history.forEach(h => {
    const d = new Date(h.date);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    let modeLabel;
    if (h.mode === 'daily') {
      modeLabel = '📅 يومي';
    } else if (isArcadeMode(h.mode)) {
      modeLabel = `${MODE[h.mode].icon} ${MODE[h.mode].label}`;
    } else {
      const diff = DIFFICULTY[h.difficulty];
      modeLabel = diff ? `${diff.icon} ${diff.label}` : (MODE[h.mode]?.label || '');
      const cc = h.category && h.category !== 'all' ? categoriesMeta[h.category] : null;
      if (cc) modeLabel = `${cc.icon} ${cc.label} • ${modeLabel}`;
    }
    const item = document.createElement('div');
    item.className = 'history-item';
    const score = document.createElement('div');
    score.className = 'history-score';
    score.textContent = h.score;
    const info = document.createElement('div');
    info.className = 'history-info';
    const mode = document.createElement('div');
    mode.className = 'history-mode';
    mode.textContent = modeLabel;
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = `${h.correct}/${h.total} • سلسلة ${h.maxStreak} • ${dateStr}`;
    info.append(mode, meta);
    item.append(score, info);
    list.appendChild(item);
  });
}

function showHistory() {
  audio.play('click');
  renderHistory();
  showScreen('historyScreen');
}

// ============================================================
// SETTINGS
// ============================================================
function showSettings() {
  audio.play('click');
  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.checked = (r.value === Storage.getTheme());
  });
  $('settingMute').checked = Storage.isMuted();
  $('settingMotion').checked = Storage.isReducedMotion();
  applyVolume(Storage.getVolume());
  renderKeybinds();
  showScreen('settingsScreen');
}

function onThemeChange(e) {
  applyTheme(e.target.value);
  audio.play('click');
}

function resetAllData() {
  if (!confirm('سيتم حذف كل بياناتك (النتائج والإنجازات والإعدادات). هل أنت متأكد؟')) return;
  Storage.resetAll();
  keybinds = { ...DEFAULT_KEYS };
  refreshStartScreen();
  applyTheme('night');
  applyMute(false);
  applyVolume(70);
  applyReducedMotion(false);
  renderKeybinds();
  showToast('✅ تم حذف البيانات', 'success');
}

// ---- key rebinding ----
function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const named = { Escape: 'Esc', Enter: 'Enter', Space: 'Space', Tab: 'Tab', Backspace: '⌫' };
  return named[code] || code;
}

function renderKeybinds() {
  const list = $('keybindList');
  if (!list) return;
  list.innerHTML = '';
  KEY_ACTIONS.forEach(action => {
    const row = document.createElement('div');
    row.className = 'keybind-row';
    const label = document.createElement('span');
    label.textContent = action.label;
    const btn = document.createElement('button');
    btn.className = 'keybind-btn' + (listeningFor === action.id ? ' listening' : '');
    btn.id = `keybind-${action.id}`;
    btn.textContent = listeningFor === action.id ? 'اضغط مفتاحاً…' : keyLabel(keybinds[action.id]);
    btn.setAttribute('aria-label', `${action.label}: ${keyLabel(keybinds[action.id])} — اضغط للتغيير`);
    btn.onclick = () => startListening(action.id);
    row.append(label, btn);
    list.appendChild(row);
  });
}

function startListening(actionId) {
  audio.play('click');
  listeningFor = listeningFor === actionId ? null : actionId;
  renderKeybinds();
  if (listeningFor) $(`keybind-${listeningFor}`)?.focus({ preventScroll: true });
}

// Returns true when the keypress was consumed by the rebinding UI.
function captureKeybind(e) {
  if (!listeningFor) return false;
  e.preventDefault();
  const code = e.code;
  if (code === 'Escape') { listeningFor = null; renderKeybinds(); return true; }
  // 1-4 stay reserved for answer selection, which is positional.
  if (/^(Digit|Numpad)[1-4]$/.test(code)) {
    showToast('المفاتيح 1-4 محجوزة لاختيار الإجابة', 'wrong');
    return true;
  }
  const clash = Object.keys(keybinds).find(k => k !== listeningFor && keybinds[k] === code);
  if (clash) {
    showToast(`المفتاح ${keyLabel(code)} مستخدم بالفعل`, 'wrong');
    const btn = $(`keybind-${listeningFor}`);
    btn?.classList.add('conflict');
    setTimeout(() => btn?.classList.remove('conflict'), 800);
    return true;
  }
  keybinds[listeningFor] = code;
  Storage.setKeybinds(keybinds);
  listeningFor = null;
  renderKeybinds();
  audio.play('click');
  return true;
}

function resetKeybinds() {
  audio.play('click');
  keybinds = { ...DEFAULT_KEYS };
  listeningFor = null;
  Storage.setKeybinds(keybinds);
  renderKeybinds();
  showToast('✅ استُعيدت الاختصارات الافتراضية', 'success');
}

function loadKeybinds() {
  const saved = Storage.getKeybinds();
  keybinds = { ...DEFAULT_KEYS };
  Object.keys(DEFAULT_KEYS).forEach(k => {
    if (typeof saved[k] === 'string' && saved[k]) keybinds[k] = saved[k];
  });
}

// ============================================================
// SHARE
// ============================================================
function shareResult() {
  audio.play('click');
  const modeLbl = gameState.mode === 'daily' || isArcadeMode(gameState.mode)
    ? MODE[gameState.mode].label
    : DIFFICULTY[gameState.difficulty].label;
  const cc = gameState.mode === 'category' && gameState.category !== 'all'
    ? categoriesMeta[gameState.category] : null;
  const totalAsked = isArcadeMode(gameState.mode) ? gameState.answeredCount : gameState.questionsCount;
  const text = `🏜️ تحدي العقول - مسابقة ثقافية\n` +
    `الوضع: ${modeLbl}\n` +
    (cc ? `الفئة: ${cc.label}\n` : '') +
    `⭐ النتيجة: ${gameState.score} نقطة\n` +
    `✅ الإجابات الصحيحة: ${gameState.correctCount}/${totalAsked}\n` +
    `🔥 أطول سلسلة: ${gameState.maxStreak}\n` +
    `⏱️ متوسط الوقت: ${(gameState.totalTime / (totalAsked || 1)).toFixed(1)} ثانية\n` +
    `هل تستطيع تحطيم رقمي؟ 💪`;

  if (navigator.share) {
    navigator.share({ title: 'تحدي العقول', text }).catch(() => copyToClipboard(text));
  } else {
    copyToClipboard(text);
  }
}

function copyToClipboard(text) {
  const onSuccess = () => showToast('✅ تم نسخ النتيجة!', 'success');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => fallbackCopy(text, onSuccess));
  } else {
    fallbackCopy(text, onSuccess);
  }
}

function fallbackCopy(text, cb) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
  cb && cb();
}

// ============================================================
// VISUAL EFFECTS
// ============================================================
function showBonusPopup(text) {
  const popup = $('bonusPopup');
  popup.textContent = text;
  popup.className = 'bonus-popup visible';
  setTimeout(() => popup.className = 'bonus-popup hide', 600);
  setTimeout(() => popup.className = 'bonus-popup', 1000);
}

function spawnParticles(count, color) {
  if (motionReduced()) return;
  const container = $('particles');
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.background = color;
    p.style.left = (40 + Math.random() * 20) + '%';
    p.style.top = (40 + Math.random() * 20) + '%';
    p.style.boxShadow = `0 0 6px ${color}`;
    const dx = (Math.random() - 0.5) * 300;
    const dy = (Math.random() - 0.5) * 300;
    const duration = 600 + Math.random() * 600;
    p.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0)`, opacity: 0 }
    ], { duration, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' });
    container.appendChild(p);
    setTimeout(() => p.remove(), duration);
  }
}

// ============================================================
// KEYBOARD SUPPORT
// ============================================================
function onKeyDown(e) {
  // Ignore key auto-repeat: a held Enter must not skip questions, nor a
  // held answer key retrigger. Using e.code keeps shortcuts layout-agnostic
  // (works on Arabic and other non-QWERTY keyboards).
  if (e.repeat) return;
  if (captureKeybind(e)) return;

  const code = e.code;
  const screen = gameState.screen;

  if (code === keybinds.mute) { toggleMute(); return; }

  if (code === keybinds.pause && (inRound() || gameState.phase === PHASE.PAUSED)) {
    e.preventDefault();
    togglePause();
    return;
  }

  if (gameState.phase === PHASE.PAUSED) {
    if (code === 'Enter' || code === 'Space') { e.preventDefault(); resumeGame(); }
    else if (code === keybinds.exit) quitFromPause();
    return;
  }

  if (screen === 'gameScreen') {
    if (gameState.phase === PHASE.AWAITING) {
      let num = NaN;
      if (code.startsWith('Digit')) num = parseInt(code.slice(5));
      else if (code.startsWith('Numpad')) num = parseInt(code.slice(6));
      if (num >= 1 && num <= 4) {
        const btns = document.querySelectorAll('.answer-btn');
        if (btns[num - 1] && !btns[num - 1].disabled) selectAnswer(num - 1);
        return;
      }
      if (code === keybinds.fifty) { useFifty(); return; }
    } else if (gameState.phase === PHASE.REVEALING) {
      // Time-attack auto-advances; a manual advance would skip a question
      if ((code === keybinds.next || code === 'Space') && gameState.mode !== 'timeattack') {
        e.preventDefault();
        advanceQuestion();
        return;
      }
    }
  }

  if (code === keybinds.exit && screen !== 'startScreen') {
    if (screen === 'reviewScreen') backToResults();
    else if (screen === 'gameScreen') requestExit();
    else backToStart();
  }
}

// ============================================================
// START SCREEN
// ============================================================
function setModeLabel(id, text) {
  const btn = $(id);
  const label = btn?.querySelector('.mode-label');
  if (label) label.textContent = text;
}

function refreshStartScreen() {
  $('bestRecordValue').textContent = Storage.getBest();
  const dailyDone = Storage.isDailyDone();
  const dailyBtn = $('btnDaily');
  if (dailyBtn) {
    dailyBtn.classList.toggle('completed', dailyDone);
    setModeLabel('btnDaily', dailyDone ? `✅ تحدي اليوم (${Storage.getDailyScore()})` : '📅 تحدي اليوم');
  }
  const streak = Storage.getDailyStreak();
  const ds = $('dailyStreak');
  if (ds) {
    if (streak > 0) {
      ds.textContent = `🔥 ${streak} يوم متتالٍ`;
      ds.style.display = 'inline-block';
    } else {
      ds.style.display = 'none';
    }
  }

  // Surface arcade-mode personal bests on their buttons as a target to beat
  const survivalBest = Storage.getBoardBest('survival');
  setModeLabel('btnSurvival', survivalBest ? `🛡️ البقاء (${survivalBest})` : '🛡️ البقاء');
  const timeBest = Storage.getBoardBest('timeattack');
  setModeLabel('btnTimeattack', timeBest ? `⏱️ ضد الساعة (${timeBest})` : '⏱️ ضد الساعة');
}

// ============================================================
// INIT
// ============================================================
async function init() {
  // Apply persisted settings
  applyTheme(Storage.getTheme());
  applyReducedMotion(Storage.isReducedMotion());
  audio.setMuted(Storage.isMuted());
  audio.setVolume(Storage.getVolume() / 100);
  loadKeybinds();

  // The audio context can only be created inside a user gesture, and it used
  // to be created inside startGameNow — so every click in the menus before the
  // first round of a session was silent, which reads as a broken game.
  const unlockAudio = () => {
    audio.init();
    audio.setVolume(Storage.getVolume() / 100);
    audio.setMuted(Storage.isMuted());
    audio.resume();
  };
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });

  await loadQuestions();

  document.addEventListener('keydown', onKeyDown);

  // A round should never keep burning the clock while the player is in another
  // app or tab; rAF stops there anyway, so without this the countdown would
  // simply jump on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (inRound()) pauseGame(); }
    else audio.resume();
  });

  if (typeof Scene !== 'undefined' && Scene.init) Scene.init();

  refreshStartScreen();
  applyMute(Storage.isMuted());
  applyVolume(Storage.getVolume());

  // Settings inputs
  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.addEventListener('change', onThemeChange);
  });
  $('settingMute')?.addEventListener('change', (e) => applyMute(e.target.checked));
  $('settingMotion')?.addEventListener('change', (e) => applyReducedMotion(e.target.checked));
  $('settingVolume')?.addEventListener('input', (e) => applyVolume(Number(e.target.value)));

  // Register service worker. A waiting worker is only allowed to take over
  // between rounds — activating mid-round would delete the cache the running
  // page is still served from.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('sw.js');
        const release = () => {
          if (reg.waiting && !inRound()) reg.waiting.postMessage('skip-waiting');
        };
        reg.addEventListener('updatefound', () => {
          reg.installing?.addEventListener('statechange', release);
        });
        releasePendingWorker = release;
        release();
      } catch { /* offline-first still works without an active worker */ }
    });
  }
}

window.addEventListener('DOMContentLoaded', init);
