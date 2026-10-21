// Three.js scene: maps, avatars, sniper models, viewmodel and effects.
import * as THREE from '/vendor/three/three.module.js';
import { MAPS, SITE_RADIUS } from '/shared/map.js';

export { THREE };
export const canvas = document.getElementById('c');

export let noGL = false;
export let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
} catch (err) {
  // keep the menu and server connection alive so the player sees why instead of a frozen page
  console.error(err);
  noGL = true;
  const nop = () => {};
  renderer = { setPixelRatio: nop, setSize: nop, clear: nop, render: nop, clearDepth: nop, shadowMap: {} };
}

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 900);
camera.rotation.order = 'YXZ';
export const vmScene = new THREE.Scene();
export const vmCam = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
vmScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));

const hemi = new THREE.HemisphereLight(0xdfeaff, 0x6b5a45, 1.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 35, bottom: -35, near: 1, far: 160 });
sun.shadow.bias = -0.0005;
scene.add(sun);

// ---------- textures ----------
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
const lines = (color, w, fn) => (g, s) => { g.strokeStyle = color; g.lineWidth = w; fn(g, s); };
const TEX = {
  sand: makeTex('#7d7462', 26, lines('#0002', 2, (g, s) => g.strokeRect(0, 0, s, s))),
  concrete: makeTex('#6b6d6a', 22, lines('#0003', 2, (g, s) => g.strokeRect(0, 0, s, s))),
  tar: makeTex('#3c3d42', 18, lines('#0004', 1, (g, s) => { g.strokeRect(0, 0, s, s); })),
  wall: makeTex('#8d8f8c', 22, (g, s) => { g.fillStyle = '#0001'; for (let y = 0; y < s; y += 32) g.fillRect(0, y, s, 2); }),
  crate: makeTex('#9a7543', 30, lines('#3d2a14', 5, (g, s) => {
    g.strokeRect(3, 3, s - 6, s - 6); g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s); g.stroke();
  })),
  platform: makeTex('#5f6b70', 18, lines('#0003', 3, (g, s) => { g.strokeRect(0, 0, s, s); g.strokeRect(0, 0, s / 2, s / 2); })),
  metal: makeTex('#55595c', 16, lines('#0005', 2, (g, s) => { for (let x = 0; x < s; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); } })),
  container: makeTex('#ffffff', 14, (g, s) => { g.fillStyle = '#0002'; for (let x = 0; x < s; x += 12) g.fillRect(x, 0, 5, s); }),
  plank: makeTex('#7a5a36', 30, lines('#2e1f0f', 2, (g, s) => { for (let y = 0; y < s; y += 21) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); } })),
  facade: makeTex('#45464f', 12, (g, s) => {
    for (let y = 8; y < s; y += 32) for (let x = 8; x < s; x += 32) { g.fillStyle = Math.random() < 0.35 ? '#f3c97a' : '#1d2230'; g.fillRect(x, y, 16, 20); }
  }),
};
const mat = (map, color = 0xffffff) => new THREE.MeshLambertMaterial({ map, color });
const MATS = {
  wall: mat(TEX.wall), crate: mat(TEX.crate), platform: mat(TEX.platform), metal: mat(TEX.metal), plank: mat(TEX.plank),
  pipe: mat(TEX.metal, 0xd9b23a), roof: mat(TEX.tar),
  containers: [0xa8432f, 0x2f6aa8, 0x3f8a46, 0xc9822b].map(c => mat(TEX.container, c)),
};
const facadeMat = mat(TEX.facade);

