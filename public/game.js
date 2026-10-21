import {
  THREE, canvas, noGL, camera, vmCam, loadMap, setSites, setBomb, tickBomb, makeAvatar, removeAvatar, vm, setViewGun,
  muzzleFlash, tracer, burst, spawnKnife, endKnife, clearFx, stepFx, resize, render,
} from './client/world.js';
import { sfx, ac, audioCfg, announce } from './client/audio.js';
import { Bots, BOT_NAMES } from './client/bots.js';
import { MAPS, MAP_KEYS, STANCES, SITE_RADIUS, rayBoxes, rayAABB, stepBody, stepProjectile, hitZones } from './shared/map.js';
import { Match, MODES, RULES } from './shared/match.js';
import { WEAPONS, WEAPON_KEYS, ATTACH, PERKS, PERK_NAMES, LETHALS, DEFAULT_CLASSES, sanitizeLoadout, weaponStats } from './shared/weapons.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = () => Math.random() + Math.random() - 1;
const fwd = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const esc = s => String(s).replace(/[<>&"]/g, '');
// which maps each lobby size rotates through (practice "Random")
const MAP_POOL = { 1: ['derrick', 'skyline'], 2: ['derrick', 'dustbowl', 'skyline'], 4: ['dustbowl', 'skyline'] };

// ---------- settings ----------
const DEFAULTS = {
  name: '', sens: 1, psens: 1.2, dz: 0.15, fov: 80, vol: 0.6, mlg: true, announcer: true, rumble: true, invy: false, cls: 0,
  custom: [1, 2, 3].map(i => ({ ...DEFAULT_CLASSES[0], name: `Custom ${i}`, perks: [...DEFAULT_CLASSES[0].perks] })),
};
let cfg = { ...DEFAULTS };
try { Object.assign(cfg, JSON.parse(localStorage.getItem('qs-cfg2') || '{}')); } catch {}
cfg.custom = (Array.isArray(cfg.custom) && cfg.custom.length === 3 ? cfg.custom : DEFAULTS.custom).map(sanitizeLoadout);
const saveCfg = () => { try { localStorage.setItem('qs-cfg2', JSON.stringify(cfg)); } catch {} };
const allClasses = () => [...DEFAULT_CLASSES, ...cfg.custom];
const myClass = () => allClasses()[cfg.cls] || DEFAULT_CLASSES[0];
audioCfg.vol = cfg.vol; audioCfg.announcer = cfg.announcer;

$('name').value = cfg.name;
$('name').oninput = () => { cfg.name = $('name').value; saveCfg(); };
for (const k of ['sens', 'psens', 'dz', 'fov', 'vol']) { $(k).value = cfg[k]; $(k).oninput = () => { cfg[k] = +$(k).value; audioCfg.vol = cfg.vol; saveCfg(); }; }
for (const k of ['mlg', 'announcer', 'rumble', 'invy']) { $(k).checked = cfg[k]; $(k).onchange = () => { cfg[k] = $(k).checked; audioCfg.announcer = cfg.announcer; saveCfg(); }; }

if (noGL) {
  $('glerr').innerHTML = '3D graphics (WebGL) are disabled in this browser, so the game can\'t draw. ' +
    'In Firefox: open <b>about:config</b>, set <b>webgl.disabled</b> to false and <b>webgl.force-enabled</b> to true, ' +
    'and turn on hardware acceleration in Settings, then restart Firefox. Or try Chrome/Chromium.';
  $('glerr').style.display = 'block';
}

// ---------- menus ----------
const opt = (v, t) => `<option value="${v}">${esc(t)}</option>`;
for (const id of ['omode', 'pmode']) $(id).innerHTML = Object.entries(MODES).map(([k, m]) => opt(k, m.name)).join('');
$('pmap').innerHTML = opt('random', 'Random') + MAP_KEYS.map(k => opt(k, MAPS[k].name)).join('');
function syncModeUI(prefix) {
  const mode = $(prefix + 'mode').value, ffa = mode === 'ffa';
  $(prefix + 'modedesc').textContent = MODES[mode].desc;
  const size = $(prefix + 'size');
  [...size.options].forEach((o, i) => {
    o.textContent = ffa ? (prefix === 'o' ? 'Up to 6 players' : `${[4, 6, 8][i]} players`) : ['1v1', '2v2', '4v4'][i];
  });
  size.disabled = ffa && prefix === 'o';
}
$('omode').onchange = () => syncModeUI('o');
$('pmode').onchange = () => syncModeUI('p');
syncModeUI('o'); syncModeUI('p');

function refreshClassPickers() {
  const html = allClasses().map((c, i) => opt(i, c.name + (i < DEFAULT_CLASSES.length ? '' : ' ★'))).join('');
  document.querySelectorAll('.classpick').forEach(s => { s.innerHTML = html; s.value = cfg.cls; });
  $('csel').innerHTML = allClasses().map((c, i) => opt(i, (i < DEFAULT_CLASSES.length ? 'Default: ' : 'Custom: ') + c.name)).join('');
}
document.querySelectorAll('.classpick').forEach(s => (s.onchange = () => { cfg.cls = +s.value; saveCfg(); refreshClassPickers(); }));

// Create-a-Class editor
$('cgun').innerHTML = WEAPON_KEYS.map(k => opt(k, WEAPONS[k].name)).join('');
$('catt').innerHTML = Object.entries(ATTACH).map(([k, a]) => opt(k, a.name)).join('');
$('clethal').innerHTML = Object.entries(LETHALS).map(([k, v]) => opt(k, v)).join('');
PERKS.forEach((tier, i) => ($('cp' + i).innerHTML = Object.keys(tier).map(k => opt(k, PERK_NAMES[k])).join('')));
let editIdx = DEFAULT_CLASSES.length;
function showClass() {
  const c = allClasses()[editIdx], isDefault = editIdx < DEFAULT_CLASSES.length;
  $('csel').value = editIdx;
  $('cname').value = c.name; $('cgun').value = c.primary; $('catt').value = c.att; $('clethal').value = c.lethal;
  c.perks.forEach((p, i) => ($('cp' + i).value = p));
  for (const id of ['cname', 'cgun', 'catt', 'clethal', 'cp0', 'cp1', 'cp2']) $(id).disabled = isDefault;
  $('cnote').textContent = isDefault ? 'Default classes are read-only. Pick a Custom slot to build your own.' : 'Changes save automatically.';
  const s = weaponStats(c), maxR = 280;
  const bar = (label, v) => `<label>${label}</label><div class="bar"><i style="width:${Math.round(clamp(v, 0.05, 1) * 100)}%"></i></div>`;
  $('cstats').innerHTML = bar('Scope-in speed', (0.36 - s.ads) / 0.2) + bar('Mobility', (s.move - 0.85) / 0.15) + bar('Fire rate', s.rpm / maxR) + bar('Magazine', s.mag / 15) +
    `<div class="desc">${esc(ATTACH[c.att].desc || '')}<br>${c.perks.map(p => esc(PERKS.find(t => t[p])[p])).join('<br>')}</div>`;
}
function editField() {
  if (editIdx < DEFAULT_CLASSES.length) return;
  cfg.custom[editIdx - DEFAULT_CLASSES.length] = sanitizeLoadout({
    name: $('cname').value || 'Custom', primary: $('cgun').value, att: $('catt').value, lethal: $('clethal').value,
    perks: [0, 1, 2].map(i => $('cp' + i).value),
  });
  saveCfg(); refreshClassPickers(); showClass();
}
for (const id of ['cgun', 'catt', 'clethal', 'cp0', 'cp1', 'cp2']) $(id).onchange = editField;
$('cname').oninput = editField;
$('csel').onchange = () => { editIdx = +$('csel').value; showClass(); };
refreshClassPickers(); showClass();

// ---------- game state ----------
const G = {
  on: false, kind: null, t: 0, me: 0, players: new Map(), phase: 'waiting', round: 0, scores: [0, 0], left: 0,
  mode: 'elim', cfg: MODES.elim, ffa: false, map: MAPS.dustbowl, teamSize: 2, match: null, bots: null, paused: false, menuOpen: false,
  over: false, myTeam: 0, spec: null, attackers: 0, bomb: null, noHardscope: true, lastSend: 0,
  rec: [], events: [], kc: null, killT: new Map(), deathAt: 0, pendingKC: null, fired: new Map(), practiceOpts: null,
};
const L = {
  pos: [0, 0, 0], vel: [0, 0, 0], grounded: true, yaw: 0, pitch: 0, stance: 0, ads: 0, scopeStart: 0, fullT: null, alive: false,
  stats: weaponStats(DEFAULT_CLASSES[0]), loadout: DEFAULT_CLASSES[0], mag: 0, reserve: 0, reloadT: 0, reloadDur: 1, nextShot: 0,
  sprint: false, stamina: 4, sprintOut: 0, knives: 0, using: false, breath: 4, breathCd: 0, holding: false, yawLog: [],
  recoil: 0, stepAcc: 0, autoReload: 0,
};
let swayX = 0, swayY = 0, inputMode = 'kb';

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
function banner(html, ms = 1800, color = '#fff') {
  const b = $('banner'); b.innerHTML = html; b.style.color = color; b.style.opacity = 1;
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => (b.style.opacity = 0), ms);
}
function medal(text, sub) {
  const m = $('medal'); m.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
  m.classList.remove('pop'); void m.offsetWidth; m.classList.add('pop');
}
function feed(html) {
  const d = document.createElement('div'); d.innerHTML = html; $('feed').prepend(d);
  setTimeout(() => d.remove(), 6000);
  while ($('feed').children.length > 6) $('feed').lastChild.remove();
}
const isMate = p => p && !G.ffa && p.team === G.myTeam;
const pname = p => {
  if (!p) return '?';
  const c = p.id === G.me ? '#ffd400' : isMate(p) ? '#7fb2ff' : '#ff7a7a';
  return `<span style="color:${c}">${esc(p.name)}</span>`;
};
function rumble(strong, weak, ms) {
  if (!cfg.rumble || inputMode !== 'pad' || !PAD) return;
  try { PAD.gp.vibrationActuator && PAD.gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch {}
}
function flashScreen(o = 0.5) {
  const f = $('flash'); f.style.transition = 'none'; f.style.opacity = o;
  requestAnimationFrame(() => { f.style.transition = 'opacity .6s'; f.style.opacity = 0; });
}

function clearPlayers() {
  for (const p of G.players.values()) if (p.av) removeAvatar(p.av);
  G.players.clear();
}

function beginMatch({ me, roster, mode, teamSize, map, kind }) {
  clearPlayers(); clearFx();
  Object.assign(G, {
    me, kind, mode, cfg: MODES[mode], ffa: !MODES[mode].teams, teamSize, on: true, over: false, paused: false, menuOpen: false,
    scores: [0, 0], round: 0, phase: 'waiting', spec: null, bomb: null, rec: [], events: [], kc: null, pendingKC: null, left: 0,
  });
  G.killT.clear(); G.fired.clear();
  G.map = loadMap(map);
  setSites(mode === 'sd' ? G.map.sites : null);
  G.myTeam = roster.find(r => r.id === me).team;
  for (const r of roster) {
    const p = { id: r.id, name: r.name, team: r.team, alive: false, pos: [0, 0, 0], tpos: [0, 0, 0], yaw: 0, tyaw: 0, pitch: 0, stance: 0, ads: 0,
      w: 0, sprint: false, useP: 0, kills: 0, deaths: 0, score: 0, loadout: null, stepAcc: 0, last: [0, 0, 0] };
    p.av = makeAvatar(r.id === me || (!G.ffa && r.team === G.myTeam), r.id === me ? null : r.name);
    p.av.g.visible = false;
    G.players.set(r.id, p);
  }
  L.alive = false;
  $('feed').innerHTML = '';
  $('hud').classList.add('on');
  screen(null);
  lockPointer();
  banner(`${MODES[mode].name}<br><span style="font-size:20px">${G.map.name} · ${G.ffa ? 'Free-for-All' : teamSize + 'v' + teamSize}</span>`, 2200, '#ffd400');
}

function spawnLocal(m) {
  L.pos = [...m.pos]; L.vel = [0, 0, 0]; L.yaw = m.yaw; L.pitch = 0; L.stance = 0; L.alive = true; L.ads = 0; L.fullT = null;
  L.loadout = m.loadout; L.stats = weaponStats(m.loadout);
  L.mag = L.stats.mag; L.reserve = L.stats.reserve; L.reloadT = 0; L.nextShot = 0; L.knives = m.loadout.lethal === 'tknife' ? 1 : 0;
  L.sprint = false; L.stamina = 4; L.sprintOut = 0; L.using = false; L.breath = 4; L.breathCd = 0; L.yawLog = []; L.autoReload = 0;
  padCrouch = 0;
  setViewGun(m.loadout.primary, m.loadout.att);
  G.spec = null; G.kc = null; G.pendingKC = null;
  $('kc').style.display = 'none';
}

// ---------- messages ----------
function onMsg(m) {
  switch (m.t) {
    case 'online': $('online').textContent = `● ${m.n} online`; break;
    case 'queue':
      $('qtext').textContent = m.ffa
        ? `Free-for-All: ${m.have}/${m.need} players. Starts when full, or 20s after a second player joins.`
        : `${MODES[m.mode].name} ${m.size}v${m.size}: ${m.have}/${m.need} players found. Starts when the lobby is full.`;
      break;
    case 'match': beginMatch({ me: m.you, roster: m.players, mode: m.mode, teamSize: m.teamSize, map: m.map, kind: 'online' }); break;
    case 'phase': onPhase(m); break;
    case 'spawn': {
      const p = G.players.get(m.id); if (!p) break;
      p.alive = true; p.pos = [...m.pos]; p.tpos = [...m.pos]; p.yaw = p.tyaw = m.yaw; p.loadout = m.loadout;
      p.av.setGun(m.loadout.primary, m.loadout.att);
      if (m.id === G.me) spawnLocal(m);
      break;
    }
    case 'snap':
      G.scores = m.sc; G.left = m.left; G.bomb = m.bomb || null;
      for (const [id, x, y, z, yaw, pitch, st, ads, alive, w, sprint, useP, k, d, sc] of m.p) {
        const p = G.players.get(id); if (!p) continue;
        Object.assign(p, { kills: k, deaths: d, score: sc, useP });
        if (id === G.me) continue;
        p.tpos = [x, y, z]; p.tyaw = yaw; p.pitch = pitch; p.stance = st; p.ads = ads; p.alive = !!alive; p.w = w; p.sprint = !!sprint;
      }
      break;
    case 'shot': {
      G.events.push({ t: G.t, type: 'shot', ...m });
      if (m.id === G.me) break;
      G.fired.set(m.id, G.t);
      tracer(m.o, m.d, m.end);
      const v = new THREE.Vector3(m.o[0], m.o[1], m.o[2]).applyMatrix4(camera.matrixWorldInverse), dist = v.length();
      sfx.shot(WEAPON_KEYS[m.w], 1 / (1 + dist / 18), v.x / (dist + 1));
      break;
    }
    case 'kill': onKill(m); break;
    case 'denied':
      if (m.id === G.me) { banner('HARDSCOPE<br><span style="font-size:20px">kill denied — MLG rules</span>', 1600, '#ff5050'); sfx.deny(); }
      break;
    case 'knife':
      spawnKnife(m.id, m.o, m.v);
      G.events.push({ t: G.t, type: 'knife', ...m });
      if (m.owner !== G.me) sfx.whoosh();
      break;
    case 'knifeEnd': endKnife(m.id); break;
    case 'bomb': {
      const site = G.map.sites[m.site];
      if (m.state === 'planted') {
        setBomb(site.pos);
        const ours = G.attackers === G.myTeam;
        banner(ours ? 'Bomb planted' : 'Bomb planted — defuse it!', 2200, ours ? '#7fb2ff' : '#ff7a7a');
        announce('Bomb planted');
      } else if (m.state === 'defused') {
        setBomb(null); banner('Bomb defused', 2000); announce('Bomb defused');
      } else if (m.state === 'exploded') {
        setBomb(null); burst([site.pos[0], 1, site.pos[2]], 0xff7a2a, 3); sfx.boom(1, 0); flashScreen(0.3);
      }
      break;
    }
    case 'left': {
      const p = G.players.get(m.id);
      if (p) { feed(`${pname(p)} left the match`); removeAvatar(p.av); G.players.delete(m.id); }
      break;
    }
    case 'over': onOver(m); break;
  }
}

function onPhase(m) {
  G.phase = m.phase; G.round = m.n; G.scores = m.scores; G.left = m.dur; G.attackers = m.attackers;
  if (m.phase === 'countdown') {
    if (G.cfg.rounds) {
      clearFx(); G.bomb = null; G.kc = null; G.pendingKC = null; $('kc').style.display = 'none';
      const sub = G.mode === 'sd' ? (G.attackers === G.myTeam ? 'Attack — plant the bomb at A or B' : 'Defend sites A and B') : 'Eliminate the enemy team';
      banner(`Round ${m.n}<br><span style="font-size:20px">${sub}</span>`, RULES.roundCountdown * 1000 - 300);
    } else banner(`${G.cfg.name}<br><span style="font-size:20px">${G.map.name} · get ready</span>`, RULES.countdown * 1000 - 300);
  } else if (m.phase === 'live') {
    banner('GO!', 700, '#ffd400'); sfx.click();
    if (G.round <= 1) announce(G.mode === 'sd' ? 'Search and destroy' : 'Go');
  } else if (m.phase === 'roundend') {
    const won = m.winner === G.myTeam;
    const why = { elim: 'Enemy team eliminated', time: 'Time expired', bomb: 'Target destroyed', defused: 'Bomb defused' }[m.reason] || '';
    banner(`${m.winner < 0 ? 'Round draw' : won ? 'Round won' : 'Round lost'}<br><span style="font-size:20px">${why}</span>`, 3200,
      m.winner < 0 ? '#fff' : won ? '#7fb2ff' : '#ff7a7a');
    announce(m.winner < 0 ? 'Draw' : won ? 'Round won' : 'Round lost');
  }
}

function onKill(m) {
  const K = G.players.get(m.killer), V = G.players.get(m.victim);
  if (V) V.alive = false;
  G.killT.set(`${m.killer}:${m.victim}`, G.t);
  G.events.push({ t: G.t, type: 'kill', ...m });
  const tags = m.medals.length ? ` <span style="color:#ffd400">[${m.medals.join(' ')}]</span>` : '';
  feed(m.suicide ? `${pname(V)} <span style="color:#aaa">${esc(m.weapon === 'Fell' ? 'fell to their death' : m.weapon)}</span>`
    : `${pname(K)} <span style="color:#ccc">[${esc(m.weapon)}]</span> ${pname(V)}${tags}`);
  if (m.medals.includes('FIRST BLOOD')) announce('First blood');
  if (m.victim === G.me) {
    L.alive = false; L.ads = 0; sfx.death(); rumble(1, 0.6, 400);
    if (L.using) send({ t: 'use', on: false });
    L.using = false;
    G.deathAt = G.t;
    G.spec = m.suicide ? null : m.killer;
    if (!m.suicide) {
      banner(`Killed by ${pname(K)}`, 1400);
      G.pendingKC = { killer: m.killer, victim: m.victim, tKill: G.t, at: G.t + 1.1 };
    } else if (G.cfg.respawn) setTimeout(() => G.on && send({ t: 'respawn' }), 2000);
  }
  if (m.killer === G.me && !m.suicide) {
    const h = $('hit'); h.classList.add('on'); setTimeout(() => h.classList.remove('on'), 60);
    sfx.hit(); setTimeout(sfx.kill, 60); rumble(0.4, 0.8, 150);
    medal(m.medals.length ? m.medals.join(' + ') : 'KILL', `+${m.points}`);
    const trick = m.medals.some(x => ['QUICKSCOPE', 'NO-SCOPE', '360', '360 NO-SCOPE', 'COLLATERAL', 'WALLBANG', 'BULLSEYE'].includes(x));
    if (cfg.mlg && trick) { sfx.horn(); flashScreen(0.45); }
    if (m.medals.includes('360 NO-SCOPE')) announce('Three sixty no scope!');
    else if (m.medals.includes('COLLATERAL')) announce('Collateral!');
  }
}

function onOver(m) {
  G.over = true; G.phase = 'over';
  const won = G.ffa ? m.winner === G.me : m.winner === G.myTeam;
  const draw = m.winner === -1;
  $('endtitle').textContent = draw ? 'Draw' : won ? 'Victory' : 'Defeat';
  $('endtitle').style.color = draw ? '#fff' : won ? '#7fb2ff' : '#ff7a7a';
  if (G.ffa) {
    const w = G.players.get(m.winner);
    $('endsub').innerHTML = w ? `${pname(w)} wins with ${w.kills} kills` : '';
  } else $('endsub').textContent = `Final score ${m.scores[G.myTeam]} – ${m.scores[1 - G.myTeam]}`;
  $('endboard').innerHTML = boardHtml();
  $('rematch').style.display = G.kind === 'practice' ? 'block' : 'none';
  announce(draw ? 'Draw' : won ? 'Victory' : 'Defeat');
  if (won && cfg.mlg) sfx.horn();
  const fk = m.finalKill, tKill = fk && G.killT.get(`${fk.killer}:${fk.victim}`);
  if (fk && tKill !== undefined && fk.killer !== fk.victim) {
    G.pendingKC = null;
    setTimeout(() => startKillcam(fk.killer, fk.victim, tKill, true), 1500);
  } else setTimeout(() => { if (G.over) { unlockPointer(); screen('end'); } }, 2500);
}

// ---------- killcam ----------
function startKillcam(killer, victim, tKill, final) {
  if (!G.rec.length) return final && endKillcam();
  G.kc = { killer, victim, t: Math.max(G.rec[0].t, tKill - 4), end: tKill + 1, final, ev: 0 };
  G.kc.ev = G.events.findIndex(e => e.t >= G.kc.t);
  if (G.kc.ev < 0) G.kc.ev = G.events.length;
  const k = G.players.get(killer);
  if (k && k.loadout) setViewGun(k.loadout.primary, k.loadout.att);
  $('kc').style.display = 'block';
  $('kctext').innerHTML = `${final ? 'FINAL KILLCAM' : 'KILLCAM'}<small>${k ? pname(k) : ''}${final ? '' : ` · ${inputMode === 'pad' ? 'A' : 'Space'} to skip`}</small>`;
}
function endKillcam() {
  const kc = G.kc;
  G.kc = null;
  $('kc').style.display = 'none';
  if (L.loadout) setViewGun(L.loadout.primary, L.loadout.att);
  if (kc && kc.final) { unlockPointer(); screen('end'); return; }
  if (G.cfg.respawn && !L.alive) send({ t: 'respawn' });
}
function frameAt(t) {
  const r = G.rec;
  let lo = 0, hi = r.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (r[mid].t <= t) lo = mid; else hi = mid - 1; }
  return r[lo];
}
function record() {
  const s = {};
  for (const p of G.players.values()) {
    if (p.id === G.me) s[p.id] = [L.pos[0], L.pos[1], L.pos[2], L.yaw + swayX, L.pitch + swayY, L.stance, L.ads, L.alive ? 1 : 0];
    else s[p.id] = [p.pos[0], p.pos[1], p.pos[2], p.yaw, p.pitch, p.stance, p.ads, p.alive ? 1 : 0];
  }
  G.rec.push({ t: G.t, s });
  while (G.rec.length && G.rec[0].t < G.t - 10) G.rec.shift();
  while (G.events.length && G.events[0].t < G.t - 10) G.events.shift();
}
function playKillcam(dt) {
  const kc = G.kc;
  kc.t += dt;
  while (kc.ev < G.events.length && G.events[kc.ev].t <= kc.t) {
    const e = G.events[kc.ev++];
    if (e.type === 'shot') {
      if (e.id !== kc.killer) tracer(e.o, e.d, e.end);
      const k = G.players.get(e.id);
      sfx.shot(k && k.loadout ? k.loadout.primary : 'intervention', e.id === kc.killer ? 1 : 0.4, 0);
      if (e.id === kc.killer) { muzzleFlash(); kc.recoil = 1; }
    } else if (e.type === 'kill' && e.killer === kc.killer) { sfx.hit(); const h = $('hit'); h.classList.add('on'); setTimeout(() => h.classList.remove('on'), 60); }
  }
  const f = frameAt(kc.t);
  for (const p of G.players.values()) {
    const s = f.s[p.id];
    if (!s) { p.av.g.visible = false; continue; }
    poseAvatar(p, s[0], s[1], s[2], s[3], s[5], !!s[7]);
    p.av.g.visible = p.id !== kc.killer;
  }
  const ks = f.s[kc.killer];
  if (ks) {
    kc.recoil = Math.max(0, (kc.recoil || 0) - dt * 5);
    camera.position.set(ks[0], ks[1] + STANCES[ks[5]].eye, ks[2]);
    camera.rotation.set(ks[4] + kc.recoil * 0.02, ks[3], 0);
    const k = G.players.get(kc.killer), zoom = k && k.loadout ? weaponStats(k.loadout).zoom : 4.7;
    const e = ks[6] * ks[6] * (3 - 2 * ks[6]);
    camera.fov = cfg.fov + (cfg.fov / zoom - cfg.fov) * e;
    $('scope').style.opacity = clamp((ks[6] - 0.6) / 0.3, 0, 1);
    vm.visible = ks[6] < 0.75;
    vm.position.set(0.2 * (1 - ks[6]), -0.2 + ks[6] * 0.12, -0.35 + kc.recoil * 0.08);
    vm.rotation.set(kc.recoil * 0.12, 0, 0);
  }
  if (kc.t >= kc.end || kc.t >= G.t) endKillcam();
}

// ---------- networking ----------
let ws = null;
function connect() {
  if (location.protocol === 'file:') { $('online').textContent = 'Offline (run the server for multiplayer)'; return; }
  const sock = ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  // a VPN or proxy can stall the handshake forever; give up and retry instead of hanging on "Connecting…"
  const stall = setTimeout(() => { if (sock.readyState === 0) sock.close(); }, 8000);
  sock.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  sock.onopen = () => { clearTimeout(stall); $('online').textContent = '● Connected'; };
  sock.onclose = () => {
    clearTimeout(stall);
    $('online').textContent = 'Can\'t reach server (VPN or firewall?) — retrying… Practice still works';
    if (G.on && G.kind === 'online') { leave(); banner('Disconnected', 2500); }
    if (document.querySelector('#queue.on')) screen('menu');
    setTimeout(connect, 3000);
  };
}
connect();

function send(m) {
  if (G.kind === 'practice') {
    const x = G.match;
    if (!x) return;
    if (m.t === 'state') x.setState(G.me, m);
    else if (m.t === 'shot') x.shoot(G.me, m);
    else if (m.t === 'knife') x.throwKnife(G.me, m);
    else if (m.t === 'use') x.use(G.me, m.on);
    else if (m.t === 'respawn') x.respawnNow(G.me);
    else if (m.t === 'class') x.setLoadout(G.me, m.loadout);
    return;
  }
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
}

// ---------- practice ----------
function startPractice(opts) {
  if (noGL) return;
  opts = opts || {
    mode: $('pmode').value, size: +$('psize').value, map: $('pmap').value, diff: $('pdiff').value, hard: $('phard').checked,
  };
  G.practiceOpts = opts;
  const ffa = opts.mode === 'ffa';
  const pool = MAP_POOL[opts.size] || MAP_POOL[2];
  const map = opts.map === 'random' ? pool[Math.floor(Math.random() * pool.length)] : opts.map;
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  const roster = [{ id: 1, name: cfg.name || 'You', team: ffa ? 1 : 0 }];
  let id = 100;
  if (ffa) for (let i = 1; i < { 1: 4, 2: 6, 4: 8 }[opts.size]; i++) { roster.push({ id, name: names.pop(), team: id, bot: true }); id++; }
  else {
    for (let i = 1; i < opts.size; i++) roster.push({ id: id++, name: names.pop(), team: 0, bot: true });
    for (let i = 0; i < opts.size; i++) roster.push({ id: id++, name: names.pop(), team: 1, bot: true });
  }
  const m = new Match({ mode: opts.mode, teamSize: opts.size, map, noHardscope: opts.hard, emit: msg => { onMsg(msg); if (G.bots) G.bots.onEvent(msg); } });
  G.bots = null;
  const botClasses = DEFAULT_CLASSES.filter(c => c.name !== 'Semi-Auto');
  for (const r of roster) m.addPlayer({ ...r, loadout: r.bot ? botClasses[Math.floor(Math.random() * botClasses.length)] : myClass() });
  G.match = m;
  G.noHardscope = opts.hard;
  beginMatch({ me: 1, roster, mode: opts.mode, teamSize: opts.size, map, kind: 'practice' });
  G.bots = new Bots(m, opts.diff);
  for (const r of roster) if (r.bot) G.bots.add(m.players.get(r.id));
  setTimeout(() => G.match === m && m.start(), 600);
}

// ---------- input ----------
const keys = new Set();
let mdx = 0, mdy = 0, rmb = false, fireQueued = false, padCrouch = 0, padSprint = false, padX = null, padB = null;
const pressedKeys = new Set();
const locked = () => document.pointerLockElement === canvas;
function lockPointer() { if (inputMode !== 'kb' || noGL) return; try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch {} }
function unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  inputMode = 'kb';
  if (!keys.has(e.code)) pressedKeys.add(e.code);
  keys.add(e.code);
  if (['Tab', 'Space'].includes(e.code) && G.on) e.preventDefault();
  if (e.code === 'Escape' && G.on && !G.over && G.menuOpen) resume();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('mousemove', e => { if (locked()) { mdx += e.movementX; mdy += e.movementY; inputMode = 'kb'; } });
canvas.addEventListener('mousedown', e => {
  ac();
  if (!G.on || G.menuOpen) return;
  if (!locked()) { inputMode = 'kb'; lockPointer(); return; }
  if (e.button === 0) fireQueued = true;
  if (e.button === 2) rmb = true;
});
addEventListener('mouseup', e => { if (e.button === 2) rmb = false; });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  if (!locked() && G.on && !G.over && !G.menuOpen && inputMode === 'kb') pause();
});
addEventListener('gamepadconnected', () => { $('padhint').textContent = '🎮 Controller ready'; });
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
    const mg = Math.hypot(x, y);
    if (mg < cfg.dz) return [0, 0];
    const s = Math.min(1, (mg - cfg.dz) / (1 - cfg.dz));
    return [x / mg * s, y / mg * s];
  };
  const ax = gp.axes;
  PAD = {
    gp, cur, prev,
    pressed: i => !!cur[i] && !prev[i],
    released: i => !cur[i] && !!prev[i],
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
  const items = [...scr.querySelectorAll('button,select,input')].filter(e => !e.disabled && e.offsetParent);
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
    if (el.tagName === 'SELECT') { el.selectedIndex = clamp(el.selectedIndex + lr, 0, el.options.length - 1); el.dispatchEvent(new Event('change')); }
  }
  if (PAD.pressed(0) && el && items.includes(el)) {
    if (el.tagName === 'BUTTON') el.click();
    else if (el.type === 'checkbox') { el.checked = !el.checked; el.dispatchEvent(new Event('change')); }
    else if (el.tagName === 'SELECT') { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('change')); }
  }
  if (PAD.pressed(1)) { const b = scr.querySelector('[data-act=back],[data-act=resume],[data-act=cancelQueue]'); if (b) b.click(); }
  if (PAD.pressed(9) && G.menuOpen) resume();
}

