// Maps, collision, raycasts and projectile physics. Shared by server and client.
export const STANCES = [{ h: 1.8, eye: 1.65 }, { h: 1.3, eye: 1.2 }, { h: 0.6, eye: 0.45 }]; // stand, crouch, prone
export const HALF = 0.35;
export const SITE_RADIUS = 2.2;

function makeMap(key, name, desc, opts, build) {
  const boxes = [];
  const add = (a, b, c, d, e, f, kind = 'crate') => boxes.push({ min: [a, b, c], max: [d, e, f], kind });
  // a box plus its 180-degree rotated twin, so both teams get the same layout
  const sym = (a, b, c, d, e, f, kind) => { add(a, b, c, d, e, f, kind); add(-d, b, -f, -a, e, -c, kind); };
  build(add, sym);
  const m = { key, name, desc, boxes, floor: true, voidY: -8, ...opts };
  m.spawns = [m.spawnX.map(x => [x, 0, m.spawnZ, 0]), m.spawnX.map(x => [-x, 0, -m.spawnZ, Math.PI])];
  m.respawns = [];
  for (let x = -m.bounds.x + 3; x <= m.bounds.x - 3; x += 3)
    for (let z = -m.bounds.z + 3; z <= m.bounds.z - 3; z += 3) {
      const y = standY(m, x, z);
      if (y !== null && Math.abs(y) < 0.1 && spotFree(m, x, y, z, 1)) m.respawns.push([x, y, z, Math.atan2(x, z)]);
    }
  return m;
}

// highest walkable surface under (x,z), or null when there's nothing to stand on
export function standY(m, x, z) {
  let best = m.floor ? 0 : null;
  for (const b of m.boxes) {
    if (x < b.min[0] + 0.2 || x > b.max[0] - 0.2 || z < b.min[2] + 0.2 || z > b.max[2] - 0.2) continue;
    if (b.max[1] > 3 || (best !== null && b.max[1] <= best)) continue;
    if (spotFree(m, x, b.max[1], z, 0.4)) best = b.max[1];
  }
  return best;
}

export function spotFree(m, x, y, z, margin = 0.7) {
  for (const b of m.boxes) {
    if (b.max[1] <= y + 0.05 || b.min[1] >= y + 1.9) continue;
    if (x > b.min[0] - margin && x < b.max[0] + margin && z > b.min[2] - margin && z < b.max[2] + margin) return false;
  }
  return Math.abs(x) < m.bounds.x - 0.5 && Math.abs(z) < m.bounds.z - 0.5;
}

