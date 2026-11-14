// Plays Dutch audio. Recorded files (built by tools/build_audio.py) are used
// when they exist; otherwise the phone's own Dutch voice reads the text, so
// listening exercises work before the audio has been generated.

export async function loadAudioIndex(base, fetchFn) {
  try {
    const res = await fetchFn(base + 'index.json', { cache: 'no-cache' });
    if (!res.ok) return {};
    const data = await res.json();
    return data.files || {};
  } catch (e) { return {}; }
}

/**
 * @param {{base: string, index: Record<string,string>, win: any, isSlow: () => boolean}} cfg
 */
export function createAudio({ base, index, win, isSlow }) {
  let el = null;
  const hasFiles = Object.keys(index).length > 0;
  const hasVoice = !!(win.speechSynthesis && win.SpeechSynthesisUtterance);

  /** "@Emma|Hallo!" is a dialogue line spoken by Emma; the text is after the bar. */
  function textOf(key) { return key.startsWith('@') ? key.slice(key.indexOf('|') + 1) : key; }
  function fileOf(key) { return index[key] || index[textOf(key)] || null; }

  function speak(text, slow) {
    if (!hasVoice) return false;
    try {
      win.speechSynthesis.cancel();
      const u = new win.SpeechSynthesisUtterance(text);
      u.lang = 'nl-NL';
      u.rate = slow ? 0.7 : 0.95;
      win.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  return {
    /** Can listening exercises be offered at all? */
    can() { return hasFiles || hasVoice; },
    source(key) { return fileOf(key) ? 'file' : (hasVoice ? 'voice' : 'none'); },

    play(key, opts = {}) {
      const slow = opts.slow !== undefined ? opts.slow : isSlow();
      const file = fileOf(key);
      if (!file) return speak(textOf(key), slow);
      try {
        if (!el) el = new win.Audio();
        el.pause();
        el.src = base + file;
        el.preservesPitch = true;
        el.playbackRate = slow ? 0.75 : 1;
        const p = el.play();
        if (p && p.catch) p.catch(() => speak(textOf(key), slow));   // file missing or blocked: fall back
        return true;
      } catch (e) { return speak(textOf(key), slow); }
    },

    stop() {
      try { if (el) el.pause(); if (hasVoice) win.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    },
  };
}
