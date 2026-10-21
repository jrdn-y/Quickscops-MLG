// Practice-mode bots. They drive Match players through the same API online players use.
import { STANCES, SITE_RADIUS, rayBoxes, stepBody, standY } from '/shared/map.js';
import { RULES } from '/shared/match.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = () => Math.random() + Math.random() - 1;
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const turn = (a, b, max) => a + clamp(angDiff(a, b), -max, max);
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export const DIFF = {
  easy: { react: 0.9, err: 0.05, turn: 3, speed: 0.8, jump: 0, drop: 0, knife: 0 },
  medium: { react: 0.55, err: 0.025, turn: 6, speed: 0.9, jump: 0.1, drop: 0.05, knife: 0.002 },
  hard: { react: 0.32, err: 0.012, turn: 10, speed: 1, jump: 0.25, drop: 0.15, knife: 0.004 },
  pro: { react: 0.18, err: 0.006, turn: 16, speed: 1, jump: 0.4, drop: 0.3, knife: 0.006 },
};
export const BOT_NAMES = ['xXSn1perXx', 'NoScopeNate', 'QuickzKing', 'Hitmarker', 'ScopeLord', 'DewDrinker', 'Trickshotz', 'InterventionGod',
  'BoltCycle', 'LongshotLou', 'Dropshot_Dan', 'MLG_Pr0', 'Spawn_Trap', 'L33tScope', 'FaZeless', 'xQuickie'];

export class Bots {
  constructor(match, diff) {
    this.m = match;
    this.d = DIFF[diff] || DIFF.medium;
    this.list = [];
  }

  add(p) {
    this.list.push({ p, body: { pos: p.pos, vel: [0, 0, 0], grounded: true }, wp: null, goal: null, goalT: 0, chk: [0, 0], chkT: 0,
      seen: 0, tgt: null, strafe: 1, strafeT: 0, scopeT0: 0, mag: p.stats.mag, reloadT: 0, alert: null, alertT: 0, dropT: 0, site: Math.random() < 0.5 ? 0 : 1 });
  }

  onEvent(msg) {
    if (msg.t === 'spawn') {
      const b = this.list.find(b => b.p.id === msg.id);
      if (b) { b.mag = b.p.stats.mag; b.reloadT = 0; b.wp = null; b.goal = null; b.body.vel = [0, 0, 0]; b.site = Math.random() < 0.5 ? 0 : 1; }
    } else if (msg.t === 'shot') {
      const shooter = this.m.players.get(msg.id);
      if (!shooter) return;
      for (const b of this.list)
        if (b.p.alive && this.m.isEnemy(b.p, shooter) && Math.hypot(b.p.pos[0] - msg.o[0], b.p.pos[2] - msg.o[2]) < 35) { b.alert = [...shooter.pos]; b.alertT = 4; }
    }
  }