const nearObjective = () => {
  if (G.mode !== 'sd' || !L.alive || G.phase !== 'live') return null;
  const att = G.attackers === G.myTeam;
  if (att && !G.bomb) {
    const i = G.map.sites.findIndex(s => Math.hypot(L.pos[0] - s.pos[0], L.pos[2] - s.pos[2]) < SITE_RADIUS && Math.abs(L.pos[1] - s.pos[1]) < 1.5);
    return i >= 0 ? { verb: 'plant the bomb', dur: RULES.plant } : null;
  }
  if (!att && G.bomb) {
    const s = G.map.sites[G.bomb[0]].pos;
    return Math.hypot(L.pos[0] - s[0], L.pos[2] - s[2]) < SITE_RADIUS ? { verb: 'defuse the bomb', dur: RULES.defuse } : null;
  }
  return null;
};

function readInput(dt) {
  const fovScale = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(cfg.fov / 2));
  const inp = { mx: 0, mz: 0, look: [0, 0], fire: false, ads: false, jump: false, sprint: false, breath: false, reload: false, knife: false, use: false, skip: false };
  const kp = c => pressedKeys.has(c);
  if (G.menuOpen) { mdx = mdy = 0; fireQueued = false; pressedKeys.clear(); return inp; }
  const s = 0.0022 * cfg.sens * fovScale;
  inp.look[0] = -mdx * s; inp.look[1] = -mdy * s; mdx = mdy = 0;
  if (keys.has('KeyW')) inp.mz += 1;
  if (keys.has('KeyS')) inp.mz -= 1;
  if (keys.has('KeyD')) inp.mx += 1;
  if (keys.has('KeyA')) inp.mx -= 1;
  const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
  inp.jump = kp('Space'); inp.skip = kp('Space') || fireQueued;
  inp.sprint = shift; inp.breath = shift;
  inp.ads = rmb; inp.fire = fireQueued; fireQueued = false;
  inp.reload = kp('KeyR'); inp.knife = kp('KeyG'); inp.use = keys.has('KeyF');
  if (kp('KeyC')) L.stance = L.stance === 1 ? 0 : 1;
  if (kp('KeyZ') || kp('ControlLeft')) L.stance = L.stance === 2 ? 0 : 2;
  if (PAD) {
    const [lx, ly] = PAD.left, [rx, ry] = PAD.right;
    inp.mx += lx; inp.mz -= ly;
    const curve = v => Math.sign(v) * Math.pow(Math.abs(v), 1.7);
    inp.look[0] -= curve(rx) * 4.2 * cfg.psens * fovScale * dt;
    inp.look[1] -= curve(ry) * 2.9 * cfg.psens * fovScale * dt * (cfg.invy ? -1 : 1);
    if (PAD.val(6) > 0.3) inp.ads = true;
    if (PAD.pressed(7)) inp.fire = true;
    if (PAD.pressed(0)) { inp.jump = true; inp.skip = true; }
    if (PAD.pressed(5)) inp.knife = true;
    // B: tap to crouch, hold to go prone
    if (PAD.pressed(1)) padB = G.t;
    if (padB !== null && PAD.cur[1] && G.t - padB > 0.3) { L.stance = 2; padB = null; }
    if (PAD.released(1) && padB !== null) { L.stance = L.stance === 1 ? 0 : 1; padB = null; }
    // X: tap to reload, hold to plant/defuse
    if (PAD.pressed(2)) padX = G.t;
    if (padX !== null && PAD.cur[2] && G.t - padX > 0.25) inp.use = true;
    if (PAD.released(2)) { if (padX !== null && G.t - padX <= 0.25) inp.reload = true; padX = null; }
    if (PAD.pressed(10)) padSprint = true;
    if (Math.hypot(lx, ly) < 0.3) padSprint = false;
    if (padSprint) inp.sprint = true;
    if (PAD.cur[10]) inp.breath = true;
    if (PAD.pressed(4)) cycleSpec(-1);
    if (PAD.pressed(5) && !L.alive) cycleSpec(1);
    if (PAD.pressed(9)) pause();
  }
  pressedKeys.clear();
  return inp;
}

