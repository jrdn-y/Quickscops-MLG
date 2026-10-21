import * as THREE from '/vendor/three/three.module.js';
import { BOXES, EYE, EYE_CROUCH, rayBoxes, stepBody, pointFree } from '/shared/map.js';
import { Match, RULES } from '/shared/match.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = () => Math.random() + Math.random() - 1;
const fwd = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const turn = (a, b, max) => a + clamp(angDiff(a, b), -max, max);
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// ---------- settings ----------
const DEFAULTS = { name: '', sens: 1, psens: 1.2, dz: 0.15, fov: 80, vol: 0.6, mlg: true, rumble: true, invy: false };
let cfg = { ...DEFAULTS };
try { Object.assign(cfg, JSON.parse(localStorage.getItem('qs-cfg') || '{}')); } catch {}
const saveCfg = () => { try { localStorage.setItem('qs-cfg', JSON.stringify(cfg)); } catch {} };
$('name').value = cfg.name;
$('name').oninput = () => { cfg.name = $('name').value; saveCfg(); };
for (const k of ['sens', 'psens', 'dz', 'fov', 'vol']) { $(k).value = cfg[k]; $(k).oninput = () => { cfg[k] = +$(k).value; saveCfg(); }; }
for (const k of ['mlg', 'rumble', 'invy']) { $(k).checked = cfg[k]; $(k).onchange = () => { cfg[k] = $(k).checked; saveCfg(); }; }

// ---------- audio ----------
let AC = null, master, noiseBuf;
function ac() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  master.gain.value = cfg.vol;
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function noise(t, dur, freq, type, gain, out, endFreq) {
  const a = AC, s = a.createBufferSource(); s.buffer = noiseBuf;
  const f = a.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
  if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  const g = a.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + dur + 0.05);
}
function tone(t, dur, freq, type, gain, out, endFreq) {
  const a = AC, o = a.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  const g = a.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
}
function bus(vol = 1, pan = 0) {
  const g = AC.createGain(); g.gain.value = vol;
  if (AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p).connect(master); }
  else g.connect(master);
  return g;
}
const sfx = {
  shot(vol = 1, pan = 0) {
    if (!ac()) return; const t = AC.currentTime, o = bus(vol, pan);
    noise(t, 0.5, 7000, 'lowpass', 1.1, o, 250);
    tone(t, 0.28, 150, 'sine', 0.9, o, 38);
    noise(t + 0.16, 0.7, 900, 'lowpass', 0.25, o, 200);
  },
  bolt() {
    if (!ac()) return; const t = AC.currentTime, o = bus(0.6);
    noise(t + 0.4, 0.04, 2600, 'bandpass', 0.6, o); noise(t + 0.62, 0.05, 1800, 'bandpass', 0.6, o);
    noise(t + 0.85, 0.04, 3000, 'bandpass', 0.5, o);
  },
  hit() { if (!ac()) return; const t = AC.currentTime, o = bus(0.5); tone(t, 0.06, 1700, 'square', 0.25, o); },
  kill() { if (!ac()) return; const t = AC.currentTime, o = bus(0.5); tone(t, 0.3, 880, 'triangle', 0.4, o); tone(t + 0.07, 0.35, 1320, 'triangle', 0.3, o); },
  death() { if (!ac()) return; const t = AC.currentTime, o = bus(0.6); tone(t, 0.6, 220, 'sawtooth', 0.25, o, 50); },
  horn() {
    if (!ac()) return; const t = AC.currentTime, o = bus(0.35);
    for (const [i, f] of [[0, 440], [0, 554], [0, 659], [0.32, 440], [0.32, 554], [0.32, 659]])
      tone(t + i, 0.28, f * (1 + Math.random() * 0.01), 'sawtooth', 0.3, o, f * 0.96);
  },
  click() { if (!ac()) return; const t = AC.currentTime, o = bus(0.3); tone(t, 0.04, 900, 'square', 0.15, o); },
};

// ---------- renderer & world ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(cfg.fov, 1, 0.05, 600);
camera.rotation.order = 'YXZ';
const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(62, 1, 0.01, 10);

{
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#5d8fc7'); gr.addColorStop(0.55, '#a9c6df'); gr.addColorStop(1, '#d9d2c0');
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
scene.fog = new THREE.Fog(0xb8c8d6, 70, 260);
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x6b5a45, 1.4));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.position.set(30, 50, 18); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 35, bottom: -35, near: 1, far: 140 });
sun.shadow.bias = -0.0005;
scene.add(sun);
vmScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));

