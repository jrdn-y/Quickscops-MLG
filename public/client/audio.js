// Synthesized sound effects (no audio files) and a speech-synthesis announcer.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let AC = null, master, noiseBuf;
export const audioCfg = { vol: 0.6, announcer: true };

export function ac() {
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    master = AC.createGain(); master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  master.gain.value = audioCfg.vol;
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function noise(t, dur, freq, type, gain, out, endFreq) {
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
  if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + dur + 0.05);
}
function tone(t, dur, freq, type, gain, out, endFreq) {
  const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
}
function bus(vol = 1, pan = 0) {
  const g = AC.createGain(); g.gain.value = vol;
  if (AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p).connect(master); }
  else g.connect(master);
  return g;
}
const go = fn => (...a) => { if (ac()) fn(AC.currentTime, ...a); };

export const sfx = {
  shot: go((t, key = 'intervention', vol = 1, pan = 0) => {
    const o = bus(vol, pan), heavy = key === 'barrett';
    noise(t, heavy ? 0.7 : 0.5, 7000, 'lowpass', heavy ? 1.3 : 1.1, o, 220);
    tone(t, heavy ? 0.4 : 0.28, heavy ? 110 : 150, 'sine', 0.9, o, 35);
    noise(t + 0.16, 0.8, 900, 'lowpass', 0.25, o, 180);
  }),
  bolt: go((t, delay = 0.35) => {
    const o = bus(0.6);
    noise(t + delay, 0.04, 2600, 'bandpass', 0.6, o); noise(t + delay + 0.22, 0.05, 1800, 'bandpass', 0.6, o);
    noise(t + delay + 0.45, 0.04, 3000, 'bandpass', 0.5, o);
  }),
  reload: go((t, dur = 2.5) => {
    const o = bus(0.5);
    noise(t + 0.2, 0.05, 1500, 'bandpass', 0.6, o);
    noise(t + dur * 0.5, 0.06, 1200, 'bandpass', 0.7, o);
    noise(t + dur * 0.85, 0.05, 2600, 'bandpass', 0.6, o);
  }),
  dry: go(t => tone(t, 0.03, 1200, 'square', 0.12, bus(0.4))),
  step: go((t, vol = 0.3, pan = 0) => noise(t, 0.07, 500, 'lowpass', 0.8, bus(vol, pan), 120)),
  hit: go(t => tone(t, 0.06, 1700, 'square', 0.25, bus(0.5))),
  kill: go(t => { const o = bus(0.5); tone(t, 0.3, 880, 'triangle', 0.4, o); tone(t + 0.07, 0.35, 1320, 'triangle', 0.3, o); }),
  death: go(t => tone(t, 0.6, 220, 'sawtooth', 0.25, bus(0.6), 50)),
  deny: go(t => { const o = bus(0.5); tone(t, 0.18, 180, 'square', 0.25, o); tone(t + 0.2, 0.25, 140, 'square', 0.25, o); }),
  horn: go(t => {
    const o = bus(0.35);
    for (const [i, f] of [[0, 440], [0, 554], [0, 659], [0.32, 440], [0.32, 554], [0.32, 659]])
      tone(t + i, 0.28, f * (1 + Math.random() * 0.01), 'sawtooth', 0.3, o, f * 0.96);
  }),
  click: go(t => tone(t, 0.04, 900, 'square', 0.15, bus(0.3))),
  whoosh: go(t => noise(t, 0.25, 2500, 'bandpass', 0.5, bus(0.5), 600)),
  beep: go((t, hi) => tone(t, 0.08, hi ? 1600 : 1100, 'sine', 0.3, bus(0.4))),
  boom: go((t, vol = 1, pan = 0) => { const o = bus(vol, pan); noise(t, 1.6, 2500, 'lowpass', 1.4, o, 60); tone(t, 0.9, 80, 'sine', 1, o, 25); }),
  breath: go(t => noise(t, 0.5, 600, 'bandpass', 0.25, bus(0.4), 300)),
};

export function announce(text) {
  if (!audioCfg.announcer || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 0.8; u.volume = audioCfg.vol;
    speechSynthesis.speak(u);
  } catch {}
}
