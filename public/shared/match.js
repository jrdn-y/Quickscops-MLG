// Authoritative match rules. Runs on the server for online games and in the browser for practice.
import { rayBoxes, rayAABB, SPAWNS, HEIGHT, HEIGHT_CROUCH } from './map.js';

export const RULES = { roundsToWin: 6, countdown: 4, roundTime: 90, roundEnd: 3.5, bolt: 1.3, warmupRespawn: 2 };

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const r2 = v => Math.round(v * 100) / 100;

export class Match {
  constructor({ teamSize, emit, warmup = false }) {
    this.teamSize = teamSize;
    this.emit = emit;
    this.warmup = warmup;
    this.players = new Map();
    this.time = 0;
    this.phase = 'waiting';
    this.phaseEnd = 0;
    this.scores = [0, 0];
    this.round = 0;
  }

  addPlayer({ id, name, team, bot = false }) {
    this.players.set(id, {
      id, name, team, bot, alive: false, pos: [0, 0, 0], yaw: 0, pitch: 0, crouch: false, ads: 0,
      lastShot: -99, kills: 0, deaths: 0, respawnAt: 0,
    });
  }

  members(team) { return [...this.players.values()].filter(p => p.team === team); }
  aliveCount(team) { return this.members(team).filter(p => p.alive).length; }

  start() {
    if (this.warmup) {
      this.phase = 'live';
      const spawns = {};
      for (const p of this.players.values()) spawns[p.id] = this.spawn(p);
      this.emit({ t: 'round', phase: 'live', n: 0, scores: [0, 0], spawns, dur: 0, warmup: true });
    } else this.startRound();
  }

  spawn(p, pts) {
    const list = pts || SPAWNS[p.team];
    const s = list[Math.floor(Math.random() * list.length)];
    p.pos[0] = s[0]; p.pos[1] = s[1]; p.pos[2] = s[2];
    p.yaw = s[3]; p.pitch = 0; p.ads = 0; p.crouch = false; p.alive = true; p.lastShot = -99;
    return s;
  }

  startRound() {
    this.round++;
    this.phase = 'countdown';
    this.phaseEnd = this.time + RULES.countdown;
    const spawns = {};
    for (const team of [0, 1]) {
      const pts = SPAWNS[team].slice().sort(() => Math.random() - 0.5);
      this.members(team).forEach((p, i) => {
        const s = pts[i % pts.length];
        p.pos[0] = s[0]; p.pos[1] = s[1]; p.pos[2] = s[2];
        p.yaw = s[3]; p.pitch = 0; p.ads = 0; p.crouch = false; p.alive = true; p.lastShot = -99;
        spawns[p.id] = s;
      });
    }
    this.emit({ t: 'round', phase: 'countdown', n: this.round, scores: [...this.scores], spawns, dur: RULES.countdown });
  }

  endRound(winner) {
    if (winner >= 0) this.scores[winner]++;
    this.phase = 'roundend';
    this.phaseEnd = this.time + RULES.roundEnd;
    this.emit({ t: 'round', phase: 'end', n: this.round, winner, scores: [...this.scores], dur: RULES.roundEnd });
    if (winner >= 0 && this.scores[winner] >= RULES.roundsToWin) this.finish(winner);
  }

  finish(winner) {
    this.phase = 'over';
    this.emit({ t: 'over', winner, scores: [...this.scores] });
  }

