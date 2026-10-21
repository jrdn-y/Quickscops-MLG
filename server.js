import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Match, MODES } from './public/shared/match.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// which maps each lobby size rotates through
const MAP_POOL = { 1: ['derrick', 'skyline'], 2: ['derrick', 'dustbowl', 'skyline'], 4: ['dustbowl', 'skyline'], ffa: ['dustbowl', 'skyline', 'derrick'] };
const FFA_MAX = 6, FFA_WAIT = 20000;

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/') url = '/index.html';
  let file;
  if (url.startsWith('/vendor/three/')) file = path.join(root, 'node_modules/three/build', url.slice(14));
  else file = path.join(root, 'public', url);
  const allowed = [path.join(root, 'public'), path.join(root, 'node_modules/three/build')];
  if (!allowed.some(a => path.resolve(file).startsWith(a))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
let nextId = 1;
const queues = new Map(); // key -> { mode, size, list: [clients], since }
const matches = new Set();

const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const needFor = q => (q.mode === 'ffa' ? FFA_MAX : q.size * 2);

function leaveQueue(c) {
  if (!c.qkey) return;
  const q = queues.get(c.qkey);
  if (q) {
    const i = q.list.indexOf(c);
    if (i >= 0) q.list.splice(i, 1);
    if (!q.list.length) queues.delete(c.qkey); else announce(q);
  }
  c.qkey = null;
}

function announce(q) {
  for (const c of q.list) send(c.ws, { t: 'queue', have: q.list.length, need: needFor(q), mode: q.mode, size: q.size, ffa: q.mode === 'ffa' });
}

function tryStart(key) {
  const q = queues.get(key);
  if (!q) return;
  const need = needFor(q);
  const ready = q.list.length >= need || (q.mode === 'ffa' && q.list.length >= 2 && Date.now() - q.since > FFA_WAIT);
  if (!ready) return;
  const group = q.list.splice(0, need);
  if (!q.list.length) queues.delete(key); else { q.since = Date.now(); announce(q); }
  createMatch(group, q.mode, q.size);
}

function createMatch(clients, mode, size) {
  const pool = MAP_POOL[mode === 'ffa' ? 'ffa' : size];
  const map = pool[Math.floor(Math.random() * pool.length)];
  const clientsById = new Map();
  const m = new Match({ mode, teamSize: size, map, emit: msg => { for (const c of clientsById.values()) send(c.ws, msg); } });
  const roster = [];
  clients.forEach((c, i) => {
    c.team = mode === 'ffa' ? c.id : i % 2;
    c.match = m;
    c.qkey = null;
    clientsById.set(c.id, c);
    m.addPlayer({ id: c.id, name: c.name, team: c.team, loadout: c.loadout });
    roster.push({ id: c.id, name: c.name, team: c.team });
  });
  m.clients = clientsById;
  for (const c of clients) send(c.ws, { t: 'match', you: c.id, mode, teamSize: size, map, players: roster });
  matches.add(m);
  setTimeout(() => m.start(), 1500);
}

function cleanup(m) {
  matches.delete(m);
  for (const c of m.clients.values()) c.match = null;
}

wss.on('connection', ws => {
  const c = { ws, id: nextId++, name: 'Player', match: null, qkey: null, loadout: null };
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  send(ws, { t: 'hello', id: c.id });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const match = c.match;
    switch (m.t) {
      case 'queue': {
        if (match) return;
        leaveQueue(c);
        const mode = MODES[m.mode] ? m.mode : 'elim';
        const size = mode === 'ffa' ? 1 : [1, 2, 4].includes(m.size) ? m.size : 2;
        c.name = String(m.name || 'Player').replace(/[^\w \-.]/g, '').slice(0, 16) || 'Player';
        c.loadout = m.loadout;
        const code = String(m.code || '').toLowerCase().replace(/[^\w]/g, '').slice(0, 12);
        c.qkey = `${mode}:${size}:${code}`;
        if (!queues.has(c.qkey)) queues.set(c.qkey, { mode, size, list: [], since: Date.now() });
        queues.get(c.qkey).list.push(c);
        announce(queues.get(c.qkey));
        tryStart(c.qkey);
        break;
      }
      case 'leaveQueue': leaveQueue(c); break;
      case 'class': c.loadout = m.loadout; if (match) match.setLoadout(c.id, m.loadout); break;
      case 'leave': if (match) { match.clients.delete(c.id); match.removePlayer(c.id); c.match = null; } break;
      case 'state': if (match) match.setState(c.id, m); break;
      case 'shot': if (match) match.shoot(c.id, m); break;
      case 'knife': if (match) match.throwKnife(c.id, m); break;
      case 'use': if (match) match.use(c.id, m.on); break;
      case 'respawn': if (match) match.respawnNow(c.id); break;
    }
  });
  ws.on('close', () => {
    leaveQueue(c);
    if (c.match) { c.match.clients.delete(c.id); c.match.removePlayer(c.id); }
  });
});

setInterval(() => {
  for (const m of matches) {
    m.step(0.05);
    if (m.phase === 'over' && !m.overAt) m.overAt = Date.now();
    if (m.overAt && Date.now() - m.overAt > 15000) { cleanup(m); continue; }
    if (m.phase !== 'waiting') m.emit(m.snapshot());
  }
}, 50);

// FFA lobbies start after a short wait even when they aren't full
setInterval(() => { for (const key of [...queues.keys()]) tryStart(key); }, 1000);

// heartbeat: keeps idle lobby sockets alive through hosting proxies and drops dead ones
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

setInterval(() => {
  const n = wss.clients.size;
  for (const ws of wss.clients) send(ws, { t: 'online', n });
}, 3000);

server.listen(PORT, () => console.log(`Quickscope MLG running on http://localhost:${PORT}`));
