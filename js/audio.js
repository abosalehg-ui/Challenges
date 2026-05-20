// ============================================================
// AUDIO ENGINE — Web Audio API synthesized sounds
// ============================================================
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.initialized = false;
    this.muted = false;
  }

  init() {
    if (this.initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.initialized = true;
    } catch(e) { console.log("Audio not available"); }
  }

  setMuted(val) { this.muted = !!val; }

  play(type) {
    if (!this.ctx || this.muted) return;
    try {
      switch(type) {
        case 'correct': this._playCorrect(); break;
        case 'wrong': this._playWrong(); break;
        case 'tick': this._playTick(); break;
        case 'start': this._playStart(); break;
        case 'record': this._playRecord(); break;
        case 'timeup': this._playTimeUp(); break;
        case 'streak': this._playStreak(); break;
        case 'click': this._playClick(); break;
        case 'achieve': this._playAchieve(); break;
      }
    } catch(e) {}
  }

  _playCorrect() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523, t);
    osc.frequency.setValueAtTime(659, t + 0.1);
    osc.frequency.setValueAtTime(784, t + 0.2);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.setValueAtTime(0.01, t + 0.4);
    osc.start(t); osc.stop(t + 0.4);
  }

  _playWrong() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.setValueAtTime(150, t + 0.15);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.setValueAtTime(0.01, t + 0.35);
    osc.start(t); osc.stop(t + 0.35);
  }

  _playTick() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.setValueAtTime(0.0, t + 0.05);
    osc.start(t); osc.stop(t + 0.06);
  }

  _playStart() {
    const t = this.ctx.currentTime;
    [440, 554, 659, 880].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + i * 0.12);
      gain.gain.setValueAtTime(0.2, t + i * 0.12);
      gain.gain.setValueAtTime(0.01, t + i * 0.12 + 0.15);
      osc.start(t + i * 0.12); osc.stop(t + i * 0.12 + 0.15);
    });
  }

  _playRecord() {
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + i * 0.1);
      gain.gain.setValueAtTime(0.25, t + i * 0.1);
      gain.gain.setValueAtTime(0.01, t + i * 0.1 + 0.12);
      osc.start(t + i * 0.1); osc.stop(t + i * 0.1 + 0.15);
    });
  }

  _playTimeUp() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.setValueAtTime(200, t + 0.2);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.setValueAtTime(0.01, t + 0.4);
    osc.start(t); osc.stop(t + 0.4);
  }

  _playStreak() {
    const t = this.ctx.currentTime;
    [660, 880, 1100].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t + i * 0.08);
      gain.gain.setValueAtTime(0.2, t + i * 0.08);
      gain.gain.setValueAtTime(0.01, t + i * 0.08 + 0.1);
      osc.start(t + i * 0.08); osc.stop(t + i * 0.08 + 0.12);
    });
  }

  _playClick() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.setValueAtTime(0.0, t + 0.04);
    osc.start(t); osc.stop(t + 0.05);
  }

  _playAchieve() {
    const t = this.ctx.currentTime;
    [523, 784, 1047, 1319].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t + i * 0.09);
      gain.gain.setValueAtTime(0.22, t + i * 0.09);
      gain.gain.setValueAtTime(0.01, t + i * 0.09 + 0.18);
      osc.start(t + i * 0.09); osc.stop(t + i * 0.09 + 0.2);
    });
  }
}