function makeTex(base, variance, draw, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * variance; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  if (draw) draw(g, size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const TEX = {
  ground: makeTex('#7d7462', 26, (g, s) => { g.strokeStyle = '#0002'; g.lineWidth = 2; g.strokeRect(0, 0, s, s); }),
  wall: makeTex('#8d8f8c', 22, (g, s) => { g.fillStyle = '#0001'; for (let y = 0; y < s; y += 32) g.fillRect(0, y, s, 2); }),
  crate: makeTex('#9a7543', 30, (g, s) => {
    g.strokeStyle = '#3d2a14'; g.lineWidth = 5; g.strokeRect(3, 3, s - 6, s - 6);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s); g.stroke();
  }),
  platform: makeTex('#5f6b70', 18, (g, s) => { g.strokeStyle = '#0003'; g.lineWidth = 3; g.strokeRect(0, 0, s, s); g.strokeRect(0, 0, s / 2, s / 2); }),
};
const MATS = {};
for (const k of Object.keys(TEX)) MATS[k] = new THREE.MeshLambertMaterial({ map: TEX[k] });

function boxMesh(min, max, mat, tile) {
  const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  const m = new THREE.Mesh(geo, mat);
  m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  m.castShadow = m.receiveShadow = true;
  return m;
}
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(74, 54), MATS.ground);
  TEX.ground.repeat.set(74 / 3, 54 / 3);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshLambertMaterial({ color: 0x6f6957 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; scene.add(outer);
  for (const b of BOXES) scene.add(boxMesh(b.min, b.max, MATS[b.kind], b.kind === 'crate' ? 1.25 : 3));
  // skyline
  const sk = new THREE.MeshLambertMaterial({ color: 0x8e9499 });
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2, r = 70 + Math.random() * 60, w = 6 + Math.random() * 14, h = 8 + Math.random() * 30;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), sk);
    m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); scene.add(m);
  }
}

// ---------- avatars, viewmodel, fx ----------
const SKIN = new THREE.MeshLambertMaterial({ color: 0xc89f78 });
const GUN = new THREE.MeshLambertMaterial({ color: 0x23262a });
function nameSprite(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d'); g.font = 'bold 30px system-ui'; g.textAlign = 'center';
  g.fillStyle = '#000a'; g.fillText(text, 129, 35); g.fillStyle = '#7fb2ff'; g.fillText(text, 128, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.3, 1); s.position.y = 2.25; s.renderOrder = 10;
  return s;
}
function makeAvatar(friendly, name) {
  const color = friendly ? 0x2f6fe0 : 0xc93434;
  const mat = new THREE.MeshLambertMaterial({ color }), dark = new THREE.MeshLambertMaterial({ color: friendly ? 0x1d3566 : 0x5a1c1c });
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const body = new THREE.Group(); g.add(body);
  const add = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; body.add(o); return o; };
  add(0.2, 0.85, 0.24, -0.13, 0.43, 0, dark); add(0.2, 0.85, 0.24, 0.13, 0.43, 0, dark);
  add(0.56, 0.66, 0.32, 0, 1.18, 0, mat);
  add(0.29, 0.3, 0.29, 0, 1.67, 0, SKIN);
  add(0.31, 0.12, 0.31, 0, 1.83, 0, dark);
  add(0.14, 0.5, 0.14, 0.33, 1.2, -0.18, mat).rotation.x = -1.1;
  add(0.07, 0.1, 1.25, 0.2, 1.36, -0.45, GUN);
  add(0.06, 0.06, 0.3, 0.2, 1.45, -0.35, GUN);
  if (friendly && name) g.add(nameSprite(name));
  scene.add(g);
  return { g, body };
}

const vm = new THREE.Group();
{
  const add = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), GUN); m.position.set(x, y, z); vm.add(m); return m; };
  add(0.035, 0.035, 0.85, 0, 0, -0.55);
  add(0.075, 0.11, 0.55, 0, -0.03, -0.02);
  add(0.06, 0.15, 0.32, 0, -0.06, 0.35);
  add(0.04, 0.16, 0.05, 0, -0.14, 0.12);
  const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.36, 12), GUN); sc.rotation.x = Math.PI / 2; sc.position.set(0, 0.075, -0.05); vm.add(sc);
  const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), GUN); bolt.position.set(0.06, 0.02, 0.1); vm.add(bolt); vm.userData.bolt = bolt;
  const fl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd36a })); fl.position.set(0, 0, -1.0); fl.visible = false; vm.add(fl); vm.userData.flash = fl;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.5), new THREE.MeshLambertMaterial({ color: 0x4b5a3a })); arm.position.set(0.02, -0.15, 0.35); arm.rotation.x = 0.4; vm.add(arm);
}
vm.scale.setScalar(0.7);
vmScene.add(vm);

const tracers = [];
function tracer(o, d, end) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o[0], o[1] - 0.1, o[2]), new THREE.Vector3(o[0] + d[0] * end, o[1] + d[1] * end, o[2] + d[2] * end)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.9 }));
  scene.add(line); tracers.push({ line, t: 0.35 });
}

// ---------- game state ----------
const G = { on: false, kind: null, t: 0, me: 0, players: new Map(), phase: 'waiting', round: 0, scores: [0, 0], timerEnd: 0,
  teamSize: 2, match: null, bots: [], paused: false, menuOpen: false, over: false, myTeam: 0, spec: null, warmup: false, lastSend: 0 };
const L = { pos: [0, 0, 0], vel: [0, 0, 0], grounded: true, yaw: 0, pitch: 0, crouch: false, ads: 0, scopeStart: 0, lastShot: -99, alive: false, recoil: 0, sprint: false };
let inputMode = 'kb';

function screen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === name));
  focusFirst();
}
function focusFirst() {
  const scr = document.querySelector('.screen.on');
  document.querySelectorAll('.focus').forEach(e => e.classList.remove('focus'));
  if (scr && inputMode === 'pad') { const b = scr.querySelector('button'); if (b) { b.focus(); b.classList.add('focus'); } }
}

