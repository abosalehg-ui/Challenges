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
  classic: { label: 'كلاسيكي', icon: '🎯' },
  daily:   { label: 'تحدي اليوم', icon: '📅' }
};

const BONUS_SPEED = 5;

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
  { id: 'no_help',        label: 'بدون مساعدة',         desc: 'أكمل جولة دون استخدام 50:50',           icon: '🧠' }
];

let gameState = {
  currentQ: 0,
  score: 0,
  streak: 0,
  maxStreak: 0,
  correctCount: 0,
  totalTime: 0,
  fastAnswers: 0,
  questions: [],
  timeLeft: 0,
  timerInterval: null,
  answered: false,
  bestScore: 0,
  difficulty: 'medium',
  mode: 'classic',
  fiftyUsed: false,
  fiftyAvailable: true,
  questionsCount: 15,
  timePerQuestion: 15
};

let allQuestions = [];
let categoriesMeta = {};

// ============================================================
// LOAD QUESTIONS
// ============================================================
async function loadQuestions() {
  try {
    const res = await fetch('data/questions.json');
    const data = await res.json();
    allQuestions = data.questions;
    categoriesMeta = data.categories;
  } catch (e) {
    console.error('Failed to load questions:', e);
    showToast('❌ فشل تحميل الأسئلة', 'wrong');
  }
}

// ============================================================
// SEEDED RANDOM (for daily challenge)
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
  const isDaily = gameState.mode === 'daily';
  const rng = isDaily ? seedRandom(Storage.getDailyKey()) : Math.random;
  const count = isDaily ? 10 : gameState.questionsCount;

  // Filter by difficulty if not daily
  let pool = allQuestions;
  if (!isDaily) {
    const diffs = DIFF_POOLS[gameState.difficulty][0];
    pool = allQuestions.filter(q => diffs.includes(q.d));
  }

  // Group by category
  const cats = {};
  pool.forEach(q => {
    if (!cats[q.cat]) cats[q.cat] = [];
    cats[q.cat].push(q);
  });

  const catKeys = Object.keys(cats);
  const perCat = Math.floor(count / catKeys.length);
  const remainder = count % catKeys.length;

  let selected = [];
  catKeys.forEach((cat, i) => {
    const c = perCat + (i < remainder ? 1 : 0);
    const shuffled = shuffleArrayWith(cats[cat], rng);
    selected = selected.concat(shuffled.slice(0, c));
  });

  // Top up when small category pools left the round short: first from the
  // rest of the same pool, then from progressively wider difficulty pools
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
    topUp(pool);
    if (!isDaily) {
      for (const diffs of DIFF_POOLS[gameState.difficulty].slice(1)) {
        if (selected.length >= count) break;
        topUp(allQuestions.filter(q => diffs.includes(q.d)));
      }
    }
  }

  // Shuffle order and answers
  return shuffleArrayWith(selected, rng).map(q => {
    const correctAnswer = q.a[q.c];
    const shuffledAnswers = shuffleArrayWith(q.a, rng);
    return { ...q, a: shuffledAnswers, c: shuffledAnswers.indexOf(correctAnswer) };
  });
}

// ============================================================
// UI HELPERS
// ============================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(text, type = 'success') {
  const toast = document.getElementById('shareToast');
  toast.textContent = text;
  toast.dataset.type = type;
  toast.classList.add('visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('visible'), 2500);
}

function $(id) { return document.getElementById(id); }

// ============================================================
// THEME
// ============================================================
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  Storage.setTheme(theme);
  if (typeof Scene !== 'undefined' && Scene.setTheme) Scene.setTheme(theme);
}

// ============================================================
// MUTE
// ============================================================
function applyMute(muted) {
  audio.setMuted(muted);
  Storage.setMuted(muted);
  const btn = $('btnMute');
  if (btn) {
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-label', muted ? 'تشغيل الصوت' : 'كتم الصوت');
    btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }
}

function toggleMute() {
  audio.play('click');
  applyMute(!Storage.isMuted());
}