function cycleSpec(dir) {
  if (L.alive) return;
  const alive = [...G.players.values()].filter(p => p.alive && p.id !== G.me).sort((a, b) => (isMate(a) ? 0 : 1) - (isMate(b) ? 0 : 1));
  if (!alive.length) return;
  const i = alive.findIndex(p => p.id === G.spec);
  G.spec = alive[(i + dir + alive.length) % alive.length].id;
}

// ---------- local player ----------
function startReload() {
  const s = L.stats;
  if (L.reloadT > 0 || L.mag >= s.mag || L.reserve <= 0) return;
  L.reloadDur = L.reloadT = L.mag === 0 ? s.reload[1] : s.reload[0];
  L.ads = 0;
  sfx.reload(L.reloadT);
}

function updateLocal(dt) {
  const inp = readInput(dt);
  if (G.kc) { if (inp.skip && !G.kc.final) endKillcam(); return; }
  L.yaw += inp.look[0];
  L.pitch = clamp(L.pitch + inp.look[1], -1.5, 1.5);
  L.yawLog.push([G.t, L.yaw]);
  while (L.yawLog.length && L.yawLog[0][0] < G.t - 1) L.yawLog.shift();
  if (!L.alive) { if (inp.fire) cycleSpec(1); return; }
  const s = L.stats, live = G.phase === 'live';
  const perks = L.loadout.perks;

  // reload
  if (L.reloadT > 0 && (L.reloadT -= dt) <= 0) {
    const n = Math.min(s.mag - L.mag, L.reserve);
    L.mag += n; L.reserve -= n; L.reloadT = 0;
  }
  if (inp.reload) startReload();
  if (L.autoReload && G.t >= L.autoReload) { L.autoReload = 0; startReload(); }

  // plant / defuse
  const obj = nearObjective();
  const using = !!(inp.use && obj);
  if (using !== L.using) { L.using = using; send({ t: 'use', on: using }); }

  // sprint (cancels reload and scope, like MW2)
  const moving = Math.hypot(inp.mx, inp.mz) > 0.2;
  const wantSprint = live && inp.sprint && inp.mz > 0.5 && !inp.ads && !L.using && L.stamina > 0;
  if (wantSprint && !L.sprint) { L.stance = 0; L.reloadT = 0; }
  L.sprint = wantSprint;
  if (L.sprint) {
    if (!perks.includes('marathon')) L.stamina -= dt;
    L.sprintOut = perks.includes('lightweight') ? 0.15 : 0.3;
  } else {
    L.sprintOut = Math.max(0, L.sprintOut - dt);
    L.stamina = Math.min(4, L.stamina + dt * (L.stamina <= 0 ? 0.6 : 1.2));
  }

  // scope
  const canAds = inp.ads && L.reloadT <= 0 && !L.sprint && L.sprintOut <= 0 && !L.using;
  if (canAds) { if (L.ads === 0) L.scopeStart = G.t; L.ads = Math.min(1, L.ads + dt / s.ads); }
  else L.ads = Math.max(0, L.ads - dt / 0.12);
  if (L.ads >= 0.95) { if (L.fullT === null) L.fullT = G.t; } else L.fullT = null;

  // hold breath while scoped
  L.breathCd = Math.max(0, L.breathCd - dt);
  L.holding = L.ads >= 0.95 && inp.breath && L.breath > 0 && L.breathCd <= 0 && !L.sprint;
  if (L.holding) { L.breath -= dt; if (L.breath <= 0) { L.breathCd = 2; sfx.breath(); } }
  else L.breath = Math.min(4, L.breath + dt * 0.8);
  if (L.ads >= 0.9) {
    const amp = s.sway * [1, 0.7, 0.35][L.stance] * (L.holding ? 0.05 : L.breathCd > 0 ? 2 : 1);
    swayX = (Math.sin(G.t * 1.3) + Math.sin(G.t * 0.7) * 0.5) * 0.005 * amp;
    swayY = Math.sin(G.t * 1.9) * 0.0035 * amp;
  } else { swayX *= 0.8; swayY *= 0.8; }

  // movement
  let wx = 0, wz = 0, speed = 0;
  if (live && !L.using) {
    const fx = -Math.sin(L.yaw), fz = -Math.cos(L.yaw), rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    wx = fx * inp.mz + rx * inp.mx; wz = fz * inp.mz + rz * inp.mx;
    const l = Math.hypot(wx, wz); if (l > 1) { wx /= l; wz /= l; }
    speed = 5.5 * s.move * (perks.includes('lightweight') ? 1.07 : 1) * [1, 0.55, 0.2][L.stance];
    if (L.sprint) speed *= 1.45;
    if (L.ads > 0.3) speed *= 0.45;
  }
  let jump = false;
  if (live && inp.jump) { if (L.stance > 0) L.stance = 0; else jump = true; }
  stepBody(G.map, L, dt, wx, wz, speed, jump, L.stance);
  if (moving && L.grounded && !perks.includes('ninja') && L.stance < 2) {
    L.stepAcc += Math.hypot(L.vel[0], L.vel[2]) * dt;
    if (L.stepAcc > (L.sprint ? 2.6 : 2.1)) { L.stepAcc = 0; sfx.step(L.stance ? 0.08 : 0.15, 0); }
  }

  // shooting
  if (inp.fire && live) tryFire();
  if (inp.knife && live && L.knives > 0 && !L.sprint) {
    L.knives--;
    const eye = [L.pos[0], L.pos[1] + STANCES[L.stance].eye, L.pos[2]], d = fwd(L.yaw, L.pitch + 0.05);
    send({ t: 'knife', o: eye, v: [d[0] * 24, d[1] * 24 + 1.5, d[2] * 24] });
    sfx.whoosh();
  }
}