let bannerTimer = 0;
function banner(text, ms = 1800, color = '#fff') {
  const b = $('banner'); b.innerHTML = text; b.style.color = color; b.style.opacity = 1;
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => (b.style.opacity = 0), ms);
}
function medal(text) {
  const m = $('medal'); m.textContent = text; m.classList.remove('pop'); void m.offsetWidth; m.classList.add('pop');
}
function feed(html) {
  const d = document.createElement('div'); d.innerHTML = html; $('feed').prepend(d);
  const br = document.createElement('br'); d.after(br);
  setTimeout(() => { d.remove(); br.remove(); }, 6000);
}
const pname = p => {
  if (!p) return '?';
  const c = p.team === G.myTeam ? '#7fb2ff' : '#ff7a7a';
  return `<span style="color:${c}">${p.name.replace(/[<>&]/g, '')}</span>`;
};
function rumble(strong, weak, ms) {
  if (!cfg.rumble || inputMode !== 'pad') return;
  const gp = PAD && PAD.gp;
  try { gp && gp.vibrationActuator && gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch {}
}

function clearPlayers() {
  for (const p of G.players.values()) if (p.mesh) scene.remove(p.mesh.g);
  G.players.clear();
}

function beginMatch(me, roster, teamSize, kind) {
  clearPlayers();
  G.me = me; G.kind = kind; G.teamSize = teamSize; G.on = true; G.over = false; G.paused = false; G.menuOpen = false;
  G.scores = [0, 0]; G.round = 0; G.phase = 'waiting'; G.spec = null; G.warmup = false;
  G.myTeam = roster.find(r => r.id === me).team;
  for (const r of roster) {
    const p = { id: r.id, name: r.name, team: r.team, alive: false, pos: [0, 0, 0], tpos: [0, 0, 0], yaw: 0, tyaw: 0, pitch: 0, crouch: false, ads: 0, kills: 0, deaths: 0 };
    if (r.id !== me) p.mesh = makeAvatar(r.team === G.myTeam, r.name);
    G.players.set(r.id, p);
  }
  L.alive = false;
  $('feed').innerHTML = '';
  $('hud').classList.add('on');
  screen(null);
  lockPointer();
  banner(`${teamSize}v${teamSize} · MLG Quickscope`, 1500, '#ffd400');
}

function spawnLocal(s) {
  L.pos[0] = s[0]; L.pos[1] = s[1]; L.pos[2] = s[2];
  L.vel = [0, 0, 0]; L.yaw = s[3]; L.pitch = 0; L.alive = true; L.ads = 0; L.lastShot = -99; L.crouch = false; padCrouch = false;
  G.spec = null;
}

function onMsg(m) {
  switch (m.t) {
    case 'online': $('online').textContent = `● ${m.n} online`; break;
    case 'queue': $('qtext').textContent = `${m.mode}: ${m.have}/${m.need} players found. Match starts when the lobby is full.`; break;
    case 'match': beginMatch(m.you, m.players, m.teamSize, 'online'); break;
    case 'round': {
      G.phase = m.phase === 'end' ? 'roundend' : m.phase;
      G.round = m.n; G.scores = m.scores; G.timerEnd = G.t + (m.dur || 0); G.warmup = !!m.warmup;
      if (m.spawns) for (const k in m.spawns) {
        const id = Number(k), s = m.spawns[k], p = G.players.get(id);
        if (!p) continue;
        p.alive = true; p.pos = [s[0], s[1], s[2]]; p.tpos = [s[0], s[1], s[2]]; p.yaw = p.tyaw = s[3];
        if (id === G.me) spawnLocal(s);
      }
      if (m.warmup) banner('Warmup — free play', 2000, '#ffd400');
      else if (m.phase === 'countdown') banner(`Round ${m.n}<br><span style="font-size:22px">Intervention only · get ready</span>`, RULES.countdown * 1000 - 300);
      else if (m.phase === 'live') { banner('GO!', 700, '#ffd400'); sfx.click(); }
      else if (m.phase === 'end') {
        const won = m.winner === G.myTeam;
        banner(m.winner < 0 ? 'Round draw' : won ? 'Round won' : 'Round lost', 3000, m.winner < 0 ? '#fff' : won ? '#7fb2ff' : '#ff7a7a');
      }
      break;
    }
    case 'spawn': {
      const p = G.players.get(m.id); if (!p) break;
      p.alive = true; p.pos = [...m.pos]; p.tpos = [...m.pos]; p.yaw = p.tyaw = m.yaw;
      if (m.id === G.me) spawnLocal([...m.pos, m.yaw]);
      break;
    }
    case 'snap':
      for (const [id, x, y, z, yaw, pitch, c, ads, alive] of m.p) {
        if (id === G.me) continue;
        const p = G.players.get(id); if (!p) continue;
        p.tpos = [x, y, z]; p.tyaw = yaw; p.pitch = pitch; p.crouch = !!c; p.ads = ads; p.alive = !!alive;
      }
      break;
    case 'shot': {
      if (m.id === G.me) break;
      tracer(m.o, m.d, m.end);
      const v = new THREE.Vector3(m.o[0], m.o[1], m.o[2]).applyMatrix4(camera.matrixWorldInverse);
      const dist = v.length();
      sfx.shot(1 / (1 + dist / 18), v.x / (dist + 1));
      break;
    }
    case 'kill': {
      const K = G.players.get(m.killer), V = G.players.get(m.victim);
      if (V) { V.alive = false; V.deaths++; }
      if (K) K.kills++;
      const tags = m.medals.length ? ` <span style="color:#ffd400">[${m.medals.join(' ')}]</span>` : '';
      feed(`${pname(K)} ⌖ ${pname(V)}${tags}`);
      if (m.victim === G.me) {
        L.alive = false; L.ads = 0; G.spec = m.killer; sfx.death(); rumble(1, 0.6, 400);
        banner(`Killed by ${pname(K)}`, 2000);
      }
      if (m.killer === G.me) {
        const h = $('hit'); h.classList.add('on'); setTimeout(() => h.classList.remove('on'), 60);
        sfx.hit(); setTimeout(sfx.kill, 60); rumble(0.4, 0.8, 150);
        const big = m.medals.includes('QUICKSCOPE') || m.medals.includes('NO-SCOPE');
        medal(m.medals.length ? m.medals.join(' + ') : 'KILL');
        if (cfg.mlg && big) {
          sfx.horn();
          const f = $('flash'); f.style.transition = 'none'; f.style.opacity = 0.5;
          requestAnimationFrame(() => { f.style.transition = 'opacity .6s'; f.style.opacity = 0; });
        }
      }
      break;
    }
    case 'left': {
      const p = G.players.get(m.id);
      if (p) { feed(`${pname(p)} left the match`); if (p.mesh) scene.remove(p.mesh.g); G.players.delete(m.id); }
      break;
    }
    case 'over': {
      G.over = true; G.phase = 'over';
      const won = m.winner === G.myTeam;
      $('endtitle').textContent = won ? 'Victory' : 'Defeat';
      $('endtitle').style.color = won ? '#7fb2ff' : '#ff7a7a';
      $('endsub').textContent = `Final score ${m.scores[G.myTeam]} – ${m.scores[1 - G.myTeam]}`;
      if (won && cfg.mlg) sfx.horn();
      unlockPointer();
      setTimeout(() => { if (G.over) screen('end'); }, 2500);
      break;
    }
  }
}

// ---------- networking ----------
let ws = null;
function connect() {
  if (location.protocol === 'file:') { $('online').textContent = 'Offline (run the server for multiplayer)'; return; }
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onopen = () => ($('online').textContent = '● Connected');
  ws.onclose = () => {
    $('online').textContent = 'Server offline — practice still works';
    if (G.on && G.kind === 'online') { leave(); banner('Disconnected', 2500); }
    if (document.querySelector('#queue.on')) screen('menu');
    setTimeout(connect, 3000);
  };
}
connect();
function send(m) {
  if (G.kind === 'practice') {
    if (!G.match) return;
    if (m.t === 'state') G.match.setState(G.me, m);
    else if (m.t === 'shot') G.match.shoot(G.me, m.o, m.d, m.meta);
    return;
  }
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
}

// ---------- practice + bots ----------
const BOTNAMES = ['xXSn1perXx', 'NoScopeNate', 'QuickzKing', 'Hitmarker', 'ScopeLord', 'DewDrinker', 'Trickshotz', 'InterventionGod', 'BoltCycle', 'LongshotLou', 'Dropshot_Dan', 'MLG_Pr0', 'Spawn_Trap', 'L33tScope'];
const DIFF = {
  easy: { react: 0.9, err: 0.05, turn: 3, speed: 0.8, jump: 0 },
  medium: { react: 0.55, err: 0.024, turn: 6, speed: 0.9, jump: 0.1 },
  hard: { react: 0.32, err: 0.012, turn: 10, speed: 1, jump: 0.25 },
  pro: { react: 0.18, err: 0.006, turn: 16, speed: 1, jump: 0.4 },
};
function randomWaypoint() {
  for (let i = 0; i < 40; i++) {
    const x = (Math.random() * 2 - 1) * 33, z = (Math.random() * 2 - 1) * 23;
    if (pointFree(x, z)) return [x, z];
  }
  return [0, 0];
}
function startPractice() {
  const ts = +$('pteam').value, diff = $('pdiff').value, warm = $('pwarm').checked;
  const names = BOTNAMES.slice().sort(() => Math.random() - 0.5);
  const roster = [{ id: 1, name: cfg.name || 'You', team: 0 }];
  let id = 100;
  for (let i = 1; i < ts; i++) roster.push({ id: id++, name: names.pop(), team: 0, bot: true });
  for (let i = 0; i < ts; i++) roster.push({ id: id++, name: names.pop(), team: 1, bot: true });
  const m = new Match({ teamSize: ts, warmup: warm, emit: msg => onMsg(msg) });
  for (const r of roster) m.addPlayer(r);
  G.match = m;
  beginMatch(1, roster, ts, 'practice');
  G.bots = roster.filter(r => r.bot).map(r => {
    const p = m.players.get(r.id);
    return { p, d: DIFF[diff], body: { pos: p.pos, vel: [0, 0, 0], grounded: true }, wp: null, chk: [0, 0], chkT: 0, seen: 0, tgt: null, strafe: 1, strafeT: 0, scopeT0: 0 };
  });
  setTimeout(() => G.match === m && m.start(), 800);
}
function updateBots(dt) {
  const m = G.match;
  for (const b of G.bots) {
    const p = b.p;
    if (!m.players.has(p.id)) continue;
    if (!p.alive || m.phase !== 'live') {
      b.body.vel[0] = b.body.vel[2] = 0; b.seen = 0; b.tgt = null; p.ads = 0; b.wp = null;
      if (p.alive) { p.yaw += 0; stepBody(b.body, dt, 0, 0, 0, false, false); }
      continue;
    }
    const eye = [p.pos[0], p.pos[1] + EYE, p.pos[2]];
    let tgt = null, best = 1e9, dir = null;
    for (const v of m.players.values()) {
      if (!v.alive || v.team === p.team) continue;
      const aim = [v.pos[0], v.pos[1] + (v.crouch ? 0.9 : 1.3), v.pos[2]];
      const dx = aim[0] - eye[0], dy = aim[1] - eye[1], dz = aim[2] - eye[2], dist = Math.hypot(dx, dy, dz);
      if (dist > 95 || dist > best) continue;
      const dd = [dx / dist, dy / dist, dz / dist], hl = Math.hypot(dd[0], dd[2]) || 1;
      const facing = (-Math.sin(p.yaw) * dd[0] - Math.cos(p.yaw) * dd[2]) / hl;
      if (facing < 0.1 && b.tgt !== v && dist > 7) continue;
      if (rayBoxes(eye, dd, dist) < dist - 0.3) continue;
      best = dist; tgt = v; dir = dd;
    }
    if (tgt !== b.tgt) b.seen = 0;
    b.tgt = tgt;
    let wx = 0, wz = 0, speed = 5.2 * b.d.speed, jump = false;
    const cycling = m.time - p.lastShot < RULES.bolt;
    if (tgt) {
      b.seen += dt;
      const ty = Math.atan2(-dir[0], -dir[2]), tp = Math.asin(clamp(dir[1], -1, 1));
      p.yaw = turn(p.yaw, ty, b.d.turn * dt);
      p.pitch += clamp(tp - p.pitch, -b.d.turn * dt, b.d.turn * dt);
      if (cycling) p.ads = 0;
      else if (b.seen > b.d.react * 0.5) { if (p.ads === 0) b.scopeT0 = m.time; p.ads = Math.min(1, p.ads + dt / 0.22); }
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeT = 0.5 + Math.random() * 0.9; jump = Math.random() < b.d.jump; }
      wx = Math.cos(p.yaw) * b.strafe; wz = -Math.sin(p.yaw) * b.strafe;
      speed *= p.ads > 0 ? 0.45 : 0.75;
      if (!cycling && p.ads >= 1 && b.seen > b.d.react && Math.abs(angDiff(p.yaw, ty)) < 0.06) {
        const e = b.d.err * (best > 40 ? 1.3 : 1);
        const d2 = norm([dir[0] + rnd() * e, dir[1] + rnd() * e, dir[2] + rnd() * e]);
        m.shoot(p.id, eye, d2, { ads: 1, scopeT: m.time - b.scopeT0, air: !b.body.grounded });
        p.ads = 0;
      }
    } else {
      p.ads = Math.max(0, p.ads - dt * 5);
      if (!b.wp || Math.hypot(b.wp[0] - p.pos[0], b.wp[1] - p.pos[2]) < 1.5) b.wp = randomWaypoint();
      const dx = b.wp[0] - p.pos[0], dz = b.wp[1] - p.pos[2], l = Math.hypot(dx, dz) || 1;
      wx = dx / l; wz = dz / l; speed = 6.4 * b.d.speed;
      p.yaw = turn(p.yaw, Math.atan2(-wx, -wz), 5 * dt); p.pitch *= 0.9;
    }
    b.chkT += dt;
    if (b.chkT > 1) {
      if ((wx || wz) && Math.hypot(p.pos[0] - b.chk[0], p.pos[2] - b.chk[1]) < 0.6) { b.wp = randomWaypoint(); jump = true; b.strafe *= -1; }
      b.chk = [p.pos[0], p.pos[2]]; b.chkT = 0;
    }
    stepBody(b.body, dt, wx, wz, speed, jump, false);
  }
}