function skyTexture(stops) {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const THEMES = {
  desert: { sky: [[0, '#5d8fc7'], [0.55, '#a9c6df'], [1, '#d9d2c0']], fog: [0xb8c8d6, 70, 260], sun: [0xfff1d6, 2.6, [30, 50, 18]], hemi: [0xdfeaff, 0x6b5a45, 1.4], ground: TEX.sand, outer: 0x6f6957 },
  yard: { sky: [[0, '#6f7f8f'], [0.6, '#b9c0c4'], [1, '#d0d0c8']], fog: [0xb0b6ba, 40, 160], sun: [0xf0f0ea, 1.8, [-20, 45, 25]], hemi: [0xe0e6ee, 0x5a5a55, 1.7], ground: TEX.concrete, outer: 0x55575a },
  dusk: { sky: [[0, '#242452'], [0.45, '#8a4a6a'], [0.75, '#e0855a'], [1, '#f6c27c']], fog: [0x7a5a72, 60, 240], sun: [0xffb070, 2.2, [-40, 25, -30]], hemi: [0xb9a0d0, 0x3a2a35, 1.3], ground: null, outer: 0x1b1c24 },
};

// ---------- map ----------
const mapGroup = new THREE.Group();
scene.add(mapGroup);
const siteGroup = new THREE.Group();
scene.add(siteGroup);
export let currentMap = null;

function boxMesh(min, max, material, tile, sideMat) {
  const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  const mats = sideMat ? [sideMat, sideMat, material, material, sideMat, sideMat] : material;
  const m = new THREE.Mesh(geo, mats);
  m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function letterSprite(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 96px Arial Black, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#000'; g.strokeText(text, 64, 68); g.fillStyle = color; g.fillText(text, 64, 68);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.6, 1.6, 1); s.renderOrder = 20;
  return s;
}

export function loadMap(key) {
  const m = MAPS[key] || MAPS.dustbowl;
  currentMap = m;
  mapGroup.clear();
  const th = THEMES[m.theme] || THEMES.desert;
  scene.background = skyTexture(th.sky);
  scene.fog = new THREE.Fog(...th.fog);
  sun.color.set(th.sun[0]); sun.intensity = th.sun[1]; sun.position.set(...th.sun[2]);
  hemi.color.set(th.hemi[0]); hemi.groundColor.set(th.hemi[1]); hemi.intensity = th.hemi[2];
  Object.assign(sun.shadow.camera, { left: -m.bounds.x - 6, right: m.bounds.x + 6, top: m.bounds.z + 6, bottom: -m.bounds.z - 6 });
  sun.shadow.camera.updateProjectionMatrix();
  if (m.floor) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(m.bounds.x * 2 + 2, m.bounds.z * 2 + 2), new THREE.MeshLambertMaterial({ map: th.ground }));
    th.ground.repeat.set((m.bounds.x * 2 + 2) / 3, (m.bounds.z * 2 + 2) / 3);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; mapGroup.add(ground);
  }
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ color: th.outer }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = m.floor ? -0.02 : -30; mapGroup.add(outer);
  m.boxes.forEach((b, i) => {
    let material = MATS[b.kind] || MATS.crate, side = null, tile = 3;
    if (b.kind === 'container') material = MATS.containers[i % 4];
    if (b.kind === 'crate' || b.kind === 'plank') tile = 1.25;
    if (b.kind === 'roof') side = facadeMat;
    mapGroup.add(boxMesh(b.min, b.max, material, tile, side));
  });
  // skyline of distant buildings
  const sk = new THREE.MeshLambertMaterial({ color: m.theme === 'dusk' ? 0x2c2a3a : 0x8e9499 });
  const r0 = Math.max(m.bounds.x, m.bounds.z) + 30;
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2, r = r0 + Math.random() * 60, w = 6 + Math.random() * 14, h = 8 + Math.random() * 40;
    const base = m.floor ? 0 : -30;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), m.theme === 'dusk' ? facadeMat : sk);
    b.position.set(Math.cos(a) * r, base + h / 2, Math.sin(a) * r); mapGroup.add(b);
  }
  setSites(null);
  return m;
}

// S&D site markers, shown only in S&D
export function setSites(sites) {
  siteGroup.clear();
  if (!sites) return;
  for (const s of sites) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(SITE_RADIUS - 0.15, SITE_RADIUS, 40), new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(s.pos[0], s.pos[1] + 0.03, s.pos[2]);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), new THREE.MeshLambertMaterial({ color: 0x404a40 }));
    crate.position.set(s.pos[0], s.pos[1] + 0.3, s.pos[2]); crate.castShadow = true;
    const label = letterSprite(s.name, '#ffd400'); label.position.set(s.pos[0], s.pos[1] + 3, s.pos[2]);
    siteGroup.add(ring, crate, label);
  }
}
let bombMesh = null;
export function setBomb(pos) {
  if (bombMesh) { scene.remove(bombMesh); bombMesh = null; }
  if (!pos) return;
  bombMesh = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.35), new THREE.MeshLambertMaterial({ color: 0x2b2b2b }));
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  light.position.set(0.12, 0.15, 0); bombMesh.add(body, light); bombMesh.userData.light = light;
  bombMesh.position.set(pos[0] + 0.7, pos[1] + 0.12, pos[2]);
  scene.add(bombMesh);
}
export function tickBomb(t) { if (bombMesh) bombMesh.userData.light.visible = Math.sin(t * 12) > 0; }

