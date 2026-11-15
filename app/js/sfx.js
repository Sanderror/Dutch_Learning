// Short feedback sounds, generated on the phone with the Web Audio API: no
// files to download, so they work offline and cost nothing. A bright rising
// pair of notes for a right answer, a soft low falling note for a wrong one,
// and a small arpeggio when a lesson is finished. Wrong answers also give a
// short vibration where the phone allows it.
//
// The AudioContext is created on the first sound, which always follows a tap,
// so browsers that require a user gesture allow it.

/** Notes as [frequency in Hz, start offset in s, length in s]. */
export const PATTERNS = {
  correct: { wave: 'sine', gain: 0.18, notes: [[659.25, 0, 0.11], [987.77, 0.09, 0.18]] },
  wrong: { wave: 'triangle', gain: 0.16, notes: [[220, 0, 0.12], [174.61, 0.1, 0.22]] },
  finish: { wave: 'sine', gain: 0.16, notes: [[523.25, 0, 0.12], [659.25, 0.1, 0.12], [783.99, 0.2, 0.12], [1046.5, 0.3, 0.32]] },
};

/** How long the Dutch audio waits after a sound, so the two do not overlap. */
export const AFTER_MS = 320;

/**
 * @param {{win: any, enabled: () => boolean}} cfg
 */
export function createSfx({ win, enabled }) {
  let ctx = null;

  function context() {
    if (ctx) return ctx;
    const Ctor = win.AudioContext || win.webkitAudioContext;
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch (e) { ctx = null; }
    return ctx;
  }

  function play(name) {
    if (!enabled()) return false;
    const pattern = PATTERNS[name];
    const c = context();
    if (!pattern || !c) return false;
    try {
      if (c.state === 'suspended' && c.resume) c.resume();
      const t0 = c.currentTime + 0.01;
      for (const [freq, start, length] of pattern.notes) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = pattern.wave;
        osc.frequency.setValueAtTime(freq, t0 + start);
        // a quick attack and a smooth fade, so there is no click
        gain.gain.setValueAtTime(0.0001, t0 + start);
        gain.gain.exponentialRampToValueAtTime(pattern.gain, t0 + start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + length);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t0 + start);
        osc.stop(t0 + start + length + 0.02);
      }
    } catch (e) { return false; }
    if (name === 'wrong') {
      try { if (win.navigator && win.navigator.vibrate) win.navigator.vibrate(60); } catch (e) { /* optional */ }
    }
    return true;
  }

  return {
    correct: () => play('correct'),
    wrong: () => play('wrong'),
    finish: () => play('finish'),
    /** Milliseconds to wait before playing Dutch audio after a sound. */
    gap: () => (enabled() && context() ? AFTER_MS : 0),
  };
}