// ---------- input ----------
const keys = new Set();
let mdx = 0, mdy = 0, rmb = false, fireQueued = false, padCrouch = false, padSprint = false;
const locked = () => document.pointerLockElement === canvas;
function lockPointer() { if (inputMode !== 'kb') return; try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch {} }
function unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  inputMode = 'kb';
  keys.add(e.code);
  if (e.code === 'Tab') e.preventDefault();
  if (e.code === 'Escape' && G.on && !G.over && G.menuOpen) resume();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('mousemove', e => { if (locked()) { mdx += e.movementX; mdy += e.movementY; inputMode = 'kb'; } });
canvas.addEventListener('mousedown', e => {
  ac();
  if (!G.on || G.menuOpen) return;
  if (!locked()) { inputMode = 'kb'; lockPointer(); return; }
  if (e.button === 0) { fireQueued = true; if (!L.alive) cycleSpec(1); }
  if (e.button === 2) rmb = true;
});
addEventListener('mouseup', e => { if (e.button === 2) rmb = false; });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  if (!locked() && G.on && !G.over && !G.menuOpen && inputMode === 'kb') pause();
});
addEventListener('gamepadconnected', e => { $('padhint').textContent = '🎮 Controller ready'; });
addEventListener('gamepaddisconnected', () => { $('padhint').textContent = ''; });

