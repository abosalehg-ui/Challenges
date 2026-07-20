// ============================================================
// STORAGE — localStorage helpers for game persistence
// ============================================================
const Storage = (() => {
  const KEYS = {
    BEST: 'quiz_best_score',
    MUTED: 'quiz_muted',
    THEME: 'quiz_theme',
    HISTORY: 'quiz_history',
    ACHIEVEMENTS: 'quiz_achievements',
    DAILY: 'quiz_daily_last',
    DAILY_SCORE: 'quiz_daily_score',
    DAILY_STREAK: 'quiz_daily_streak',
    CATS_PLAYED: 'quiz_cats_played',
    BEST_MODES: 'quiz_best_modes',
    RECENT: 'quiz_recent_questions'
  };

  const get = (key, fallback = null) => {
    try {
      const v = localStorage.getItem(key);
      if (v === null) return fallback;
      try { return JSON.parse(v); } catch { return v; }
    } catch { return fallback; }
  };

  const set = (key, value) => {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    } catch { return false; }
  };

  const remove = (key) => {
    try { localStorage.removeItem(key); return true; } catch { return false; }
  };

  // Best score
  const getBest = () => parseInt(get(KEYS.BEST, '0')) || 0;
  const setBest = (score) => {
    const current = getBest();
    if (score > current) { set(KEYS.BEST, score.toString()); return true; }
    return false;
  };

  // Mute
  const isMuted = () => get(KEYS.MUTED, false) === true || get(KEYS.MUTED) === 'true';
  const setMuted = (val) => set(KEYS.MUTED, val);

  // Theme
  const getTheme = () => get(KEYS.THEME, 'night') || 'night';
  const setTheme = (theme) => set(KEYS.THEME, theme);

  // History (last 10 games)
  const getHistory = () => get(KEYS.HISTORY, []) || [];
  const addHistory = (entry) => {
    const history = getHistory();
    history.unshift({ ...entry, date: new Date().toISOString() });
    set(KEYS.HISTORY, history.slice(0, 10));
  };

  // Recently played question ids — keeps consecutive rounds from repeating
  const getRecent = () => get(KEYS.RECENT, []) || [];
  const pushRecent = (ids, cap = 120) => {
    if (!ids || !ids.length) return;
    set(KEYS.RECENT, ids.concat(getRecent()).slice(0, cap));
  };

  // Achievements
  const getAchievements = () => get(KEYS.ACHIEVEMENTS, []) || [];
  const unlockAchievement = (id) => {
    const list = getAchievements();
    if (!list.includes(id)) { list.push(id); set(KEYS.ACHIEVEMENTS, list); return true; }
    return false;
  };

  // Daily challenge (streak math lives in utils.js so it can be unit tested)
  const getDailyKey = () => dailyKeyFor(new Date());
  const isDailyDone = () => get(KEYS.DAILY) === getDailyKey();
  const setDailyDone = (score) => {
    const today = getDailyKey();
    const streak = nextDailyStreak(get(KEYS.DAILY), get(KEYS.DAILY_STREAK, 0) || 0, today);
    set(KEYS.DAILY, today);
    set(KEYS.DAILY_SCORE, score);
    set(KEYS.DAILY_STREAK, streak);
    return streak;
  };
  // Reflect a broken streak (a gap of more than one day) when reading it back.
  const getDailyStreak = () =>
    displayedDailyStreak(get(KEYS.DAILY), get(KEYS.DAILY_STREAK, 0) || 0, getDailyKey());
  const getDailyScore = () => get(KEYS.DAILY_SCORE, 0) || 0;

  // Per-mode best scores (survival / timeattack)
  const getModeBest = (mode) => {
    const all = get(KEYS.BEST_MODES, {}) || {};
    return all[mode] || 0;
  };
  const setModeBest = (mode, score) => {
    const all = get(KEYS.BEST_MODES, {}) || {};
    if (score > (all[mode] || 0)) { all[mode] = score; set(KEYS.BEST_MODES, all); return true; }
    return false;
  };

  // Categories played (for the category-explorer achievement)
  const getPlayedCategories = () => get(KEYS.CATS_PLAYED, []) || [];
  const addPlayedCategory = (cat) => {
    const list = getPlayedCategories();
    if (!list.includes(cat)) { list.push(cat); set(KEYS.CATS_PLAYED, list); }
    return list;
  };

  // Reset all
  const resetAll = () => {
    Object.values(KEYS).forEach(k => remove(k));
  };

  return {
    KEYS, get, set, remove,
    getBest, setBest,
    isMuted, setMuted,
    getTheme, setTheme,
    getHistory, addHistory,
    getRecent, pushRecent,
    getAchievements, unlockAchievement,
    isDailyDone, setDailyDone, getDailyStreak, getDailyScore, getDailyKey,
    getModeBest, setModeBest,
    getPlayedCategories, addPlayedCategory,
    resetAll
  };
})();