function tryFire() {
  const s = L.stats;
  if (G.t < L.nextShot || L.reloadT > 0 || L.sprint || L.sprintOut > 0 || L.using) return;
  if (L.mag <= 0) { sfx.dry(); startReload(); return; }
  const eye = [L.pos[0], L.pos[1] + STANCES[L.stance].eye, L.pos[2]];
  let d = fwd(L.yaw + swayX, L.pitch + swayY);
  if (L.ads < 0.95) {
    const moving = Math.hypot(L.vel[0], L.vel[2]) > 1;
    const spread = THREE.MathUtils.degToRad(s.hip) * (1 - L.ads) * (moving ? 1.25 : 1) * [1, 0.85, 0.7][L.stance] * (L.grounded ? 1 : 1.3);
    d = norm([d[0] + rnd() * spread, d[1] + rnd() * spread, d[2] + rnd() * spread]);
  }
  let spin = 0;
  for (let i = 1; i < L.yawLog.length; i++) spin += Math.abs(L.yawLog[i][1] - L.yawLog[i - 1][1]);
  send({ t: 'shot', o: eye, d, meta: { ads: L.ads, scopeT: G.t - L.scopeStart, spin, air: !L.grounded } });
  G.events.push({ t: G.t, type: 'shot', id: G.me, o: eye, d, end: Math.min(rayBoxes(G.map, eye, d), 300) });
  L.mag--;
  L.nextShot = G.t + s.interval;
  L.recoil = 1;
  L.pitch = Math.min(1.5, L.pitch + s.recoil * (0.7 + Math.random() * 0.6));
  L.yaw += (Math.random() - 0.5) * s.recoil * 0.4;
  sfx.shot(s.key, 1, 0);
  if (s.fire === 'bolt') sfx.bolt(0.3);
  rumble(0.8, 0.3, 120);
  muzzleFlash();
  if (L.mag === 0 && L.reserve > 0) L.autoReload = G.t + s.interval * 0.8;
}