let PAD = null, padPrev = [], padPrevY = 0;
function pollPad() {
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const g of gps) if (g && g.connected) { gp = g; break; }
  if (!gp) { PAD = null; return; }
  const cur = gp.buttons.map(b => b.pressed || b.value > 0.4);
  const prev = padPrev;
  padPrev = cur;
  const stick = (x, y) => {
    const m = Math.hypot(x, y);
    if (m < cfg.dz) return [0, 0];
    const s = Math.min(1, (m - cfg.dz) / (1 - cfg.dz));
    return [x / m * s, y / m * s];
  };
  const ax = gp.axes;
  PAD = {
    gp, cur,
    pressed: i => !!cur[i] && !prev[i],
    val: i => (gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0),
    left: stick(ax[0] || 0, ax[1] || 0),
    right: stick(ax[2] || 0, ax[3] || 0),
  };
  if (cur.some(Boolean) || PAD.left[0] || PAD.left[1] || PAD.right[0] || PAD.right[1]) {
    if (inputMode !== 'pad') { inputMode = 'pad'; ac(); focusFirst(); PAD.pressed = () => false; }
    $('padhint').textContent = '🎮 ' + (gp.id.split('(')[0].trim().slice(0, 28) || 'Controller');
  }
}

function menuPad() {
  const scr = document.querySelector('.screen.on');
  if (!PAD || !scr) return;
  const items = [...scr.querySelectorAll('button,select,input')];
  if (!items.length) return;
  let i = items.indexOf(document.activeElement);
  const ly = PAD.left[1];
  const edge = Math.abs(ly) > 0.6 && Math.abs(padPrevY) <= 0.6 ? Math.sign(ly) : 0;
  padPrevY = ly;
  let move = 0;
  if (PAD.pressed(13) || edge > 0) move = 1;
  if (PAD.pressed(12) || edge < 0) move = -1;
  if (move) {
    i = i < 0 ? 0 : (i + move + items.length) % items.length;
    document.querySelectorAll('.focus').forEach(e => e.classList.remove('focus'));
    items[i].focus(); items[i].classList.add('focus'); sfx.click();
  }
  const el = document.activeElement;
  const lr = (PAD.pressed(15) ? 1 : 0) - (PAD.pressed(14) ? 1 : 0);
  if (lr && el) {
    if (el.type === 'range') { el.value = +el.value + lr * +el.step * 4; el.dispatchEvent(new Event('input')); }
    if (el.tagName === 'SELECT') { el.selectedIndex = clamp(el.selectedIndex + lr, 0, el.options.length - 1); }
  }
  if (PAD.pressed(0) && el && items.includes(el)) {
    if (el.tagName === 'BUTTON') el.click();
    else if (el.type === 'checkbox') { el.checked = !el.checked; el.dispatchEvent(new Event('change')); }
    else if (el.tagName === 'SELECT') el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
  }
  if (PAD.pressed(1)) { const b = scr.querySelector('[data-act=back],[data-act=resume],[data-act=cancelQueue]'); if (b) b.click(); }
  if (PAD.pressed(9) && G.menuOpen) resume();
}

