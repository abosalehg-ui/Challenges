// ============================================================
// ROUND FLOW — the round's phase machine, with no DOM in it
// ============================================================
// This used to live inline in game.js as a `gameState.phase` string plus a
// scatter of bare setTimeout calls. That arrangement had a hole: the two
// transient phases below are only ever left by a *scheduled* callback, and
// pausing cancelled the timer while `resume` only restored the phase string.
// The callback was gone, so the round sat in PRESENTING/ADVANCING forever —
// no question, no clock, no way forward but abandoning the round. Since
// `visibilitychange` pauses automatically, a notification arriving in the
// ~100ms after "next" was enough to trigger it.
//
// Here the pending transition is part of the state, so pause keeps it and
// resume re-arms it. The scheduler is injected, which is what lets
// scripts/tests/round.test.mjs drive the whole machine without a browser —
// the class of bug above is now caught in CI rather than by hand.

const PHASE = {
  IDLE: 'idle',             // menus; no round in flight
  PRESENTING: 'presenting', // question rendering — input intentionally dead
  AWAITING: 'awaiting',     // the only phase that accepts an answer
  REVEALING: 'revealing',   // answer shown / explanation up
  ADVANCING: 'advancing',   // moving to the next question
  PAUSED: 'paused',
  ENDED: 'ended'
};

// Phases a round cannot leave on its own: something scheduled has to move it.
const TRANSIENT_PHASES = [PHASE.PRESENTING, PHASE.ADVANCING];

// Pausing is meaningless outside a live round.
const UNPAUSABLE_PHASES = [PHASE.IDLE, PHASE.ENDED, PHASE.PAUSED];

// Default scheduler: a delay of 0 means "after the next paint" so the answer
// grid is on screen before the phase moves on. Returns its own canceller.
function defaultSchedule(fn, delayMs) {
  if (delayMs > 0) {
    const id = setTimeout(fn, delayMs);
    return () => clearTimeout(id);
  }
  const id = requestAnimationFrame(fn);
  return () => cancelAnimationFrame(id);
}

function createRoundFlow(io = {}) {
  const schedule = io.schedule || defaultSchedule;

  let phase = PHASE.IDLE;
  let phaseBeforePause = PHASE.IDLE;
  let cancel = null;          // cancels the armed timer, if any
  let pending = null;         // { target, delay, run } — survives a pause

  function arm() {
    const queued = pending;
    cancel = schedule(() => {
      cancel = null;
      // A phase change since arming (endGame, leaving to the menu) supersedes
      // this transition; dropping it here is the intended behaviour.
      if (phase !== queued.target || pending !== queued) return;
      pending = null;
      queued.run();
    }, queued.delay);
  }

  function drop() {
    if (cancel) cancel();
    cancel = null;
    pending = null;
  }

  return {
    get phase() { return phase; },
    get phaseBeforePause() { return phaseBeforePause; },
    // Exposed for the tests, and for asserting the round is not mid-transition.
    get pendingPhase() { return pending ? pending.target : null; },

    // Move to a phase the round can sit in. Any queued transition is dropped,
    // because whoever calls this is deciding where the round goes next.
    set(next) {
      drop();
      phase = next;
    },

    // Enter `target` and queue the only thing that leaves it. Pausing before
    // the delay elapses keeps the transition queued rather than losing it.
    begin(target, delayMs, run) {
      drop();
      phase = target;
      pending = { target, delay: delayMs, run };
      arm();
    },

    // Returns false when there is nothing to pause, so callers can skip the
    // rest of their pause work (freezing clocks, showing the overlay).
    pause() {
      if (UNPAUSABLE_PHASES.includes(phase)) return false;
      phaseBeforePause = phase;
      // Cancel the timer but keep `pending`: that is the whole fix.
      if (cancel) cancel();
      cancel = null;
      phase = PHASE.PAUSED;
      return true;
    },

    // Restores the pre-pause phase and re-arms a transition that was in
    // flight. Returns the restored phase, or null if nothing was paused.
    resume() {
      if (phase !== PHASE.PAUSED) return null;
      phase = phaseBeforePause;
      if (pending) arm();
      return phase;
    },

    isTransient(p = phase) { return TRANSIENT_PHASES.includes(p); }
  };
}

if (typeof module !== 'undefined') {
  module.exports = { PHASE, TRANSIENT_PHASES, createRoundFlow, defaultSchedule };
}