// ============================================================
// MODE/DIFFICULTY SELECTION
// ============================================================
function chooseMode(mode) {
  audio.play('click');
  gameState.mode = mode;
  if (mode === 'daily') {
    if (Storage.isDailyDone()) {
      showToast(`أكملت تحدي اليوم! نقاطك: ${Storage.getDailyScore()}`, 'success');
      return;
    }
    gameState.difficulty = 'medium';
    startGameNow();
  } else {
    showScreen('difficultyScreen');
  }
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

  gameState.currentQ = 0;
  gameState.score = 0;
  gameState.streak = 0;
  gameState.maxStreak = 0;
  gameState.correctCount = 0;
  gameState.totalTime = 0;
  gameState.fastAnswers = 0;
  gameState.fiftyUsed = false;
  gameState.fiftyAvailable = true;
  gameState.questions = selectQuestions();

  // Clamp to what was actually selected — the pool may not fill the round
  gameState.questionsCount = gameState.questions.length;
  if (gameState.mode === 'daily') gameState.timePerQuestion = 15;

  if (!gameState.questionsCount) {
    showToast('❌ لا توجد أسئلة متاحة', 'wrong');
    showScreen('startScreen');
    return;
  }

  $('scoreValue').textContent = '0';
  $('streakDisplay').classList.remove('visible');

  const fiftyBtn = $('btnFifty');
  fiftyBtn.style.display = 'flex';
  fiftyBtn.classList.remove('used');

  // Mode indicator
  const modeInd = $('modeIndicator');
  if (modeInd) {
    const m = MODE[gameState.mode];
    const d = DIFFICULTY[gameState.difficulty];
    modeInd.textContent = gameState.mode === 'daily'
      ? `${m.icon} ${m.label}`
      : `${d.icon} ${d.label}`;
  }

  showScreen('gameScreen');
  setTimeout(() => showQuestion(), 300);
}

function showQuestion() {
  if (gameState.currentQ >= gameState.questionsCount || !gameState.questions[gameState.currentQ]) {
    endGame();
    return;
  }

  gameState.answered = false;
  const q = gameState.questions[gameState.currentQ];

  $('questionCounter').textContent = `${gameState.currentQ + 1} / ${gameState.questionsCount}`;
  $('questionText').textContent = q.q;

  // Category badge
  const badge = $('categoryBadge');
  const cc = categoriesMeta[q.cat] || { icon: '❓', label: q.cat };
  badge.className = `category-badge cat-${q.cat}`;
  badge.innerHTML = `${cc.icon} ${cc.label}`;

  // Answers
  const grid = $('answersGrid');
  grid.innerHTML = '';
  q.a.forEach((ans, i) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.dataset.index = i;
    btn.setAttribute('aria-label', `الإجابة ${i + 1}: ${ans}`);
    btn.innerHTML = `<span class="answer-num" aria-hidden="true">${i + 1}</span><span class="answer-text">${ans}</span>`;
    btn.onclick = () => selectAnswer(i);
    grid.appendChild(btn);
  });

  // Hide explanation
  const exp = $('explanationCard');
  if (exp) exp.classList.remove('visible');

  // Reset timer UI
  gameState.timeLeft = gameState.timePerQuestion;
  startTimer();
}

function startTimer() {
  const timerBar = $('timerBar');
  const timerText = $('timerText');
  const TPQ = gameState.timePerQuestion;

  clearInterval(gameState.timerInterval);
  timerBar.style.width = '100%';
  timerBar.className = 'timer-bar';
  timerText.textContent = TPQ;

  const startTime = Date.now();
  let lastTickSec = 0;
  gameState.timerInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const remaining = Math.max(0, TPQ - elapsed);
    gameState.timeLeft = remaining;

    const pct = (remaining / TPQ) * 100;
    timerBar.style.width = pct + '%';
    const secCeil = Math.ceil(remaining);
    timerText.textContent = secCeil;

    const dangerThreshold = Math.max(3, Math.floor(TPQ * 0.2));
    const warnThreshold = Math.max(7, Math.floor(TPQ * 0.5));
    if (remaining <= dangerThreshold) {
      timerBar.className = 'timer-bar danger';
      if (secCeil !== lastTickSec && secCeil > 0) {
        audio.play('tick');
        lastTickSec = secCeil;
      }
    } else if (remaining <= warnThreshold) {
      timerBar.className = 'timer-bar warning';
    }

    if (remaining <= 0) {
      clearInterval(gameState.timerInterval);
      if (!gameState.answered) timeUp();
    }
  }, 50);
}

function selectAnswer(idx) {
  if (gameState.answered) return;
  gameState.answered = true;
  clearInterval(gameState.timerInterval);

  const q = gameState.questions[gameState.currentQ];
  const btns = document.querySelectorAll('.answer-btn');
  const timeTaken = gameState.timePerQuestion - gameState.timeLeft;
  gameState.totalTime += timeTaken;

  btns.forEach(b => b.classList.add('disabled'));

  if (timeTaken < 3) gameState.fastAnswers++;

  const diffMult = DIFFICULTY[gameState.difficulty]?.mult || 1.0;

  if (idx === q.c) {
    btns[idx].classList.add('correct');
    audio.play('correct');

    let points = 100;
    if (timeTaken < BONUS_SPEED) {
      const speedBonus = Math.round((BONUS_SPEED - timeTaken) / BONUS_SPEED * 50);
      points += speedBonus;
    }

    gameState.streak++;
    if (gameState.streak > gameState.maxStreak) gameState.maxStreak = gameState.streak;

    if (gameState.streak >= 3) {
      const streakBonus = gameState.streak * 10;
      points += streakBonus;
      audio.play('streak');
      const sd = $('streakDisplay');
      $('streakCount').textContent = gameState.streak;
      sd.classList.add('visible');
      spawnParticles(6, '#FFD700');
    }

    points = Math.round(points * diffMult);
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
  }

  showExplanation(q);
}

