// Authoritative MLG quickscope rules. Runs on the server for online games and in the browser for practice.
import { MAPS, STANCES, SITE_RADIUS, rayAABB, bulletStop, lineClear, hitZones, stepProjectile } from './map.js';
import { WEAPON_KEYS, weaponStats, sanitizeLoadout } from './weapons.js';

export const MODES = {
  elim: { name: 'Elimination', short: 'ELIM', rounds: true, roundsToWin: 6, roundTime: 90, teams: true,
    desc: 'One life per round. Wipe the other team. First to 6 rounds.' },
  sd: { name: 'Search & Destroy', short: 'S&D', rounds: true, roundsToWin: 4, roundTime: 120, teams: true,
    desc: 'One life per round. Attackers plant at A or B, defenders stop or defuse it. Sides swap every round. First to 4.' },
  tdm: { name: 'Team Deathmatch', short: 'TDM', respawn: true, teams: true, limit: { 1: 10, 2: 20, 4: 30 }, time: 480,
    desc: 'Respawns on. First team to the kill limit.' },
  ffa: { name: 'Free-for-All', short: 'FFA', respawn: true, teams: false, limit: 15, time: 480,
    desc: 'Everyone for themselves. First to 15 kills.' },
};
export const RULES = { hardscope: 1.0, bombFuse: 40, plant: 5, defuse: 7, countdown: 5, roundCountdown: 4, roundEnd: 4.5, respawn: 7, minRespawn: 1.2 };

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const r2 = v => Math.round(v * 100) / 100;
const vec3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export class Match {
  constructor({ mode = 'elim', teamSize = 2, map = 'dustbowl', noHardscope = true, emit }) {
    this.mode = MODES[mode] ? mode : 'elim';
    this.cfg = MODES[this.mode];
    this.ffa = !this.cfg.teams;
    this.map = MAPS[map] || MAPS.dustbowl;
    this.noHardscope = noHardscope;
    this.teamSize = teamSize;
    this.emit = emit;
    this.players = new Map();
    this.time = 0;
    this.phase = 'waiting';
    this.phaseEnd = 0;
    this.scores = [0, 0];
    this.round = 0;
    this.attackers = 0;
    this.bomb = null;
    this.knives = [];
    this.knifeId = 1;
    this.firstBlood = false;
    this.lastKill = null;
  }

  get limit() { const l = this.cfg.limit; return typeof l === 'object' ? l[this.teamSize] || 20 : l; }
  isEnemy(a, b) { return a.id !== b.id && (this.ffa || a.team !== b.team); }
  members(team) { return [...this.players.values()].filter(p => p.team === team); }
  aliveCount(team) { return this.members(team).filter(p => p.alive).length; }

  addPlayer({ id, name, team, bot = false, loadout }) {
    const p = {
      id, name, team, bot, alive: false, pos: [0, 0, 0], yaw: 0, pitch: 0, stance: 0, ads: 0, sprint: false,
      loadout: null, pending: null, stats: null, lastShot: -99, kills: 0, deaths: 0, score: 0,
      lastKiller: null, respawnAt: Infinity, knives: 0, using: false, useP: 0, multi: 0, multiT: -99, spawnT: 0,
    };
    this.players.set(id, p);
    this.setLoadout(id, loadout, true);
    return p;
  }

  setLoadout(id, l, now = false) {
    const p = this.players.get(id);
    if (!p) return;
    const clean = sanitizeLoadout(l);
    if (now || !p.alive) { p.loadout = clean; p.stats = weaponStats(clean); p.pending = null; } else p.pending = clean;
  }

  // ---------- spawning ----------
  spawnPlayer(p, s) {
    if (p.pending) { p.loadout = p.pending; p.stats = weaponStats(p.pending); p.pending = null; }
    p.alive = true;
    p.pos[0] = s[0]; p.pos[1] = s[1]; p.pos[2] = s[2];
    p.yaw = s[3]; p.pitch = 0; p.stance = 0; p.ads = 0; p.sprint = false;
    p.knives = p.loadout.lethal === 'tknife' ? 1 : 0;
    p.using = false; p.useP = 0; p.spawnT = this.time; p.respawnAt = Infinity; p.lastShot = -99;
    this.emit({ t: 'spawn', id: p.id, pos: [s[0], s[1], s[2]], yaw: s[3], loadout: p.loadout });
  }

  pickRespawn(p) {
    const foes = [...this.players.values()].filter(v => v.alive && this.isEnemy(p, v));
    let best = null, bestScore = -Infinity;
    for (const s of this.map.respawns) {
      let dFoe = 40;
      for (const f of foes) dFoe = Math.min(dFoe, Math.hypot(f.pos[0] - s[0], f.pos[2] - s[2]));
      const seen = foes.some(f => lineClear(this.map, [f.pos[0], f.pos[1] + 1.6, f.pos[2]], [s[0], s[1] + 1.6, s[2]]));
      const score = dFoe - (seen ? 25 : 0) + Math.random() * 8;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best || this.map.spawns[0][0];
  }

  teamSpawns() {
    if (this.ffa) {
      for (const p of this.players.values()) this.spawnPlayer(p, this.pickRespawn(p));
      return;
    }
    // S&D: attackers always start on the north side; elimination swaps sides every round
    const side = team => (this.mode === 'sd' ? (team === this.attackers ? 0 : 1) : this.cfg.rounds ? (team + this.round + 1) % 2 : team);
    for (const team of [0, 1]) {
      const pts = this.map.spawns[side(team)].slice().sort(() => Math.random() - 0.5);
      this.members(team).forEach((p, i) => this.spawnPlayer(p, pts[i % pts.length]));
    }
  }

  emitPhase(extra = {}) {
    this.emit({ t: 'phase', phase: this.phase, n: this.round, scores: [...this.scores], dur: Math.max(0, this.phaseEnd - this.time),
      attackers: this.attackers, ...extra });
  }

  start() {
    if (this.cfg.rounds) return this.startRound();
    this.phase = 'countdown';
    this.phaseEnd = this.time + RULES.countdown;
    this.teamSpawns();
    this.emitPhase();
  }

  startRound() {
    this.round++;
    if (this.mode === 'sd') this.attackers = (this.round - 1) % 2;
    this.bomb = null;
    this.knives = [];
    this.phase = 'countdown';
    this.phaseEnd = this.time + RULES.roundCountdown;
    this.teamSpawns();
    this.emitPhase();
  }

  endRound(winner, reason) {
    if (this.phase !== 'live') return;
    if (winner >= 0) this.scores[winner]++;
    this.phase = 'roundend';
    this.phaseEnd = this.time + RULES.roundEnd;
    for (const p of this.players.values()) { p.using = false; p.useP = 0; }
    this.emitPhase({ winner, reason });
    if (winner >= 0 && this.scores[winner] >= this.cfg.roundsToWin) this.finish(winner);
  }

  leader() {
    if (this.ffa) {
      let best = null;
      for (const p of this.players.values()) if (!best || p.kills > best.kills) best = p;
      return best ? best.id : -1;
    }
    return this.scores[0] === this.scores[1] ? -1 : this.scores[0] > this.scores[1] ? 0 : 1;
  }

  finish(winner) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    const lk = this.lastKill && this.time - this.lastKill.time < 6 ? this.lastKill : null;
    this.emit({ t: 'over', winner, scores: [...this.scores], ffa: this.ffa, finalKill: lk && { killer: lk.killer, victim: lk.victim } });
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.alive = false;
    this.players.delete(id);
    this.emit({ t: 'left', id });
    if (this.phase === 'over') return;
    if (this.ffa) {
      if (this.players.size < 2) this.finish(this.leader());
    } else if (this.members(p.team).length === 0) this.finish(1 - p.team);
    else if (this.cfg.rounds && this.phase === 'live') this.checkElim();
  }

  // ---------- simulation ----------
  step(dt) {
    this.time += dt;
    this.stepKnives(dt);
    if (this.phase === 'countdown' && this.time >= this.phaseEnd) {
      this.phase = 'live';
      this.phaseEnd = this.time + (this.cfg.rounds ? this.cfg.roundTime : this.cfg.time);
      this.emitPhase();
    } else if (this.phase === 'live') {
      for (const p of this.players.values()) {
        if (p.alive && p.pos[1] < this.map.voidY) this.kill(p, null, { weapon: 'Fell' });
        else if (!p.alive && this.cfg.respawn && this.time >= p.respawnAt) this.spawnPlayer(p, this.pickRespawn(p));
      }
      if (this.mode === 'sd') this.sdStep(dt);
      if (this.phase === 'live' && this.time >= this.phaseEnd) this.timeUp();
    } else if (this.phase === 'roundend' && this.time >= this.phaseEnd) {
      this.startRound();
    }
  }

  timeUp() {
    if (this.mode === 'sd') {
      if (!this.bomb) this.endRound(1 - this.attackers, 'time');
    } else if (this.cfg.rounds) {
      const a0 = this.aliveCount(0), a1 = this.aliveCount(1);
      this.endRound(a0 === a1 ? -1 : a0 > a1 ? 0 : 1, 'time');
    } else this.finish(this.leader());
  }

  sdStep(dt) {
    for (const p of this.players.values()) {
      if (!p.alive || !p.using) { p.useP = 0; continue; }
      const att = p.team === this.attackers;
      let ok = false;
      if (att && !this.bomb) {
        const i = this.map.sites.findIndex(s => Math.hypot(p.pos[0] - s.pos[0], p.pos[2] - s.pos[2]) < SITE_RADIUS && Math.abs(p.pos[1] - s.pos[1]) < 1.5);
        if (i >= 0) {
          ok = true;
          p.useP += dt;
          if (p.useP >= RULES.plant) {
            this.bomb = { site: i, pos: [...this.map.sites[i].pos], explodeAt: this.time + RULES.bombFuse };
            this.phaseEnd = this.bomb.explodeAt + 1;
            p.useP = 0; p.using = false; p.score += 200;
            this.emit({ t: 'bomb', state: 'planted', site: i, by: p.id, fuse: RULES.bombFuse });
          }
        }
      } else if (!att && this.bomb && Math.hypot(p.pos[0] - this.bomb.pos[0], p.pos[2] - this.bomb.pos[2]) < SITE_RADIUS) {
        ok = true;
        p.useP += dt;
        if (p.useP >= RULES.defuse) {
          p.score += 200;
          this.emit({ t: 'bomb', state: 'defused', site: this.bomb.site, by: p.id });
          this.bomb = null;
          return this.endRound(1 - this.attackers, 'defused');
        }
      }
      if (!ok) p.useP = 0;
    }
    if (this.bomb && this.time >= this.bomb.explodeAt) {
      const pos = this.bomb.pos;
      this.emit({ t: 'bomb', state: 'exploded', site: this.bomb.site, pos });
      for (const v of [...this.players.values()])
        if (v.alive && Math.hypot(v.pos[0] - pos[0], v.pos[2] - pos[2]) < 12) this.kill(v, null, { weapon: 'Bomb' });
      this.bomb = null;
      this.endRound(this.attackers, 'bomb');
    }
  }

  checkElim() {
    if (this.phase !== 'live') return;
    if (this.mode === 'sd') {
      const def = 1 - this.attackers;
      if (this.aliveCount(def) === 0) this.endRound(this.attackers, 'elim');
      else if (this.aliveCount(this.attackers) === 0 && !this.bomb) this.endRound(def, 'elim');
      return;
    }
    const a0 = this.aliveCount(0), a1 = this.aliveCount(1);
    if (a0 === 0 && a1 === 0) this.endRound(-1, 'elim');
    else if (a0 === 0) this.endRound(1, 'elim');
    else if (a1 === 0) this.endRound(0, 'elim');
  }

  // ---------- player input ----------
  setState(id, s) {
    const p = this.players.get(id);
    if (!p || !p.alive || !s) return;
    if (vec3(s.pos) && Math.hypot(s.pos[0] - p.pos[0], s.pos[1] - p.pos[1], s.pos[2] - p.pos[2]) < 12) {
      p.pos[0] = s.pos[0]; p.pos[1] = s.pos[1]; p.pos[2] = s.pos[2];
    }
    p.yaw = num(s.yaw); p.pitch = num(s.pitch);
    p.stance = [0, 1, 2].includes(s.stance) ? s.stance : 0;
    p.ads = Math.max(0, Math.min(1, num(s.ads)));
    p.sprint = !!s.sprint;
  }

  nearEye(p, o) {
    return vec3(o) && Math.hypot(o[0] - p.pos[0], o[1] - p.pos[1] - STANCES[p.stance].eye, o[2] - p.pos[2]) < 4;
  }

  shoot(id, { o, d, meta = {} } = {}) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.phase !== 'live' || !this.nearEye(p, o) || !vec3(d)) return;
    const s = p.stats;
    if (this.time - p.lastShot < s.interval * 0.75) return;
    p.lastShot = this.time;
    d = norm(d);
    const ads = num(meta.ads), scopeT = num(meta.scopeT, 9), spin = num(meta.spin), air = !!meta.air;
    // MLG: staying fully scoped too long is a hardscope, and hardscope kills don't count
    const hardscope = this.noHardscope && ads >= 0.95 && scopeT > s.ads + RULES.hardscope;
    const wall = bulletStop(this.map, o, d, s.fmj);
    // sniper rounds go through players, so collect every enemy along the line before the wall
    const hits = [];
    for (const v of this.players.values()) {
      if (!v.alive || !this.isEnemy(p, v)) continue;
      let best = Infinity, zone = null;
      for (const z of hitZones(v.pos, v.stance)) {
        const t = rayAABB(o, d, z.min, z.max);
        if (t < best) { best = t; zone = z.zone; }
      }
      if (best < wall.stop) hits.push({ v, t: best, zone });
    }
    hits.sort((a, b) => a.t - b.t);
    const end = Math.min(wall.stop, 300);
    this.emit({ t: 'shot', id, o: o.map(r2), d: d.map(r2), end: r2(end), w: WEAPON_KEYS.indexOf(s.key), hard: hardscope ? 1 : 0 });
    if (!hits.length) return;
    if (hardscope) { this.emit({ t: 'denied', id, reason: 'HARDSCOPE' }); return; }
    const kills = hits.length;
    for (const h of hits)
      this.kill(h.v, p, { weapon: s.name, zone: h.zone, dist: h.t, bullet: true, wallbang: h.t > wall.pierced, collateral: kills > 1, ads, scopeT: scopeT - s.ads, spin, air });
  }

  throwKnife(id, { o, v } = {}) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.phase !== 'live' || !this.nearEye(p, o) || !vec3(v) || p.knives <= 0) return;
    p.knives--;
    const sp = Math.hypot(v[0], v[1], v[2]);
    if (sp > 32) v = v.map(c => (c / sp) * 32);
    const k = { id: this.knifeId++, owner: p.id, pos: [...o], vel: [...v], born: this.time };
    this.knives.push(k);
    this.emit({ t: 'knife', id: k.id, o: o.map(r2), v: v.map(r2), owner: p.id });
  }

  stepKnives(dt) {
    const sub = 4, h = dt / sub;
    for (let i = this.knives.length - 1; i >= 0; i--) {
      const k = this.knives[i], owner = this.players.get(k.owner);
      let done = this.time - k.born > 3 || !owner;
      for (let s = 0; s < sub && !done && !k.stuck; s++) {
        if (stepProjectile(this.map, k, h)) { k.stuck = true; break; }
        for (const v of this.players.values()) {
          if (!v.alive || !this.isEnemy(owner, v)) continue;
          if (hitZones(v.pos, v.stance, 0.15).some(z => k.pos.every((c, a) => c >= z.min[a] && c <= z.max[a]))) {
            done = true;
            const dist = Math.hypot(k.pos[0] - owner.pos[0], k.pos[2] - owner.pos[2]);
            this.kill(v, owner, { weapon: 'Throwing Knife', tknife: true, dist });
            break;
          }
        }
      }
      if (done) { this.knives.splice(i, 1); this.emit({ t: 'knifeEnd', id: k.id }); }
    }
  }

  use(id, on) {
    const p = this.players.get(id);
    if (p) { p.using = !!on && p.alive; if (!p.using) p.useP = 0; }
  }

  respawnNow(id) {
    const p = this.players.get(id);
    if (p && !p.alive && this.cfg.respawn && this.phase === 'live')
      p.respawnAt = Math.min(p.respawnAt, Math.max(this.time, p.respawnAt - RULES.respawn + RULES.minRespawn));
  }

  // ---------- kills ----------
  kill(v, k, info) {
    if (!v.alive) return;
    v.alive = false; v.deaths++; v.using = false; v.useP = 0;
    v.respawnAt = this.time + RULES.respawn;
    const suicide = !k || k === v;
    const medals = [];
    let points = 0;
    if (!suicide) {
      k.kills++;
      points = 100;
      if (info.bullet) {
        if (info.spin >= Math.PI * 1.9) medals.push(info.ads < 0.6 ? '360 NO-SCOPE' : '360');
        else if (info.ads < 0.6) medals.push('NO-SCOPE');
        else if (info.scopeT < 0.3) medals.push('QUICKSCOPE');
        if (info.air) medals.push('JUMPSHOT');
        if (info.zone === 'head') medals.push('HEADSHOT');
        if (info.wallbang) medals.push('WALLBANG');
        if (info.collateral) medals.push('COLLATERAL');
        if (info.dist > 50) medals.push('LONGSHOT');
        points += 50 * medals.length;
      }
      if (info.tknife) { medals.push('BULLSEYE'); points += 100; }
      if (!this.firstBlood) { this.firstBlood = true; medals.push('FIRST BLOOD'); points += 100; }
      if (k.lastKiller === v.id) { medals.push('PAYBACK'); points += 50; k.lastKiller = null; }
      k.multi = this.time - k.multiT < 4 ? k.multi + 1 : 1;
      k.multiT = this.time;
      if (k.multi === 2) medals.push('DOUBLE KILL');
      else if (k.multi === 3) medals.push('TRIPLE KILL');
      else if (k.multi > 3) medals.push('MULTI KILL');
      k.score += points;
      if (this.mode === 'tdm') this.scores[k.team]++;
    }
    v.lastKiller = suicide ? null : k.id;
    this.lastKill = { killer: suicide ? v.id : k.id, victim: v.id, time: this.time };
    this.emit({ t: 'kill', killer: suicide ? v.id : k.id, victim: v.id, weapon: info.weapon, medals, points, suicide, head: info.zone === 'head' });
    if (this.cfg.rounds) this.checkElim();
    else if (!suicide) {
      if (this.ffa && k.kills >= this.limit) this.finish(k.id);
      else if (this.mode === 'tdm' && this.scores[k.team] >= this.limit) this.finish(k.team);
    }
  }

  snapshot() {
    const p = [];
    for (const v of this.players.values())
      p.push([v.id, r2(v.pos[0]), r2(v.pos[1]), r2(v.pos[2]), r2(v.yaw), r2(v.pitch), v.stance, r2(v.ads), v.alive ? 1 : 0,
        WEAPON_KEYS.indexOf(v.stats.key), v.sprint ? 1 : 0, r2(v.useP), v.kills, v.deaths, v.score]);
    const snap = { t: 'snap', p, sc: [...this.scores], left: r2(Math.max(0, this.phaseEnd - this.time)) };
    if (this.mode === 'sd') snap.bomb = this.bomb ? [this.bomb.site, r2(this.bomb.explodeAt - this.time)] : null;
    return snap;
  }
}
