import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Match } from './public/shared/match.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

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
const queues = new Map(); // key -> clients
const matches = new Set();

const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };

function leaveQueue(c) {
  if (!c.qkey) return;
  const q = queues.get(c.qkey);
  if (q) {
    const i = q.indexOf(c);
    if (i >= 0) q.splice(i, 1);
    if (!q.length) queues.delete(c.qkey); else announce(c.qkey);
  }
  c.qkey = null;
}

function announce(key) {
  const q = queues.get(key);
  if (!q) return;
  for (const c of q) send(c.ws, { t: 'queue', have: q.length, need: c.need, mode: c.mode });
}

function createMatch(clients, teamSize) {
  const clientsById = new Map();
  const m = new Match({
    teamSize,
    emit: msg => { for (const c of clientsById.values()) send(c.ws, msg); },
  });
  const roster = [];
  clients.forEach((c, i) => {
    c.team = i % 2;
    c.match = m;
    c.qkey = null;
    clientsById.set(c.id, c);
    m.addPlayer({ id: c.id, name: c.name, team: c.team });
    roster.push({ id: c.id, name: c.name, team: c.team });
  });
  m.clients = clientsById;
  for (const c of clients) send(c.ws, { t: 'match', you: c.id, teamSize, players: roster });
  matches.add(m);
  setTimeout(() => m.start(), 1500);
}

function cleanup(m) {
  matches.delete(m);
  for (const c of m.clients.values()) c.match = null;
}

wss.on('connection', ws => {
  const c = { ws, id: nextId++, name: 'Player', match: null, qkey: null };
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  send(ws, { t: 'hello', id: c.id });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'queue' && !c.match) {
      leaveQueue(c);
      const teamSize = m.mode === '4v4' ? 4 : 2;
      c.name = String(m.name || 'Player').replace(/[^\w \-.]/g, '').slice(0, 16) || 'Player';
      c.need = teamSize * 2;
      c.mode = teamSize + 'v' + teamSize;
      const code = String(m.code || '').toLowerCase().replace(/[^\w]/g, '').slice(0, 12);
      c.qkey = c.mode + ':' + code;
      if (!queues.has(c.qkey)) queues.set(c.qkey, []);
      const q = queues.get(c.qkey);
      q.push(c);
      if (q.length >= c.need) {
        const group = q.splice(0, c.need);
        if (!q.length) queues.delete(c.qkey);
        createMatch(group, teamSize);
      } else announce(c.qkey);
    } else if (m.t === 'leaveQueue') leaveQueue(c);
    else if (m.t === 'leave' && c.match) { c.match.clients.delete(c.id); c.match.removePlayer(c.id); c.match = null; }
    else if (m.t === 'state' && c.match) c.match.setState(c.id, m);
    else if (m.t === 'shot' && c.match) {
      const p = c.match.players.get(c.id);
      if (!p || !Array.isArray(m.o) || !p.alive) return;
      // origin must be near where the server thinks the player is
      if (Math.hypot(m.o[0] - p.pos[0], m.o[1] - p.pos[1] - 1.5, m.o[2] - p.pos[2]) > 5) return;
      c.match.shoot(c.id, m.o, m.d, m.meta || {});
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
    if (m.overAt && Date.now() - m.overAt > 10000) { cleanup(m); continue; }
    if (m.phase !== 'waiting') m.emit(m.snapshot());
  }
}, 50);

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