export const MAPS = {
  dustbowl: makeMap('dustbowl', 'Dustbowl', 'Open desert yard with a raised centre platform. Built for 2v2 and 4v4.', {
    bounds: { x: 36, z: 26 }, spawnX: [-6, -2, 2, 6], spawnZ: 22, theme: 'desert',
    sites: [{ name: 'A', pos: [-20, 0, -14] }, { name: 'B', pos: [20, 0, -15] }],
  }, (add, sym) => {
    add(-37, 0, -27, 37, 9, -26, 'wall'); add(-37, 0, 26, 37, 9, 27, 'wall');
    add(-37, 0, -27, -36, 9, 27, 'wall'); add(36, 0, -27, 37, 9, 27, 'wall');
    add(-6, 0, -3, 6, 2.2, 3, 'platform');
    for (let j = 0; j < 3; j++) {
      const h = 2.2 - (j + 1) * 0.55;
      add(6 + j * 1.2, 0, -3, 6 + (j + 1) * 1.2, h, 3, 'platform');
      add(-(6 + (j + 1) * 1.2), 0, -3, -(6 + j * 1.2), h, 3, 'platform');
    }
    sym(-20, 0, -10, -12, 3, -9.4, 'wall');
    sym(-8, 0, 10, -4, 1.5, 13);
    sym(-28, 0, 6, -24, 2.5, 10);
    sym(-14, 0, 16, -10, 1.2, 18);
    sym(4, 0, -18, 8, 2, -16);
    sym(-2, 0, 18, 2, 3, 18.6, 'wall');
    sym(14, 0, -6, 17, 1.5, -3);
    sym(22, 0, 12, 24, 1, 14);
    sym(-33, 0, -4, -26, 4, -3.4, 'wall'); sym(-33, 0, 3.4, -26, 4, 4, 'wall');
    sym(-33, 0, -4, -32.4, 4, 4, 'wall'); sym(-33, 4, -4, -26, 4.5, 4, 'wall');
  }),

  derrick: makeMap('derrick', 'Derrick', 'Small oil yard with a climbable tower in the middle. The classic 1v1 box.', {
    bounds: { x: 22, z: 17 }, spawnX: [-5, -2, 2, 5], spawnZ: 14, theme: 'yard',
    sites: [{ name: 'A', pos: [-11, 0, -11] }, { name: 'B', pos: [11, 0, -12] }],
  }, (add, sym) => {
    add(-23, 0, -18, 23, 7, -17, 'wall'); add(-23, 0, 17, 23, 7, 18, 'wall');
    add(-23, 0, -18, -22, 7, 18, 'wall'); add(22, 0, -18, 23, 7, 18, 'wall');
    // tower: four legs, a deck at 4.4m and a staircase on each side
    for (const [x, z] of [[-2.2, -2.2], [1.8, -2.2], [-2.2, 1.8], [1.8, 1.8]]) add(x, 0, z, x + 0.4, 4.1, z + 0.4, 'metal');
    add(-2.5, 4.1, -2.5, 2.5, 4.4, 2.5, 'metal');
    add(-2.5, 4.4, -2.5, 2.5, 5.2, -2.3, 'metal');
    add(-2.5, 4.4, 2.3, 2.5, 5.2, 2.5, 'metal');
    for (let j = 0; j < 8; j++) {
      const h = (j + 1) * 0.55;
      add(2.5 + (7 - j), 0, -1, 3.5 + (7 - j), h, 1, 'metal');
      add(-3.5 - (7 - j), 0, -1, -2.5 - (7 - j), h, 1, 'metal');
    }
    sym(-15, 0, 6, -9, 2.6, 8.4, 'container');
    sym(-17, 0, -12, -14, 2.6, -6, 'container');
    sym(-7, 0, 9.6, 7, 0.9, 10.4, 'pipe');
    sym(13, 0, 6, 15, 1.2, 8);
    sym(-19.5, 0, -1, -18, 1.5, 1);
    sym(9, 0, -4, 10.5, 1.5, -2.5);
  }),

  skyline: makeMap('skyline', 'Skyline', 'Rooftops at dusk. Jump the gaps — or fall to your death.', {
    bounds: { x: 31, z: 23 }, spawnX: [-6, -2, 2, 6], spawnZ: 17.5, theme: 'dusk', floor: false, voidY: -6,
    sites: [{ name: 'A', pos: [-22, 0, -12] }, { name: 'B', pos: [21, 0, -15] }],
  }, (add, sym) => {
    sym(-30, -30, 6, -12, 0, 22, 'roof');
    sym(-9, -30, 9, 9, 0, 22, 'roof');
    sym(12, -30, 6, 30, 0, 22, 'roof');
    sym(-28, -30, -3, -12, 0, 3, 'roof');
    add(-7, -30, -6, 7, 0, 6, 'roof');
    // planks across the gaps
    sym(-0.6, -0.3, 6, 0.6, 0, 9, 'plank');
    sym(-12, -0.3, -0.5, -7, 0, 0.5, 'plank');
    sym(-12, -0.3, 14.5, -9, 0, 15.5, 'plank');
    sym(9, -0.3, 17.5, 12, 0, 18.5, 'plank');
    sym(-20.5, -0.3, 3, -19.5, 0, 6, 'plank');
    // rooftop clutter
    sym(-26, 0, 10, -23, 1.4, 12);
    sym(-4, 0, 13, -1, 1.2, 15);
    sym(18, 0, 9, 21, 1.6, 11);
    sym(-16, 0, 16, -13, 2.6, 20, 'wall');
    sym(4, 0, 19.4, 10, 3.2, 19.8, 'wall');
    sym(-24, 0, -1.5, -21, 2, 1.5, 'wall');
    add(-3, 0, -2, 3, 0.55, 2, 'platform');
    sym(-30, 0, 21.6, -12, 1, 22, 'wall');
    sym(-9, 0, 21.6, 9, 1, 22, 'wall');
  }),
};
export const MAP_KEYS = Object.keys(MAPS);

export function rayAABB(o, d, min, max) {
  const r = rayAABB2(o, d, min, max);
  return r ? r[0] : Infinity;
}
export function rayAABB2(o, d, min, max) {
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
    } else {
      let a = (min[i] - o[i]) / d[i], b = (max[i] - o[i]) / d[i];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return null;
    }
  }
  return [t0, t1];
}

export function rayBoxes(m, o, d, maxT = Infinity) {
  let best = Infinity;
  for (const b of m.boxes) {
    const t = rayAABB(o, d, b.min, b.max);
    if (t < best && t <= maxT) best = t;
  }
  return best;
}

