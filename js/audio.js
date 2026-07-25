// ============================================================
// AUDIO ENGINE — Web Audio API synthesized sounds
// ============================================================
// Everything routes through a master gain so mute and volume are one place,
// and every envelope ends on a ramp: the old setValueAtTime step from full
// level to silence was an instant discontinuity, which is an audible click at
// the tail of every single sound effect.
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.initialized = false;
    this.muted = false;
    this.volume = 0.7;
  }

  init() {
    if (this.initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.initialized = true;
      this._applyGain();
    } catch (e) {
      console.warn('Audio not available');
    }
  }

  _applyGain() {
    if (!this.master) return;
    const level = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.01);
  }

  setMuted(val) {
    this.muted = !!val;
    this._applyGain();
  }

  // 0..1
  setVolume(val) {
    this.volume = Math.min(1, Math.max(0, Number(val) || 0));
    this._applyGain();
  }

  // Browsers suspend the context when the page is backgrounded — on iOS it
  // never resumes on its own, so without this the game goes permanently silent
  // after the player switches apps mid-round.
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  play(type) {
    if (!this.ctx || this.muted) return;
    this.resume();
    try {
      switch (type) {
        case 'correct': this._chord([[523, 0], [659, 0.1], [784, 0.2]], 'sine', 0.3, 0.4); break;
        case 'wrong':   this._chord([[200, 0], [150, 0.15]], 'sawtooth', 0.2, 0.35); break;
        case 'tick':    this._blip(880, 'sine', 0.08, 0.05); break;
        case 'start':   this._arpeggio([440, 554, 659, 880], 'sine', 0.2, 0.12, 0.15); break;
        case 'record':  this._arpeggio([523, 659, 784, 1047, 784, 1047], 'sine', 0.25, 0.1, 0.15); break;
        case 'timeup':  this._chord([[300, 0], [200, 0.2]], 'square', 0.15, 0.4); break;
        case 'streak':  this._arpeggio([660, 880, 1100], 'triangle', 0.2, 0.08, 0.12); break;
        case 'click':   this._blip(600, 'sine', 0.1, 0.05); break;
        case 'achieve': this._arpeggio([523, 784, 1047, 1319], 'triangle', 0.22, 0.09, 0.2); break;
      }
    } catch (e) { /* a dropped sound must never interrupt a round */ }
  }

  // ---- primitives ----
  // exponentialRampToValueAtTime cannot reach 0, so envelopes decay to a value
  // far below hearing and the node is stopped there.
  _envelope(gain, t, peak, duration) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  }

  _voice(type, t, peak, duration) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.master);
    osc.type = type;
    this._envelope(gain, t, peak, duration);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    return osc;
  }

  // A single tone.
  _blip(freq, type, peak, duration) {
    const t = this.ctx.currentTime;
    this._voice(type, t, peak, duration).frequency.setValueAtTime(freq, t);
  }

  // One voice stepping through [freq, offset] pairs under a single envelope.
  _chord(steps, type, peak, duration) {
    const t = this.ctx.currentTime;
    const osc = this._voice(type, t, peak, duration);
    steps.forEach(([f, offset]) => osc.frequency.setValueAtTime(f, t + offset));
  }

  // Separate voices, one per note, each with its own envelope.
  _arpeggio(freqs, type, peak, spacing, duration) {
    const t = this.ctx.currentTime;
    freqs.forEach((f, i) => {
      const at = t + i * spacing;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.master);
      osc.type = type;
      osc.frequency.setValueAtTime(f, at);
      this._envelope(gain, at, peak, duration);
      osc.start(at);
      osc.stop(at + duration + 0.02);
    });
  }
}