// ---------- HUD ----------
const mini = $('mini').getContext('2d');
function drawMinimap() {
  const W = 170, sc = 2.4, c = mini;
  c.clearRect(0, 0, W, W);
  c.save();
  c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2); c.clip();
  c.translate(W / 2, W / 2);
  const view = G.kc ? null : L.alive ? { x: L.pos[0], z: L.pos[2], yaw: L.yaw } : null;
  const sp = !view && G.players.get(G.spec);
  const v = view || (sp ? { x: sp.pos[0], z: sp.pos[2], yaw: sp.yaw } : { x: 0, z: 0, yaw: 0 });
  c.rotate(v.yaw);
  c.translate(-v.x * sc, -v.z * sc);
  for (const b of G.map.boxes) {
    if (b.max[1] < -1) continue;
    c.fillStyle = b.kind === 'roof' ? '#ffffff14' : b.max[1] - b.min[1] > 2.5 ? '#ffffff55' : '#ffffff30';
    c.fillRect(b.min[0] * sc, b.min[2] * sc, (b.max[0] - b.min[0]) * sc, (b.max[2] - b.min[2]) * sc);
  }
  if (G.mode === 'sd') {
    c.font = 'bold 14px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    G.map.sites.forEach((s, i) => {
      c.save(); c.translate(s.pos[0] * sc, s.pos[2] * sc); c.rotate(-v.yaw);
      c.fillStyle = G.bomb && G.bomb[0] === i ? '#ff4040' : '#ffd400'; c.fillText(s.name, 0, 0); c.restore();
    });
  }
  for (const p of G.players.values()) {
    if (p.id === G.me || !p.alive) continue;
    const mate = isMate(p), fired = G.t - (G.fired.get(p.id) || -9) < 1.5;
    if (!mate && !fired) continue;
    c.fillStyle = mate ? '#5aa0ff' : '#ff4040';
    c.beginPath(); c.arc(p.pos[0] * sc, p.pos[2] * sc, 4, 0, Math.PI * 2); c.fill();
  }
  c.restore();
  c.fillStyle = '#ffd400';
  c.beginPath(); c.moveTo(W / 2, W / 2 - 7); c.lineTo(W / 2 - 5, W / 2 + 5); c.lineTo(W / 2 + 5, W / 2 + 5); c.fill();
}