// Where a bullet stops. With FMJ it passes through the first wall if it's at most 1.2m thick.
export function bulletStop(m, o, d, fmj) {
  const hits = [];
  for (const b of m.boxes) { const r = rayAABB2(o, d, b.min, b.max); if (r) hits.push(r); }
  hits.sort((a, b) => a[0] - b[0]);
  if (!hits.length) return { stop: Infinity, pierced: Infinity };
  if (fmj && hits[0][1] - hits[0][0] <= 1.2) {
    const exit = hits[0][1];
    const next = hits.find(h => h[0] > exit + 0.01);
    return { stop: next ? next[0] : Infinity, pierced: hits[0][0] };
  }
  return { stop: hits[0][0], pierced: Infinity };
}

export function lineClear(m, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2]) || 1;
  return rayBoxes(m, a, [d[0] / len, d[1] / len, d[2] / len], len) >= len - 0.05;
}

// Hit zones for a player standing at feet position p.
export function hitZones(p, stance, tol = 0.1) {
  const [x, y, z] = p;
  if (stance === 2) return [{ zone: 'torso', min: [x - 0.6 - tol, y, z - 0.6 - tol], max: [x + 0.6 + tol, y + 0.6, z + 0.6 + tol] }];
  const h = STANCES[stance].h, w = 0.32 + tol, hw = 0.17 + tol, lw = w * 0.85;
  return [
    { zone: 'head', min: [x - hw, y + h * 0.83, z - hw], max: [x + hw, y + h + 0.08, z + hw] },
    { zone: 'torso', min: [x - w, y + h * 0.45, z - w], max: [x + w, y + h * 0.83, z + w] },
    { zone: 'legs', min: [x - lw, y, z - lw], max: [x + lw, y + h * 0.45, z + lw] },
  ];
}

function collideAxis(m, pos, axis, d, h, grounded) {
  pos[axis] += d;
  let hit = false;
  for (const b of m.boxes) {
    if (pos[0] + HALF <= b.min[0] || pos[0] - HALF >= b.max[0] ||
        pos[2] + HALF <= b.min[2] || pos[2] - HALF >= b.max[2] ||
        pos[1] + h <= b.min[1] || pos[1] >= b.max[1]) continue;
    if (axis === 1) {
      hit = true;
      pos[1] = d > 0 ? b.min[1] - h : b.max[1];
    } else {
      const step = b.max[1] - pos[1];
      if (grounded && step <= 0.6) { pos[1] = b.max[1]; continue; }
      hit = true;
      pos[axis] = d > 0 ? b.min[axis] - HALF : b.max[axis] + HALF;
    }
  }
  return hit;
}

// body: {pos, vel, grounded}. wish is a world-space direction (x,z), length <= 1.
export function stepBody(m, body, dt, wishX, wishZ, speed, jump, stance = 0) {
  const h = STANCES[stance].h;
  const k = Math.min(1, dt * (body.grounded ? 14 : 3));
  body.vel[0] += (wishX * speed - body.vel[0]) * k;
  body.vel[2] += (wishZ * speed - body.vel[2]) * k;
  if (jump && body.grounded && stance === 0) { body.vel[1] = 7.4; body.grounded = false; }
  body.vel[1] = Math.max(-40, body.vel[1] - 22 * dt);
  const p = body.pos;
  const bx = collideAxis(m, p, 0, body.vel[0] * dt, h, body.grounded);
  const bz = collideAxis(m, p, 2, body.vel[2] * dt, h, body.grounded);
  body.blocked = bx || bz;
  body.grounded = false;
  const dy = body.vel[1] * dt;
  if (collideAxis(m, p, 1, dy, h, false)) {
    if (dy < 0) body.grounded = true;
    body.vel[1] = 0;
  }
  if (m.floor && p[1] <= 0) { p[1] = 0; body.vel[1] = 0; body.grounded = true; }
}

// Thrown knife physics. Returns true on surface contact this step.
export function stepProjectile(m, n, dt) {
  if (n.stuck) return false;
  n.vel[1] -= 12 * dt;
  for (let axis = 0; axis < 3; axis++) {
    n.pos[axis] += n.vel[axis] * dt;
    if (m.floor && axis === 1 && n.pos[1] < 0.05) return true;
    for (const b of m.boxes) {
      const p = n.pos;
      if (p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2]) return true;
    }
  }
  return n.pos[1] < m.voidY;
}