  // can a bot walk (with small jumps) in a straight line from a to b?
  pathOk(a, b) {
    const m = this.m.map, dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz), n = Math.ceil(len / 0.7);
    let y = a[1], gap = 0;
    for (let i = 1; i <= n; i++) {
      const x = a[0] + (dx * i) / n, z = a[2] + (dz * i) / n, h = standY(m, x, z);
      if (h === null) { if ((gap += len / n) > 3) return false; continue; }
      if (h - y > 0.6 && !(gap === 0 && h - y < 1)) return false;
      gap = 0; y = h;
    }
    const o = [a[0], a[1] + 0.5, a[2]], d = norm([dx, 0, dz]);
    return rayBoxes(m, o, d, len) >= len - 0.3;
  }

  pickWaypoint(b, goal) {
    const pts = this.m.map.respawns;
    let best = null, bestScore = Infinity;
    for (let i = 0; i < 14; i++) {
      const s = pts[Math.floor(Math.random() * pts.length)];
      if (Math.hypot(s[0] - b.p.pos[0], s[2] - b.p.pos[2]) < 2 || !this.pathOk(b.p.pos, s)) continue;
      const score = goal ? Math.hypot(s[0] - goal[0], s[2] - goal[2]) + Math.hypot(s[0] - b.p.pos[0], s[2] - b.p.pos[2]) * 0.3 : Math.random();
      if (score < bestScore) { bestScore = score; best = s; }
    }
    if (goal && this.pathOk(b.p.pos, goal)) return [goal[0], goal[1], goal[2]];
    return best ? [best[0], best[1], best[2]] : null;
  }

  update(dt) {
    const m = this.m;
    for (const b of this.list) {
      const p = b.p;
      if (!m.players.has(p.id)) continue;
      if (!p.alive || m.phase !== 'live') {
        b.body.vel[0] = b.body.vel[2] = 0; b.seen = 0; b.tgt = null; p.ads = 0;
        if (p.alive) stepBody(m.map, b.body, dt, 0, 0, 0, false, p.stance);
        continue;
      }
      const s = p.stats, d = this.d;
      if (b.reloadT > 0 && (b.reloadT -= dt) <= 0) b.mag = s.mag;
      const eye = [p.pos[0], p.pos[1] + STANCES[p.stance].eye, p.pos[2]];
      let tgt = null, best = 1e9, dir = null;
      for (const v of m.players.values()) {
        if (!v.alive || !m.isEnemy(p, v)) continue;
        const aim = [v.pos[0], v.pos[1] + (v.stance === 2 ? 0.3 : v.stance === 1 ? 0.9 : 1.3), v.pos[2]];
        const dx = aim[0] - eye[0], dy = aim[1] - eye[1], dz = aim[2] - eye[2], dist = Math.hypot(dx, dy, dz);
        if (dist > 110 || dist > best) continue;
        const dd = [dx / dist, dy / dist, dz / dist], hl = Math.hypot(dd[0], dd[2]) || 1;
        const facing = (-Math.sin(p.yaw) * dd[0] - Math.cos(p.yaw) * dd[2]) / hl;
        if (facing < 0.1 && b.tgt !== v && dist > 7) continue;
        if (rayBoxes(m.map, eye, dd, dist) < dist - 0.3) continue;
        best = dist; tgt = v; dir = dd;
      }
      if (tgt !== b.tgt) b.seen = 0;
      b.tgt = tgt;
      let wx = 0, wz = 0, speed = 5.3 * s.move * d.speed, jump = false;
      const cycling = m.time - p.lastShot < s.interval;
      if (p.stance === 2 && (b.dropT -= dt) <= 0) p.stance = 0;
      if (tgt) {
        if (p.using) m.use(p.id, false);
        b.seen += dt;
        const ty = Math.atan2(-dir[0], -dir[2]), tp = Math.asin(clamp(dir[1], -1, 1));
        p.yaw = turn(p.yaw, ty, d.turn * dt);
        p.pitch += clamp(tp - p.pitch, -d.turn * dt, d.turn * dt);
        const aimErr = Math.abs(angDiff(p.yaw, ty));
        // quickscope: scope in only once roughly on target, fire as soon as fully scoped, then unscope
        const scoping = !cycling && b.reloadT <= 0 && b.mag > 0 && b.seen > d.react * 0.6 && aimErr < 0.3;
        if (scoping) { if (p.ads === 0) b.scopeT0 = m.time; p.ads = Math.min(1, p.ads + dt / s.ads); }
        else p.ads = Math.max(0, p.ads - dt * 8);
        if (p.ads >= 1 && m.time - b.scopeT0 > s.ads + RULES.hardscope * 0.7) p.ads = 0; // never hardscope
        if (p.ads >= 1 && b.seen > d.react && aimErr < 0.05 && !cycling) {
          if (Math.random() < d.drop) { p.stance = 2; b.dropT = 1.2; }
          const dd = norm([dir[0] + rnd() * d.err, dir[1] + rnd() * d.err, dir[2] + rnd() * d.err]);
          m.shoot(p.id, { o: eye, d: dd, meta: { ads: p.ads, scopeT: m.time - b.scopeT0, air: !b.body.grounded } });
          b.mag--;
          p.ads = 0;
          if (b.mag <= 0) b.reloadT = s.reload[1];
        }
        if (p.knives > 0 && best > 4 && best < 14 && Math.random() < d.knife) {
          const tFlight = best / 24;
          m.throwKnife(p.id, { o: eye, v: [dir[0] * 24, dir[1] * 24 + 6 * tFlight, dir[2] * 24] });
        }
        b.strafeT -= dt;
        if (b.strafeT <= 0) { b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeT = 0.5 + Math.random() * 0.9; jump = Math.random() < d.jump; }
        wx = Math.cos(p.yaw) * b.strafe; wz = -Math.sin(p.yaw) * b.strafe;
        speed *= p.ads > 0 ? 0.45 : 0.75;
      } else {
        p.ads = Math.max(0, p.ads - dt * 5);
        if (b.mag < s.mag && b.reloadT <= 0) b.reloadT = s.reload[0];
        const goal = this.goalFor(b);
        if (goal && goal.use) {
          m.use(p.id, true);
          p.yaw += dt * 0.6;
        } else {
          if (p.using) m.use(p.id, false);
          b.goalT -= dt;
          if (!b.wp || b.goalT <= 0 || Math.hypot(b.wp[0] - p.pos[0], b.wp[2] - p.pos[2]) < 1.2) {
            b.wp = this.pickWaypoint(b, goal && goal.pos);
            b.goalT = 6;
          }
          if (b.wp) {
            const dx = b.wp[0] - p.pos[0], dz = b.wp[2] - p.pos[2], l = Math.hypot(dx, dz) || 1;
            wx = dx / l; wz = dz / l; speed = 6.6 * s.move * d.speed;
            p.yaw = turn(p.yaw, Math.atan2(-wx, -wz), 5 * dt); p.pitch *= 0.9;
            // jump over rooftop gaps
            if (b.body.grounded && standY(m.map, p.pos[0] + wx * 0.8, p.pos[2] + wz * 0.8) === null) jump = true;
          }
        }
      }
      b.chkT += dt;
      if (b.chkT > 1) {
        if ((wx || wz) && Math.hypot(p.pos[0] - b.chk[0], p.pos[2] - b.chk[1]) < 0.5) { b.wp = null; jump = true; b.strafe *= -1; }
        b.chk = [p.pos[0], p.pos[2]]; b.chkT = 0;
      }
      // don't walk off a roof while strafing
      if (tgt && b.body.grounded && standY(m.map, p.pos[0] + wx * 0.9, p.pos[2] + wz * 0.9) === null) { b.strafe *= -1; wx = -wx; wz = -wz; }
      if (b.alertT > 0) b.alertT -= dt;
      p.sprint = !tgt && speed > 6;
      stepBody(m.map, b.body, dt, wx, wz, p.stance === 2 ? speed * 0.2 : speed, jump, p.stance);
    }
  }

  goalFor(b) {
    const m = this.m, p = b.p;
    if (m.mode === 'sd') {
      const att = p.team === m.attackers;
      if (m.bomb) {
        if (att) return { pos: m.bomb.pos };
        const d = Math.hypot(p.pos[0] - m.bomb.pos[0], p.pos[2] - m.bomb.pos[2]);
        return d < SITE_RADIUS * 0.7 ? { use: true } : { pos: m.bomb.pos };
      }
      const site = m.map.sites[b.site];
      const d = Math.hypot(p.pos[0] - site.pos[0], p.pos[2] - site.pos[2]);
      if (att) return d < SITE_RADIUS * 0.6 ? { use: true } : { pos: site.pos };
      return d < 8 ? null : { pos: site.pos };
    }
    if (b.alertT > 0) return { pos: b.alert };
    // hunt: drift toward a random enemy now and then so games don't stall
    if (!b.hunt || m.time > b.huntT) {
      const foes = [...m.players.values()].filter(v => v.alive && m.isEnemy(p, v));
      b.hunt = foes.length && Math.random() < 0.6 ? [...foes[Math.floor(Math.random() * foes.length)].pos] : null;
      b.huntT = m.time + 8;
    }
    return b.hunt ? { pos: b.hunt } : null;
  }
}