function boardHtml() {
  const row = p => `<tr><td>${pname(p)}${p.id === G.me ? ' (you)' : ''}</td><td>${p.score}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`;
  const head = t => `<tr><th>${t}</th><th>Score</th><th>K</th><th>D</th></tr>`;
  const all = [...G.players.values()].sort((a, b) => b.score - a.score || b.kills - a.kills);
  if (G.ffa) return `<table>${head('Players')}${all.map(row).join('')}</table>`;
  return [G.myTeam, 1 - G.myTeam].map(t => `<table>${head((t === G.myTeam ? 'Your team' : 'Enemy') + ' — ' + G.scores[t])}${all.filter(p => p.team === t).map(row).join('')}</table>`).join('');
}

let lastBoard = 0;
function updateHud() {
  const sc = G.scores, me = G.players.get(G.me);
  const left = Math.max(0, Math.ceil(G.bomb ? G.bomb[1] : G.left));
  $('timer').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('timer').style.color = G.bomb ? '#ff5050' : '#fff';
  if (G.ffa) {
    const others = [...G.players.values()].filter(p => p.id !== G.me).sort((a, b) => b.kills - a.kills);
    $('sA').textContent = me ? me.kills : 0;
    $('sB').textContent = others[0] ? others[0].kills : 0;
    $('alive').textContent = '';
    $('roundinfo').textContent = `FREE-FOR-ALL · FIRST TO ${MODES.ffa.limit}${others[0] ? ' · TOP ENEMY: ' + others[0].name : ''}`;
  } else {
    $('sA').textContent = sc[G.myTeam]; $('sB').textContent = sc[1 - G.myTeam];
    if (G.cfg.rounds) {
      let a = '', b = '';
      for (const p of G.players.values()) {
        const alive = p.id === G.me ? L.alive : p.alive;
        if (p.team === G.myTeam) a += alive ? '●' : '○'; else b += alive ? '●' : '○';
      }
      $('alive').innerHTML = `<span style="color:#7fb2ff">${a}</span> &nbsp; <span style="color:#ff7a7a">${b}</span>`;
      const side = G.mode === 'sd' ? (G.attackers === G.myTeam ? ' · ATTACKING' : ' · DEFENDING') : '';
      $('roundinfo').textContent = `${G.cfg.short} · ROUND ${G.round} · FIRST TO ${G.cfg.roundsToWin}${side}${G.bomb ? ' · BOMB PLANTED' : ''}`;
    } else {
      $('alive').textContent = '';
      $('roundinfo').textContent = `TEAM DEATHMATCH · FIRST TO ${MODES.tdm.limit[G.teamSize] || 20}`;
    }
  }
  const s = L.stats;
  $('wname').textContent = s.name + (s.att !== 'none' ? ' · ' + ATTACH[s.att].name : '');
  $('mag').textContent = L.mag; $('res').textContent = '/ ' + L.reserve;
  $('knives').textContent = L.knives ? `🔪 Throwing knife ×${L.knives} [${inputMode === 'pad' ? 'RB' : 'G'}]` : '';
  $('ammo').style.display = L.alive && !G.kc ? 'block' : 'none';
  const cyc = clamp(1 - (L.nextShot - G.t) / s.interval, 0, 1);
  const reloading = L.reloadT > 0;
  $('bolt').style.display = L.alive && !G.kc && (cyc < 1 || reloading) ? 'block' : 'none';
  $('bolt').firstChild.style.width = (reloading ? 1 - L.reloadT / L.reloadDur : cyc) * 100 + '%';
  $('stam').style.display = L.alive && L.stamina < 4 && !L.loadout.perks.includes('marathon') ? 'block' : 'none';
  $('stam').firstChild.style.width = (L.stamina / 4) * 100 + '%';
  if (!G.kc) {
    $('scope').style.opacity = L.alive ? clamp((L.ads - 0.6) / 0.3, 0, 1) : 0;
    $('dot').style.display = L.alive && L.ads < 0.3 ? 'block' : 'none';
  } else $('dot').style.display = 'none';
  $('hard').style.display = G.noHardscope && L.alive && L.fullT !== null && G.t - L.fullT > RULES.hardscope && !G.kc ? 'block' : 'none';
  const obj = nearObjective();
  $('use').style.display = obj && !G.kc ? 'block' : 'none';
  if (obj) {
    $('usetext').textContent = `Hold [${inputMode === 'pad' ? 'X' : 'F'}] to ${obj.verb}`;
    $('usebar').style.width = clamp((me ? me.useP : 0) / obj.dur, 0, 1) * 100 + '%';
  }
  const sp = !L.alive && G.players.get(G.spec);
  $('spec').innerHTML = !L.alive && !G.kc && G.phase !== 'over'
    ? (G.cfg.respawn ? 'Respawning…' : sp ? `Spectating ${pname(sp)} · ${inputMode === 'pad' ? 'LB/RB' : 'click'} to switch` : 'Waiting for next round…')
    : '';
  // enemy name under the crosshair (not for Cold-Blooded targets)
  let ename = '';
  if (L.alive && !G.kc) {
    const o = [camera.position.x, camera.position.y, camera.position.z], d = fwd(L.yaw + swayX, L.pitch + swayY);
    const wall = rayBoxes(G.map, o, d);
    let best = Math.min(wall, 90);
    for (const p of G.players.values()) {
      if (!p.alive || p.id === G.me || isMate(p) || (p.loadout && p.loadout.perks.includes('coldblooded'))) continue;
      for (const z of hitZones(p.pos, p.stance)) { const t = rayAABB(o, d, z.min, z.max); if (t < best) { best = t; ename = p.name; } }
    }
  }
  $('ename').textContent = ename;
  $('hudhint').textContent = inputMode === 'pad'
    ? 'LT scope · RT fire · A jump · B crouch/prone · X reload (hold: plant) · RB knife · L3 sprint/breath · Back scores'
    : 'RMB scope · LMB fire · Shift sprint/breath · Space jump · C crouch · Z prone · R reload · F plant · G knife · Tab scores';
  drawMinimap();
  const showBoard = (keys.has('Tab') || (PAD && (PAD.cur[8] || PAD.cur[3]))) && !document.querySelector('.screen.on');
  $('board').classList.toggle('on', !!showBoard);
  if (showBoard && G.t - lastBoard > 0.25) { lastBoard = G.t; $('boardbody').innerHTML = boardHtml(); }
}