  forfeit(losingTeam) { if (this.phase !== 'over') this.finish(1 - losingTeam); }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.alive = false;
    this.players.delete(id);
    this.emit({ t: 'left', id });
    if (!this.warmup && this.phase !== 'over') {
      if (this.members(p.team).length === 0) this.forfeit(p.team);
      else if (this.phase === 'live') this.checkRoundEnd();
    }
  }

  checkRoundEnd() {
    const a0 = this.aliveCount(0), a1 = this.aliveCount(1);
    if (a0 === 0 && a1 === 0) this.endRound(-1);
    else if (a0 === 0) this.endRound(1);
    else if (a1 === 0) this.endRound(0);
  }

  step(dt) {
    this.time += dt;
    if (this.warmup) {
      for (const p of this.players.values()) if (!p.alive && this.time >= p.respawnAt) {
        const s = this.spawn(p);
        this.emit({ t: 'spawn', id: p.id, pos: [s[0], s[1], s[2]], yaw: s[3] });
      }
      return;
    }
    if (this.phase === 'countdown' && this.time >= this.phaseEnd) {
      this.phase = 'live';
      this.phaseEnd = this.time + RULES.roundTime;
      this.emit({ t: 'round', phase: 'live', n: this.round, scores: [...this.scores], dur: RULES.roundTime });
    } else if (this.phase === 'live' && this.time >= this.phaseEnd) {
      const a0 = this.aliveCount(0), a1 = this.aliveCount(1);
      this.endRound(a0 === a1 ? -1 : a0 > a1 ? 0 : 1);
    } else if (this.phase === 'roundend' && this.time >= this.phaseEnd) {
      this.startRound();
    }
  }

  setState(id, s) {
    const p = this.players.get(id);
    if (!p || !p.alive || !s) return;
    if (Array.isArray(s.pos) && s.pos.length === 3) {
      p.pos[0] = num(s.pos[0]); p.pos[1] = num(s.pos[1]); p.pos[2] = num(s.pos[2]);
    }
    p.yaw = num(s.yaw); p.pitch = num(s.pitch); p.crouch = !!s.crouch; p.ads = Math.max(0, Math.min(1, num(s.ads)));
  }

  shoot(id, o, d, meta = {}) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.phase !== 'live') return;
    if (this.time - p.lastShot < RULES.bolt - 0.15) return;
    if (![o, d].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) return;
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-6) return;
    d = [d[0] / len, d[1] / len, d[2] / len];
    p.lastShot = this.time;

    const tWall = rayBoxes(o, d);
    let best = Infinity, victim = null;
    for (const v of this.players.values()) {
      if (!v.alive || v.team === p.team) continue;
      const h = v.crouch ? HEIGHT_CROUCH : HEIGHT;
      const tol = 0.12;
      const t = rayAABB(o, d, [v.pos[0] - 0.4 - tol, v.pos[1], v.pos[2] - 0.4 - tol], [v.pos[0] + 0.4 + tol, v.pos[1] + h + 0.1, v.pos[2] + 0.4 + tol]);
      if (t < best) { best = t; victim = v; }
    }
    const hit = victim && best < tWall;
    const end = Math.min(hit ? best : tWall, 400);
    this.emit({ t: 'shot', id, o: o.map(r2), d: d.map(r2), end: r2(end), hit: !!hit });
    if (hit) this.kill(victim, p, best, meta);
  }

  kill(victim, killer, dist, meta) {
    victim.alive = false;
    victim.deaths++;
    killer.kills++;
    const medals = [];
    const ads = num(meta.ads), scopeT = num(meta.scopeT, 9);
    if (ads < 0.6) medals.push('NO-SCOPE');
    else if (scopeT < 0.45) medals.push('QUICKSCOPE');
    if (meta.air) medals.push('JUMPSHOT');
    if (dist > 55) medals.push('LONGSHOT');
    this.emit({ t: 'kill', killer: killer.id, victim: victim.id, medals, dist: r2(dist) });
    if (this.warmup) { victim.respawnAt = this.time + RULES.warmupRespawn; return; }
    this.checkRoundEnd();
  }

  snapshot() {
    const p = [];
    for (const v of this.players.values())
      p.push([v.id, r2(v.pos[0]), r2(v.pos[1]), r2(v.pos[2]), r2(v.yaw), r2(v.pitch), v.crouch ? 1 : 0, r2(v.ads), v.alive ? 1 : 0]);
    return { t: 'snap', p };
  }
}