// ---------- sniper models ----------
const GUN = new THREE.MeshLambertMaterial({ color: 0x23262a });
const GUN2 = new THREE.MeshLambertMaterial({ color: 0x3a3f36 });
const TAN = new THREE.MeshLambertMaterial({ color: 0x8a7a5a });
const SPECS = {
  intervention: { barrel: 1.0, bw: 0.035, body: [0.075, 0.11, 0.55], stock: [0.05, 0.13, 0.36], scope: 0.38, mat: GUN, mag: 0.1 },
  barrett: { barrel: 0.95, bw: 0.05, body: [0.1, 0.15, 0.7], stock: [0.07, 0.15, 0.3], scope: 0.36, mat: GUN2, mag: 0.18, brake: true },
  wa2000: { barrel: 0.75, bw: 0.035, body: [0.08, 0.14, 0.75], stock: null, scope: 0.32, mat: TAN, mag: 0.12, bullpup: true },
  m21: { barrel: 0.85, bw: 0.035, body: [0.08, 0.12, 0.6], stock: [0.06, 0.12, 0.3], scope: 0.34, mat: GUN, mag: 0.14 },
};
export function buildSniper(key, att) {
  const s = SPECS[key] || SPECS.intervention;
  const g = new THREE.Group();
  const add = (w, h, d, x, y, z, m = GUN) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
  const [bw, bh, bd] = s.body;
  add(bw, bh, bd, 0, -0.02, s.bullpup ? 0.05 : -0.05, s.mat);
  add(s.bw, s.bw, s.barrel, 0, 0.01, -bd / 2 - s.barrel / 2 + (s.bullpup ? 0.05 : -0.05));
  if (s.brake) add(0.08, 0.06, 0.1, 0, 0.01, -bd / 2 - s.barrel - 0.02);
  if (s.stock) add(s.stock[0], s.stock[1], s.stock[2], 0, -0.04, bd / 2 + s.stock[2] / 2 - 0.05, s.mat);
  add(0.04, 0.15, 0.05, 0, -0.13, s.bullpup ? -0.12 : 0.1, s.mat);
  const magH = s.mag * (att === 'extmag' ? 1.6 : 1);
  add(0.05, magH, 0.09, 0, -0.06 - magH / 2, s.bullpup ? 0.18 : -0.08);
  const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.04, s.scope, 14), GUN);
  sc.rotation.x = Math.PI / 2; sc.position.set(0, 0.095, -0.05); g.add(sc);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 14), GUN); lens.rotation.x = Math.PI / 2; lens.position.set(0, 0.095, -0.05 - s.scope / 2); g.add(lens);
  const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), GUN); bolt.position.set(0.065, 0.02, 0.12); g.add(bolt);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, -bd / 2 - s.barrel - 0.1); g.add(muzzle);
  g.userData = { bolt, muzzle };
  return g;
}