// ---------- menu actions ----------
function pause() {
  if (!G.on || G.over) return;
  G.menuOpen = true; G.paused = G.kind === 'practice'; rmb = false;
  if (L.using) { L.using = false; send({ t: 'use', on: false }); }
  unlockPointer(); screen('pause');
}
function resume() { G.menuOpen = false; G.paused = false; screen(null); lockPointer(); }
function leave() {
  if (G.kind === 'online' && G.on) send({ t: 'leave' });
  G.on = false; G.match = null; G.bots = null; G.kind = null; G.menuOpen = false; G.over = false; G.kc = null;
  clearPlayers(); clearFx(); L.alive = false;
  $('hud').classList.remove('on'); $('board').classList.remove('on'); $('kc').style.display = 'none';
  unlockPointer(); screen('menu');
}
function findMatch() {
  if (noGL) return;
  if (!ws || ws.readyState !== 1) { $('qtext').textContent = 'Server offline — try Practice instead.'; screen('queue'); return; }
  const mode = $('omode').value;
  send({ t: 'queue', mode, size: +$('osize').value, name: cfg.name || 'Player', code: $('code').value, loadout: myClass() });
  $('qtext').textContent = `Searching for ${MODES[mode].name}…`;
  screen('queue');
}
const ACTIONS = {
  play: () => screen('play'), practice: () => screen('practice'), rules: () => screen('rules'), settings: () => screen('settings'),
  classes: () => { showClass(); screen('classes'); },
  back: () => screen('menu'), findMatch, startPractice: () => startPractice(), resume, leave,
  rematch: () => { const o = G.practiceOpts; leave(); startPractice(o); },
  applyClass: () => { send({ t: 'class', loadout: myClass() }); banner(`${myClass().name} — next spawn`, 1500); resume(); },
  cancelQueue: () => { send({ t: 'leaveQueue' }); screen('menu'); },
};
{
  const b = document.createElement('button');
  b.id = 'rematch'; b.dataset.act = 'rematch'; b.textContent = 'Play again';
  $('end').querySelector('.card').insertBefore(b, $('end').querySelector('[data-act=leave]'));
}
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { ac(); sfx.click(); ACTIONS[b.dataset.act](); }));