function showExplanation(q) {
  const card = $('explanationCard');
  if (!card) return advanceQuestion();
  const text = q.e || 'لا يوجد شرح إضافي.';
  $('explanationText').textContent = text;
  card.classList.add('visible');
}

function advanceQuestion() {
  $('explanationCard')?.classList.remove('visible');
  gameState.currentQ++;
  setTimeout(() => showQuestion(), 100);
}

function timeUp() {
  gameState.answered = true;
  audio.play('timeup');

  const q = gameState.questions[gameState.currentQ];
  const btns = document.querySelectorAll('.answer-btn');
  btns.forEach(b => b.classList.add('disabled'));
  btns[q.c].classList.add('reveal-correct');

  gameState.streak = 0;
  gameState.totalTime += gameState.timePerQuestion;
  $('streakDisplay').classList.remove('visible');

  showExplanation(q);
}

// ============================================================
// 50:50 LIFELINE
// ============================================================
function useFifty() {
  if (!gameState.fiftyAvailable || gameState.fiftyUsed || gameState.answered) return;
  audio.play('click');
  gameState.fiftyUsed = true;
  gameState.fiftyAvailable = false;

  const q = gameState.questions[gameState.currentQ];
  const btns = document.querySelectorAll('.answer-btn');
  const wrongIndexes = [];
  q.a.forEach((_, i) => { if (i !== q.c) wrongIndexes.push(i); });
  const toRemove = shuffleArray(wrongIndexes).slice(0, 2);
  toRemove.forEach(i => {
    btns[i].classList.add('faded');
    btns[i].disabled = true;
  });

  const btn = $('btnFifty');
  btn.classList.add('used');
}

// ============================================================
// END GAME
// ============================================================
function endGame() {
  clearInterval(gameState.timerInterval);
  $('streakDisplay').classList.remove('visible');

  const score = gameState.score;
  const isNewRecord = Storage.setBest(score);
  gameState.bestScore = Storage.getBest();

  // Save history
  Storage.addHistory({
    score,
    correct: gameState.correctCount,
    total: gameState.questionsCount,
    maxStreak: gameState.maxStreak,
    mode: gameState.mode,
    difficulty: gameState.difficulty
  });

  // Daily completion
  if (gameState.mode === 'daily') {
    const streak = Storage.setDailyDone(score);
    if (streak >= 3) tryUnlock('daily_player');
  }

  // Achievements
  tryUnlock('first_game');
  if (gameState.maxStreak >= 5) tryUnlock('streak_5');
  if (gameState.maxStreak >= 10) tryUnlock('streak_10');
  if (gameState.correctCount === gameState.questionsCount) tryUnlock('perfect_round');
  if (gameState.fastAnswers >= 5) tryUnlock('speedster');
  if (score >= 1000) tryUnlock('score_1000');
  if (score >= 2000) tryUnlock('score_2000');
  if (gameState.difficulty === 'hard') tryUnlock('hard_master');
  if (!gameState.fiftyUsed) tryUnlock('no_help');

  // Result UI
  const ratio = gameState.correctCount / gameState.questionsCount;
  let emoji, title;
  if (ratio >= 0.9) { emoji = '🏆'; title = 'أداء أسطوري!'; }
  else if (ratio >= 0.7) { emoji = '⭐'; title = 'أحسنت!'; }
  else if (ratio >= 0.5) { emoji = '👍'; title = 'جيد!'; }
  else { emoji = '💪'; title = 'حاول مجدداً!'; }

  $('resultEmoji').textContent = emoji;
  $('resultTitle').textContent = title;
  $('resultScore').textContent = score;
  $('statCorrect').textContent = `${gameState.correctCount}/${gameState.questionsCount}`;
  $('statStreak').textContent = gameState.maxStreak;
  $('statAvgTime').textContent = (gameState.totalTime / gameState.questionsCount).toFixed(1) + 'ث';

  const newRecordEl = $('newRecord');
  if (isNewRecord && score > 0) {
    newRecordEl.classList.add('visible');
    audio.play('record');
    spawnParticles(20, '#FFD700');
    spawnParticles(15, '#FF6B35');
  } else {
    newRecordEl.classList.remove('visible');
  }

  showScreen('resultsScreen');
}

function restartGame() {
  audio.play('click');
  refreshStartScreen();
  showScreen('startScreen');
}