function readInput(dt) {
  const fovScale = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(cfg.fov / 2));
  const inp = { mx: 0, mz: 0, look: [0, 0], fire: false, ads: false, jump: false, sprint: false };
  if (G.menuOpen) { mdx = mdy = 0; fireQueued = false; return inp; }
  const s = 0.0022 * cfg.sens * fovScale;
  inp.look[0] = -mdx * s; inp.look[1] = -mdy * s; mdx = mdy = 0;
  if (keys.has('KeyW')) inp.mz += 1; if (keys.has('KeyS')) inp.mz -= 1;
  if (keys.has('KeyD')) inp.mx += 1; if (keys.has('KeyA')) inp.mx -= 1;
  inp.jump = keys.has('Space'); inp.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  inp.ads = rmb; inp.fire = fireQueued; fireQueued = false;
  L.crouch = keys.has('KeyC') || keys.has('ControlLeft') || padCrouch;
  if (PAD) {
    const [lx, ly] = PAD.left, [rx, ry] = PAD.right;
    inp.mx += lx; inp.mz -= ly;
    const curve = v => Math.sign(v) * Math.pow(Math.abs(v), 1.7);
    inp.look[0] -= curve(rx) * 4.2 * cfg.psens * fovScale * dt;
    inp.look[1] -= curve(ry) * 2.9 * cfg.psens * fovScale * dt * (cfg.invy ? -1 : 1);
    if (PAD.val(6) > 0.3) inp.ads = true;
    if (PAD.pressed(7)) inp.fire = true;
    if (PAD.cur[0]) inp.jump = true;
    if (PAD.pressed(1) || PAD.pressed(11)) padCrouch = !padCrouch;
    if (PAD.pressed(10)) padSprint = !padSprint;
    if (Math.hypot(lx, ly) < 0.3) padSprint = false;
    if (padSprint) inp.sprint = true;
    if (PAD.pressed(4)) cycleSpec(-1);
    if (PAD.pressed(5) || (PAD.pressed(7) && !L.alive)) cycleSpec(1);
    if (PAD.pressed(9)) pause();
  }
  return inp;
}

function cycleSpec(dir) {
  if (L.alive) return;
  const alive = [...G.players.values()].filter(p => p.alive && p.id !== G.me).sort((a, b) => (a.team === G.myTeam ? 0 : 1) - (b.team === G.myTeam ? 0 : 1));
  if (!alive.length) return;
  let i = alive.findIndex(p => p.id === G.spec);
  G.spec = alive[(i + dir + alive.length) % alive.length].id;
}

