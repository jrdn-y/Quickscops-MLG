// Shared between server (hit validation) and client (rendering, collision, bots).
export const EYE = 1.65, EYE_CROUCH = 1.2, HEIGHT = 1.8, HEIGHT_CROUCH = 1.3, HALF = 0.35;
export const ARENA = { x: 36, z: 26 };

export const BOXES = [];
function add(a, b, c, d, e, f, kind = 'crate') {
  BOXES.push({ min: [a, b, c], max: [d, e, f], kind });
}
// add a box and its 180deg rotated twin so the map is fair for both teams
function sym(a, b, c, d, e, f, kind) {
  add(a, b, c, d, e, f, kind);
  add(-d, b, -f, -a, e, -c, kind);
}

// perimeter
add(-37, 0, -27, 37, 9, -26, 'wall');
add(-37, 0, 26, 37, 9, 27, 'wall');
add(-37, 0, -27, -36, 9, 27, 'wall');
add(36, 0, -27, 37, 9, 27, 'wall');
// centre platform + stairs
add(-6, 0, -3, 6, 2.2, 3, 'platform');
for (let j = 0; j < 3; j++) {
  const h = 2.2 - (j + 1) * 0.55;
  add(6 + j * 1.2, 0, -3, 6 + (j + 1) * 1.2, h, 3, 'platform');
  add(-(6 + (j + 1) * 1.2), 0, -3, -(6 + j * 1.2), h, 3, 'platform');
}
// cover
sym(-20, 0, -10, -12, 3, -9, 'wall');
sym(-8, 0, 10, -4, 1.5, 13, 'crate');
sym(-28, 0, 6, -24, 2.5, 10, 'crate');
sym(-14, 0, 16, -10, 1.2, 18, 'crate');
sym(4, 0, -18, 8, 2, -16, 'crate');
sym(-2, 0, 18, 2, 3, 19, 'wall');
sym(14, 0, -6, 17, 1.5, -3, 'crate');
sym(22, 0, 12, 24, 1, 14, 'crate');
// huts (open towards the middle)
sym(-33, 0, -4, -26, 4, -3.4, 'wall');
sym(-33, 0, 3.4, -26, 4, 4, 'wall');
sym(-33, 0, -4, -32.4, 4, 4, 'wall');
sym(-33, 4, -4, -26, 4.5, 4, 'wall');

// [x,y,z,yaw]; yaw 0 faces -z
export const SPAWNS = [[], []];
for (const x of [-6, -2, 2, 6]) {
  SPAWNS[0].push([x, 0, 22, 0]);
  SPAWNS[1].push([-x, 0, -22, Math.PI]);
}

export function rayAABB(o, d, min, max) {
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
    } else {
      let a = (min[i] - o[i]) / d[i], b = (max[i] - o[i]) / d[i];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

export function rayBoxes(o, d, maxT = Infinity) {
  let best = Infinity;
  for (const b of BOXES) {
    const t = rayAABB(o, d, b.min, b.max);
    if (t < best && t <= maxT) best = t;
  }
  return best;
}

export function pointFree(x, z, margin = 0.7) {
  for (const b of BOXES) {
    if (b.min[1] > 1.8) continue;
    if (x > b.min[0] - margin && x < b.max[0] + margin && z > b.min[2] - margin && z < b.max[2] + margin) return false;
  }
  return Math.abs(x) < ARENA.x - 1 && Math.abs(z) < ARENA.z - 1;
}

function collideAxis(pos, axis, d, h, grounded) {
  pos[axis] += d;
  let hit = false;
  for (const b of BOXES) {
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

// body: {pos, vel, grounded}. wish is a world-space unit-ish vector (x,z) scaled by speed.
export function stepBody(body, dt, wishX, wishZ, speed, jump, crouch) {
  const h = crouch ? HEIGHT_CROUCH : HEIGHT;
  const k = Math.min(1, dt * (body.grounded ? 14 : 3));
  body.vel[0] += (wishX * speed - body.vel[0]) * k;
  body.vel[2] += (wishZ * speed - body.vel[2]) * k;
  if (jump && body.grounded) { body.vel[1] = 7.6; body.grounded = false; }
  body.vel[1] -= 22 * dt;
  const p = body.pos;
  collideAxis(p, 0, body.vel[0] * dt, h, body.grounded);
  collideAxis(p, 2, body.vel[2] * dt, h, body.grounded);
  body.grounded = false;
  const dy = body.vel[1] * dt;
  if (collideAxis(p, 1, dy, h, false)) {
    if (dy < 0) body.grounded = true;
    body.vel[1] = 0;
  }
  if (p[1] <= 0) { p[1] = 0; body.vel[1] = 0; body.grounded = true; }
}