// ---------- main loop ----------
addEventListener('resize', resize); resize();
function poseAvatar(p, x, y, z, yaw, stance, alive) {
  const g = p.av.g;
  g.position.set(x, y + (alive ? (stance === 2 ? 0.3 : 0) : 0.15), z);
  g.rotation.set(alive ? (stance === 2 ? -Math.PI / 2 : 0) : Math.PI / 2, yaw, 0);
  p.av.body.scale.y = alive && stance === 1 ? 0.72 : 1;
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  pollPad();
  if (document.querySelector('.screen.on')) menuPad();

  if (G.on) {
    if (!G.paused) {
      G.t += dt;
      G.left = Math.max(0, G.left - dt);
      if (G.bomb) { const prev = G.bomb[1]; G.bomb[1] = Math.max(0, G.bomb[1] - dt); if (Math.floor(prev * (prev < 10 ? 2 : 1)) !== Math.floor(G.bomb[1] * (G.bomb[1] < 10 ? 2 : 1))) sfx.beep(G.bomb[1] < 10); }
      if (G.kind === 'practice' && G.match) { G.bots.update(dt); G.match.step(dt); if (G.match) onMsg(G.match.snapshot()); }
      updateLocal(dt);
      if (L.alive && !G.kc && (G.kind === 'practice' || G.t - G.lastSend > 0.05)) {
        G.lastSend = G.t;
        send({ t: 'state', pos: L.pos.map(v => Math.round(v * 100) / 100), yaw: L.yaw, pitch: L.pitch, stance: L.stance, ads: L.ads, sprint: L.sprint });
      }
      if (G.pendingKC && G.t >= G.pendingKC.at && !L.alive) { const k = G.pendingKC; G.pendingKC = null; startKillcam(k.killer, k.victim, k.tKill, false); }
    }
    // remote avatars
    for (const p of G.players.values()) {
      if (p.id === G.me) { p.pos = [...L.pos]; p.yaw = L.yaw; p.stance = L.stance; p.alive = L.alive; continue; }
      const k = Math.min(1, dt * 16);
      if (Math.hypot(p.tpos[0] - p.pos[0], p.tpos[2] - p.pos[2]) > 6) p.pos = [...p.tpos];
      for (let i = 0; i < 3; i++) p.pos[i] += (p.tpos[i] - p.pos[i]) * k;
      p.yaw += angDiff(p.yaw, p.tyaw) * k;
      // footsteps you can hear (Ninja is silent)
      const moved = Math.hypot(p.pos[0] - p.last[0], p.pos[2] - p.last[2]);
      p.last = [...p.pos];
      if (p.alive && moved < 1 && Math.abs(p.tpos[1] - p.pos[1]) < 0.05 && p.stance < 2 && !(p.loadout && p.loadout.perks.includes('ninja'))) {
        p.stepAcc += moved;
        if (p.stepAcc > (p.sprint ? 2.6 : 2.1)) {
          p.stepAcc = 0;
          const v = new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]).applyMatrix4(camera.matrixWorldInverse), dist = v.length();
          if (dist < 25) sfx.step((p.sprint ? 0.5 : 0.35) * (p.stance ? 0.5 : 1) * (1 - dist / 25), v.x / (dist + 1));
        }
      }
    }
    if (!G.kc) {
      for (const p of G.players.values()) {
        poseAvatar(p, p.pos[0], p.pos[1], p.pos[2], p.yaw, p.stance, p.alive);
        p.av.g.visible = p.id !== G.me && !(G.spec === p.id && !L.alive) && (p.alive || G.cfg.rounds);
      }
    }
    // camera
    if (G.kc) {
      if (!G.paused) playKillcam(dt);
    } else if (L.alive) {
      camera.position.set(L.pos[0], L.pos[1] + STANCES[L.stance].eye, L.pos[2]);
      L.recoil = Math.max(0, L.recoil - dt * 5);
      camera.rotation.set(L.pitch + swayY + L.recoil * 0.02, L.yaw + swayX, 0);
      const e = L.ads * L.ads * (3 - 2 * L.ads);
      camera.fov = cfg.fov + (cfg.fov / L.stats.zoom - cfg.fov) * e;
    } else {
      let sp = G.players.get(G.spec);
      if (!sp || !sp.alive) { G.spec = null; cycleSpec(1); sp = G.players.get(G.spec); }
      if (sp && sp.alive) {
        camera.position.set(sp.pos[0], sp.pos[1] + STANCES[sp.stance].eye, sp.pos[2]);
        camera.rotation.set(sp.pitch, sp.yaw, 0);
        camera.fov = cfg.fov;
      } else {
        const a = G.t * 0.1, m = G.map.bounds;
        camera.position.set(Math.cos(a) * m.x * 0.8, 18, Math.sin(a) * m.z * 0.8);
        camera.lookAt(0, 0, 0); camera.fov = cfg.fov;
      }
    }
    camera.updateProjectionMatrix();
    if (!G.kc) {
      // viewmodel: bolt cycle, reload dip, sprint tilt, bob
      const s = L.stats, speed = Math.hypot(L.vel[0], L.vel[2]);
      const bob = Math.sin(G.t * (L.sprint ? 14 : 10)) * Math.min(1, speed / 6) * (L.sprint ? 0.025 : 0.012);
      const cyc = clamp(1 - (L.nextShot - G.t) / s.interval, 0, 1);
      const boltAnim = s.fire === 'bolt' && cyc < 1 && cyc > 0.2 ? Math.sin(((cyc - 0.2) / 0.8) * Math.PI) : 0;
      const reload = L.reloadT > 0 ? Math.sin(clamp(1 - L.reloadT / L.reloadDur, 0, 1) * Math.PI) : 0;
      const e = L.ads;
      vm.position.set(0.2 * (1 - e) + (L.sprint ? 0.06 : 0), -0.2 + e * 0.12 + bob - boltAnim * 0.05 - reload * 0.15, -0.35 + L.recoil * 0.08);
      vm.rotation.set(L.recoil * 0.12 + boltAnim * 0.2 - reload * 0.4, (L.sprint ? 0.5 : 0) * (1 - e), boltAnim * 0.45 + reload * 0.3);
      if (vm.userData.bolt) vm.userData.bolt.position.z = 0.12 + boltAnim * 0.12;
      vm.visible = L.alive && L.ads < 0.75;
    }
    record();
    tickBomb(G.t);
    updateHud();
  } else {
    const a = now / 1000 * 0.06, m = G.map.bounds;
    camera.position.set(Math.cos(a) * m.x * 1.1, 16, Math.sin(a) * m.z * 1.1);
    camera.lookAt(0, 2, 0);
    camera.fov = 60; camera.updateProjectionMatrix();
    vm.visible = false;
  }
  stepFx(dt, G.map, stepProjectile);
  render();
}
G.map = loadMap(MAP_KEYS[Math.floor(Math.random() * MAP_KEYS.length)]);
requestAnimationFrame(frame);

// debug hook for automated testing
window.__qs = { G, L, startPractice, onMsg };
