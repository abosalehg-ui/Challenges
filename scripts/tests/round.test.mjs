// node --test — unit tests for js/round.js
//
// These exist because of a real bug: pausing during a transient phase dropped
// the scheduled transition, and the round could never leave that phase. It was
// only findable by driving a browser, because the phase machine was tangled up
// with the DOM. With the machine extracted and its scheduler injectable, the
// whole class of failure is reachable from `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { PHASE, createRoundFlow } = require(join(root, 'js', 'round.js'));

// A scheduler that never fires on its own: tests decide when time passes.
function manualScheduler() {
  let queue = [];
  let seq = 0;
  return {
    schedule(fn, delay) {
      const id = ++seq;
      queue.push({ id, fn, delay });
      return () => { queue = queue.filter(t => t.id !== id); };
    },
    get armed() { return queue.length; },
    get delays() { return queue.map(t => t.delay); },
    // Fire everything currently armed, oldest first.
    flush() {
      const due = queue;
      queue = [];
      due.forEach(t => t.fn());
    }
  };
}

const newFlow = () => {
  const clock = manualScheduler();
  return { clock, flow: createRoundFlow({ schedule: clock.schedule.bind(clock) }) };
};

test('a queued transition runs once its delay elapses', () => {
  const { clock, flow } = newFlow();
  let ran = 0;
  flow.begin(PHASE.ADVANCING, 100, () => { ran++; flow.set(PHASE.AWAITING); });

  assert.equal(flow.phase, PHASE.ADVANCING);
  assert.equal(flow.pendingPhase, PHASE.ADVANCING);
  clock.flush();
  assert.equal(ran, 1);
  assert.equal(flow.phase, PHASE.AWAITING);
  assert.equal(flow.pendingPhase, null);
});

test('pausing mid-transition keeps the transition and resume re-arms it', () => {
  for (const transient of [PHASE.ADVANCING, PHASE.PRESENTING]) {
    const { clock, flow } = newFlow();
    let ran = 0;
    flow.begin(transient, 100, () => { ran++; flow.set(PHASE.AWAITING); });

    assert.ok(flow.pause(), `${transient} should be pausable`);
    assert.equal(flow.phase, PHASE.PAUSED);
    assert.equal(clock.armed, 0, 'the timer must be cancelled while paused');
    assert.equal(flow.pendingPhase, transient, 'the transition must survive the pause');

    // Time passing while paused must not advance the round.
    clock.flush();
    assert.equal(ran, 0, `${transient}: a paused round must not advance`);

    assert.equal(flow.resume(), transient);
    assert.equal(clock.armed, 1, `${transient}: resume must re-arm the transition`);
    clock.flush();

    assert.equal(ran, 1, `${transient}: the round died instead of carrying on`);
    assert.equal(flow.phase, PHASE.AWAITING);
  }
});

test('a round survives being paused at every question boundary in a row', () => {
  // The original failure needed only one badly-timed pause. This walks a whole
  // round pausing inside every gap, which is what a player on a phone with
  // notifications actually experiences.
  const { clock, flow } = newFlow();
  let question = 0;
  const show = () => { question++; flow.set(PHASE.AWAITING); };

  flow.begin(PHASE.PRESENTING, 300, show);
  for (let i = 0; i < 10; i++) {
    flow.pause();
    clock.flush();            // time passes while the player is away
    flow.resume();
    clock.flush();            // the queued transition finally runs
    assert.equal(flow.phase, PHASE.AWAITING, `stalled at question ${i + 1}`);
    flow.set(PHASE.REVEALING);
    flow.begin(PHASE.ADVANCING, 100, show);
  }
  assert.equal(question, 10, 'every question after a pause should have rendered');
});

test('pausing a steady phase restores it without inventing a transition', () => {
  for (const steady of [PHASE.AWAITING, PHASE.REVEALING]) {
    const { clock, flow } = newFlow();
    flow.set(steady);
    assert.ok(flow.pause());
    assert.equal(flow.pendingPhase, null);
    assert.equal(flow.resume(), steady);
    assert.equal(clock.armed, 0, `${steady}: nothing should be scheduled`);
  }
});

test('pause is refused where it is meaningless, and resume outside a pause is a no-op', () => {
  for (const phase of [PHASE.IDLE, PHASE.ENDED]) {
    const { flow } = newFlow();
    flow.set(phase);
    assert.equal(flow.pause(), false, `${phase} must not be pausable`);
    assert.equal(flow.phase, phase);
  }
  const { flow } = newFlow();
  flow.set(PHASE.AWAITING);
  assert.ok(flow.pause());
  assert.ok(flow.pause() === false, 'pausing twice must not overwrite phaseBeforePause');
  assert.equal(flow.resume(), PHASE.AWAITING);
  assert.equal(flow.resume(), null, 'resuming an unpaused round does nothing');
});

test('ending or leaving a round drops a transition still in flight', () => {
  // endGame and backToStart both land here: whatever was queued must not fire
  // afterwards and drag the player back into a finished round.
  for (const landing of [PHASE.ENDED, PHASE.IDLE]) {
    const { clock, flow } = newFlow();
    let ran = 0;
    flow.begin(PHASE.ADVANCING, 100, () => ran++);
    flow.set(landing);
    assert.equal(flow.pendingPhase, null);
    clock.flush();
    assert.equal(ran, 0, `a transition fired after the round reached ${landing}`);
    assert.equal(flow.phase, landing);
  }
});

test('a transition dropped while paused does not fire on resume', () => {
  // Quitting from the pause overlay: the round ends while still paused.
  const { clock, flow } = newFlow();
  let ran = 0;
  flow.begin(PHASE.ADVANCING, 100, () => ran++);
  flow.pause();
  flow.set(PHASE.IDLE);         // quitFromPause → backToStart
  assert.equal(flow.resume(), null);
  clock.flush();
  assert.equal(ran, 0);
  assert.equal(flow.phase, PHASE.IDLE);
});

test('begin replaces an earlier transition rather than stacking on it', () => {
  const { clock, flow } = newFlow();
  const ran = [];
  flow.begin(PHASE.ADVANCING, 100, () => ran.push('first'));
  flow.begin(PHASE.ADVANCING, 100, () => ran.push('second'));
  assert.equal(clock.armed, 1, 'the superseded timer must be cancelled');
  clock.flush();
  assert.deepEqual(ran, ['second']);
});

test('isTransient marks exactly the phases that cannot move on their own', () => {
  assert.ok(flowIsTransient(PHASE.PRESENTING));
  assert.ok(flowIsTransient(PHASE.ADVANCING));
  for (const p of [PHASE.IDLE, PHASE.AWAITING, PHASE.REVEALING, PHASE.PAUSED, PHASE.ENDED]) {
    assert.ok(!flowIsTransient(p), `${p} should not be transient`);
  }
  function flowIsTransient(p) { return createRoundFlow().isTransient(p); }
});