// ---------- avatars ----------
const SKIN = new THREE.MeshLambertMaterial({ color: 0xc89f78 });
function nameSprite(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d'); g.font = 'bold 30px system-ui'; g.textAlign = 'center';
  g.fillStyle = '#000a'; g.fillText(text, 129, 35); g.fillStyle = '#7fb2ff'; g.fillText(text, 128, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.3, 1); s.position.y = 2.25; s.renderOrder = 10;
  return s;
}
export function makeAvatar(friendly, name) {
  const color = friendly ? 0x2f6fe0 : 0xc93434;
  const m = new THREE.MeshLambertMaterial({ color }), dark = new THREE.MeshLambertMaterial({ color: friendly ? 0x1d3566 : 0x5a1c1c });
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const body = new THREE.Group(); g.add(body);
  const add = (w, h, d, x, y, z, mm) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mm); o.position.set(x, y, z); o.castShadow = true; body.add(o); return o; };
  add(0.2, 0.85, 0.24, -0.13, 0.43, 0, dark); add(0.2, 0.85, 0.24, 0.13, 0.43, 0, dark);
  add(0.56, 0.66, 0.32, 0, 1.18, 0, m);
  add(0.29, 0.3, 0.29, 0, 1.67, 0, SKIN);
  add(0.31, 0.12, 0.31, 0, 1.83, 0, dark);
  add(0.14, 0.5, 0.14, 0.33, 1.2, -0.18, m).rotation.x = -1.1;
  const gunMount = new THREE.Group(); gunMount.position.set(0.2, 1.36, -0.2); body.add(gunMount);
  if (friendly && name) g.add(nameSprite(name));
  scene.add(g);
  const av = { g, body, gunMount, key: null };
  av.setGun = (key, att) => {
    if (av.key === key + att) return;
    av.key = key + att;
    gunMount.clear();
    const gun = buildSniper(key, att); gun.scale.setScalar(0.85); gun.traverse(o => (o.castShadow = true));
    gunMount.add(gun);
  };
  return av;
}
export function removeAvatar(av) { scene.remove(av.g); }

// ---------- viewmodel ----------
export const vm = new THREE.Group();
vm.scale.setScalar(0.52);
vmScene.add(vm);
let vmKey = null;
const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.5), new THREE.MeshLambertMaterial({ color: 0x4b5a3a }));
arm.position.set(0.02, -0.17, 0.32); arm.rotation.x = 0.4;
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd36a }));
flash.visible = false;
export function setViewGun(key, att) {
  if (vmKey === key + att) return;
  vmKey = key + att;
  vm.clear();
  const gun = buildSniper(key, att);
  vm.add(gun, arm);
  gun.userData.muzzle.add(flash);
  vm.userData = gun.userData;
}
export function muzzleFlash() { flash.visible = true; setTimeout(() => (flash.visible = false), 45); }

// ---------- effects ----------
const fx = [];
export function tracer(o, d, end) {
  const a = new THREE.Vector3(o[0], o[1] - 0.08, o[2]), b = new THREE.Vector3(o[0] + d[0] * end, o[1] + d[1] * end, o[2] + d[2] * end);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xfff6d0, transparent: true, opacity: 0.85 }));
  scene.add(line);
  fx.push({ obj: line, t: 0.45, life: 0.45 });
  if (end < 290) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0xcfc6b0, transparent: true, opacity: 0.8 }));
    puff.position.copy(b); scene.add(puff);
    fx.push({ obj: puff, t: 0.5, life: 0.5, grow: 2 });
  }
}
export function burst(pos, color = 0xff8a3a, size = 2) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(size, 14, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  s.position.set(pos[0], pos[1], pos[2]); scene.add(s);
  fx.push({ obj: s, t: 0.8, life: 0.8, grow: 3 });
}
const knives = new Map();
export function spawnKnife(id, o, v) {
  const k = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.25), new THREE.MeshLambertMaterial({ color: 0xcfd3d6 }));
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.1), GUN); handle.position.z = 0.17;
  k.add(blade, handle); k.position.set(...o); scene.add(k);
  knives.set(id, { mesh: k, pos: [...o], vel: [...v], stuck: false });
}
export function endKnife(id) { const k = knives.get(id); if (k) { scene.remove(k.mesh); knives.delete(id); } }
export function clearFx() { for (const id of [...knives.keys()]) endKnife(id); setBomb(null); }

export function stepFx(dt, m, stepProjectile) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.t -= dt;
    f.obj.material.opacity = Math.max(0, f.t / f.life) * 0.9;
    if (f.grow) f.obj.scale.multiplyScalar(1 + dt * f.grow);
    if (f.t <= 0) { scene.remove(f.obj); f.obj.geometry.dispose(); fx.splice(i, 1); }
  }
  for (const k of knives.values()) {
    if (!k.stuck && m && stepProjectile(m, k, dt)) k.stuck = true;
    k.mesh.position.set(...k.pos);
    if (!k.stuck) { k.mesh.lookAt(k.pos[0] + k.vel[0], k.pos[1] + k.vel[1], k.pos[2] + k.vel[2]); k.mesh.rotateX(performance.now() / 40); }
  }
}

export function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = vmCam.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}

export function render() {
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(vmScene, vmCam);
}