// ---------- local player ----------
function updateLocal(dt) {
  const inp = readInput(dt);
  L.yaw += inp.look[0];
  L.pitch = clamp(L.pitch + inp.look[1], -1.5, 1.5);
  if (!L.alive) return;
  const live = G.phase === 'live';
  const cycling = G.t - L.lastShot < RULES.bolt;
  if (inp.ads && !cycling) { if (L.ads === 0) L.scopeStart = G.t; L.ads = Math.min(1, L.ads + dt / 0.22); }
  else L.ads = Math.max(0, L.ads - dt / 0.12);
  let wx = 0, wz = 0, speed = 0;
  if (live) {
    const fx = -Math.sin(L.yaw), fz = -Math.cos(L.yaw), rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    wx = fx * inp.mz + rx * inp.mx; wz = fz * inp.mz + rz * inp.mx;
    const l = Math.hypot(wx, wz); if (l > 1) { wx /= l; wz /= l; }
    L.sprint = inp.sprint && inp.mz > 0.5 && L.ads < 0.1 && !L.crouch;
    speed = L.crouch ? 2.6 : L.sprint ? 7.6 : 5.2;
    if (L.ads > 0.3) speed *= 0.6;
  }
  stepBody(L, dt, wx, wz, speed, live && inp.jump, L.crouch);
  if (inp.fire && live && !cycling) shoot();
}

function shoot() {
  const eye = [L.pos[0], L.pos[1] + (L.crouch ? EYE_CROUCH : EYE), L.pos[2]];
  let d = fwd(L.yaw, L.pitch);
  const spread = L.ads >= 0.95 ? 0 : (1 - L.ads) * 0.11 + 0.01;
  if (spread) d = norm([d[0] + rnd() * spread, d[1] + rnd() * spread, d[2] + rnd() * spread]);
  send({ t: 'shot', o: eye, d, meta: { ads: L.ads, scopeT: G.t - L.scopeStart, air: !L.grounded } });
  L.lastShot = G.t; L.recoil = 1; L.pitch = Math.min(1.5, L.pitch + 0.03);
  sfx.shot(1, 0); sfx.bolt(); rumble(0.8, 0.3, 120);
  vm.userData.flash.visible = true; setTimeout(() => (vm.userData.flash.visible = false), 45);
}