function backToStart() {
  audio.play('click');
  clearInterval(gameState.timerInterval);
  refreshStartScreen();
  showScreen('startScreen');
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
    item.innerHTML = `
      <div class="achievement-icon">${isUnlocked ? a.icon : '🔒'}</div>
      <div class="achievement-info">
        <div class="achievement-label">${a.label}</div>
        <div class="achievement-desc">${a.desc}</div>
      </div>
    `;
    list.appendChild(item);
  });

  const total = ACHIEVEMENTS.length;
  $('achievementsCount').textContent = `${unlocked.length} / ${total}`;
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
    list.innerHTML = '<div class="history-empty">لم تلعب أي جولة بعد</div>';
    return;
  }
  history.forEach(h => {
    const d = new Date(h.date);
    const dateStr = `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    const modeLabel = h.mode === 'daily' ? '📅 يومي' : (DIFFICULTY[h.difficulty]?.icon + ' ' + DIFFICULTY[h.difficulty]?.label);
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-score">${h.score}</div>
      <div class="history-info">
        <div class="history-mode">${modeLabel}</div>
        <div class="history-meta">${h.correct}/${h.total} • سلسلة ${h.maxStreak} • ${dateStr}</div>
      </div>
    `;
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
  const themeRadios = document.querySelectorAll('input[name="theme"]');
  themeRadios.forEach(r => { r.checked = (r.value === Storage.getTheme()); });
  $('settingMute').checked = Storage.isMuted();
  showScreen('settingsScreen');
}

function onThemeChange(e) {
  applyTheme(e.target.value);
  audio.play('click');
}

function onMuteChange(e) {
  applyMute(e.target.checked);
}

function resetAllData() {
  if (!confirm('سيتم حذف كل بياناتك (النتائج والإنجازات). هل أنت متأكد؟')) return;
  Storage.resetAll();
  refreshStartScreen();
  applyTheme('night');
  applyMute(false);
  showToast('✅ تم حذف البيانات', 'success');
}

// ============================================================
// SHARE
// ============================================================
function shareResult() {
  audio.play('click');
  const modeLbl = gameState.mode === 'daily' ? 'تحدي اليوم' : DIFFICULTY[gameState.difficulty].label;
  const text = `🏜️ تحدي العقول - مسابقة ثقافية\n` +
    `الوضع: ${modeLbl}\n` +
    `⭐ النتيجة: ${gameState.score} نقطة\n` +
    `✅ الإجابات الصحيحة: ${gameState.correctCount}/${gameState.questionsCount}\n` +
    `🔥 أطول سلسلة: ${gameState.maxStreak}\n` +
    `⏱️ متوسط الوقت: ${(gameState.totalTime / gameState.questionsCount).toFixed(1)} ثانية\n` +
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
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
  const active = document.querySelector('.screen.active')?.id;

  if (e.key === 'm' || e.key === 'M' || e.key === 'ء') {
    toggleMute();
    return;
  }

  if (active === 'gameScreen' && !gameState.answered) {
    const num = parseInt(e.key);
    if (num >= 1 && num <= 4) {
      const btns = document.querySelectorAll('.answer-btn');
      if (btns[num - 1] && !btns[num - 1].disabled) {
        selectAnswer(num - 1);
      }
    } else if (e.key === 'h' || e.key === 'H') {
      useFifty();
    }
  } else if (active === 'gameScreen' && gameState.answered) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      advanceQuestion();
    }
  }

  if (e.key === 'Escape' && active !== 'startScreen') {
    backToStart();
  }
}

// ============================================================
// START SCREEN
// ============================================================
function refreshStartScreen() {
  $('bestRecordValue').textContent = Storage.getBest();
  const dailyDone = Storage.isDailyDone();
  const dailyBtn = $('btnDaily');
  if (dailyBtn) {
    if (dailyDone) {
      dailyBtn.classList.add('completed');
      dailyBtn.innerHTML = `✅ تحدي اليوم (${Storage.getDailyScore()})`;
    } else {
      dailyBtn.classList.remove('completed');
      dailyBtn.innerHTML = `📅 تحدي اليوم`;
    }
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
}

// ============================================================
// INIT
// ============================================================
async function init() {
  // Apply persisted settings
  applyTheme(Storage.getTheme());
  audio.setMuted(Storage.isMuted());

  // Load questions
  await loadQuestions();

  // Hook keyboard
  document.addEventListener('keydown', onKeyDown);

  // Init Three.js scene
  if (typeof Scene !== 'undefined' && Scene.init) Scene.init();

  // Refresh start screen
  refreshStartScreen();

  // Apply mute button state
  applyMute(Storage.isMuted());

  // Settings inputs
  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.addEventListener('change', onThemeChange);
  });
  $('settingMute')?.addEventListener('change', onMuteChange);

  // Register service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

window.addEventListener('DOMContentLoaded', init);