// ---------- HUD ----------
function updateHud() {
  const sc = G.scores;
  $('sA').textContent = sc[G.myTeam]; $('sB').textContent = sc[1 - G.myTeam];
  if (G.warmup) $('timer').textContent = 'WARMUP';
  else { const r = Math.max(0, Math.ceil(G.timerEnd - G.t)); $('timer').textContent = `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; }
  let a = '', b = '';
  for (const p of G.players.values()) {
    const alive = p.id === G.me ? L.alive : p.alive;
    if (p.team === G.myTeam) a += alive ? '●' : '○'; else b += alive ? '●' : '○';
  }
  $('alive').innerHTML = `<span style="color:#7fb2ff">${a}</span> &nbsp; <span style="color:#ff7a7a">${b}</span>`;
  $('roundinfo').textContent = G.warmup ? 'PRACTICE · INSTANT RESPAWN' : `ROUND ${G.round} · FIRST TO ${RULES.roundsToWin}`;
  const cyc = G.t - L.lastShot;
  $('bolt').style.display = L.alive && cyc < RULES.bolt ? 'block' : 'none';
  $('bolt').firstChild.style.width = clamp(cyc / RULES.bolt, 0, 1) * 100 + '%';
  const scoped = clamp((L.ads - 0.6) / 0.3, 0, 1);
  $('scope').style.opacity = L.alive ? scoped : 0;
  $('dot').style.display = L.alive && L.ads < 0.3 ? 'block' : 'none';
  const sp = !L.alive && G.players.get(G.spec);
  $('spec').innerHTML = !L.alive && G.phase !== 'over'
    ? (sp ? `Spectating ${pname(sp)} · ${inputMode === 'pad' ? 'LB/RB' : 'click'} to switch` : 'Waiting for next round…') + (G.warmup ? ' · respawning…' : '')
    : '';
  $('hudhint').textContent = inputMode === 'pad'
    ? 'LT scope · RT fire · A jump · B crouch · L3 sprint · Y scores · Start pause'
    : 'RMB scope · LMB fire · Space jump · C crouch · Shift sprint · Tab scores · Esc pause';
  const showBoard = keys.has('Tab') || (PAD && (PAD.cur[3] || PAD.cur[8])) || G.over;
  $('board').classList.toggle('on', !!showBoard && G.on && !document.querySelector('.screen.on'));
  if (showBoard) {
    let html = '';
    for (const team of [G.myTeam, 1 - G.myTeam]) {
      html += `<table><tr><th>${team === G.myTeam ? 'Your team' : 'Enemy'} — ${sc[team]}</th><th>K</th><th>D</th></tr>`;
      for (const p of [...G.players.values()].filter(p => p.team === team).sort((x, y) => y.kills - x.kills))
        html += `<tr><td>${pname(p)}${p.id === G.me ? ' (you)' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`;
      html += '</table>';
    }
    $('boardbody').innerHTML = html;
  }
}

// ---------- menu actions ----------
function pause() {
  if (!G.on || G.over) return;
  G.menuOpen = true; G.paused = G.kind === 'practice'; rmb = false;
  unlockPointer(); screen('pause');
}
function resume() {
  G.menuOpen = false; G.paused = false; screen(null); lockPointer();
}
function leave() {
  if (G.kind === 'online' && G.on) send({ t: 'leave' });
  G.on = false; G.match = null; G.bots = []; G.kind = null; G.menuOpen = false; G.over = false;
  clearPlayers(); L.alive = false;
  $('hud').classList.remove('on'); $('board').classList.remove('on');
  unlockPointer(); screen('menu');
}
function queue(mode) {
  if (!ws || ws.readyState !== 1) { banner('Server offline — try practice', 2000); $('hud').classList.add('on'); setTimeout(() => !G.on && $('hud').classList.remove('on'), 2100); return; }
  send({ t: 'queue', mode, name: cfg.name || 'Player', code: $('code').value });
  $('qtext').textContent = `Searching for ${mode}…`;
  screen('queue');
}
const ACTIONS = {
  q2: () => queue('2v2'), q4: () => queue('4v4'),
  practice: () => screen('practice'), rules: () => screen('rules'), settings: () => screen('settings'),
  back: () => screen('menu'), startPractice, resume, leave,
  cancelQueue: () => { send({ t: 'leaveQueue' }); screen('menu'); },
};
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { ac(); sfx.click(); ACTIONS[b.dataset.act](); }));

// ---------- main loop ----------
const tmp = new THREE.Vector3();
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = vmCam.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  pollPad();
  if (document.querySelector('.screen.on')) menuPad();
  else if (G.on && PAD && PAD.pressed(9) && G.menuOpen) resume();

  if (G.on) {
    if (!G.paused) {
      G.t += dt;
      if (G.kind === 'practice' && G.match) { updateBots(dt); G.match.step(dt); if (G.match) onMsg(G.match.snapshot()); }
      updateLocal(dt);
      if (L.alive && (G.kind === 'practice' || G.t - G.lastSend > 0.05)) {
        G.lastSend = G.t;
        send({ t: 'state', pos: L.pos.map(v => Math.round(v * 100) / 100), yaw: L.yaw, pitch: L.pitch, crouch: L.crouch, ads: L.ads });
      }
    }
    // remote avatars
    for (const p of G.players.values()) {
      if (!p.mesh) continue;
      const k = Math.min(1, dt * 16);
      if (Math.hypot(p.tpos[0] - p.pos[0], p.tpos[2] - p.pos[2]) > 6) p.pos = [...p.tpos];
      for (let i = 0; i < 3; i++) p.pos[i] += (p.tpos[i] - p.pos[i]) * k;
      p.yaw += angDiff(p.yaw, p.tyaw) * k;
      const g = p.mesh.g;
      g.position.set(p.pos[0], p.pos[1] + (p.alive ? 0 : 0.15), p.pos[2]);
      g.rotation.set(p.alive ? 0 : -Math.PI / 2, p.yaw, 0);
      p.mesh.body.scale.y = p.crouch ? 0.72 : 1;
      g.visible = !(G.spec === p.id && !L.alive);
    }
    // camera
    let fovTarget = cfg.fov;
    if (L.alive) {
      camera.position.set(L.pos[0], L.pos[1] + (L.crouch ? EYE_CROUCH : EYE), L.pos[2]);
      L.recoil = Math.max(0, L.recoil - dt * 5);
      camera.rotation.set(L.pitch + L.recoil * 0.02, L.yaw, 0);
      const e = L.ads * L.ads * (3 - 2 * L.ads);
      fovTarget = cfg.fov + (17 - cfg.fov) * e;
    } else {
      let sp = G.players.get(G.spec);
      if (!sp || !sp.alive) { G.spec = null; cycleSpec(1); sp = G.players.get(G.spec); }
      if (sp && sp.alive) {
        fwdCam(sp);
      } else {
        const a = G.t * 0.1;
        camera.position.set(Math.cos(a) * 30, 18, Math.sin(a) * 22);
        camera.lookAt(0, 0, 0);
      }
    }
    camera.fov = fovTarget; camera.updateProjectionMatrix();
    // viewmodel
    const speed = Math.hypot(L.vel[0], L.vel[2]);
    const bob = Math.sin(G.t * (L.sprint ? 14 : 10)) * Math.min(1, speed / 6) * (L.sprint ? 0.025 : 0.012);
    const e = L.ads;
    const cyc = clamp((G.t - L.lastShot) / RULES.bolt, 0, 1);
    const boltAnim = cyc < 1 ? Math.sin(cyc * Math.PI) : 0;
    vm.position.set(0.2 * (1 - e) + (L.sprint ? 0.06 : 0), -0.2 + e * 0.12 + bob - boltAnim * 0.06, -0.35 + L.recoil * 0.08);
    vm.rotation.set(L.recoil * 0.12 + boltAnim * 0.25, (L.sprint ? 0.5 : 0) * (1 - e), boltAnim * 0.5);
    vm.visible = L.alive && L.ads < 0.75;
    updateHud();
  } else {
    const a = now / 1000 * 0.06;
    camera.position.set(Math.cos(a) * 42, 16, Math.sin(a) * 30);
    camera.lookAt(0, 2, 0);
    camera.fov = 60; camera.updateProjectionMatrix();
    vm.visible = false;
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i]; tr.t -= dt; tr.line.material.opacity = Math.max(0, tr.t / 0.35);
    if (tr.t <= 0) { scene.remove(tr.line); tr.line.geometry.dispose(); tracers.splice(i, 1); }
  }
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(vmScene, vmCam);
}
function fwdCam(sp) {
  camera.position.set(sp.pos[0], sp.pos[1] + (sp.crouch ? EYE_CROUCH : EYE), sp.pos[2]);
  camera.rotation.set(sp.pitch, sp.yaw, 0);
}
requestAnimationFrame(frame);

// debug hook for automated testing
window.__qs = { G, L, startPractice, onMsg, updateBots };
