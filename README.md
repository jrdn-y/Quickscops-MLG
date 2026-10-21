# Quickscope MLG

Browser FPS with MW2-era MLG quickscope rules: Intervention only, one shot one kill, 2v2 / 4v4 elimination (first to 6 rounds), plus offline practice vs bots.

## Run

```
npm install
npm start          # http://localhost:3000  (PORT env var to change)
```

Friends on your network open `http://<your-ip>:3000`.

## Deploy (so friends can play online)

It's one Node process with no database. Any host that supports WebSockets works.

**Render (free, easiest)**
1. Push this folder to a GitHub repo.
2. On render.com: **New → Blueprint**, then pick the repo. `render.yaml` sets up the build, start and health check.
3. Share the `https://quickscope-mlg-xxxx.onrender.com` URL. The free tier sleeps after 15 min idle, so the first visit can take about a minute to wake it.

**Railway / Fly.io / Google Cloud Run / any Docker host:** use the included `Dockerfile`. The server listens on `$PORT`.

All players must use the same deployed URL. Use a private lobby code so your group gets matched together.

## Matchmaking
- **Find Match 2v2 / 4v4** queues you; the match starts when the lobby fills (4 or 8 players).
- **Private lobby code**: everyone who enters the same code is matched together only.
- **Practice**: offline vs bots (Noob → Pro), optional warmup mode with instant respawn.

## Controls
| | Keyboard / Mouse | Controller |
|---|---|---|
| Move / Look | WASD / mouse | Left / right stick |
| Scope / Fire | RMB / LMB | LT / RT |
| Jump / Crouch / Sprint | Space / C / Shift | A / B or R3 / L3 |
| Scoreboard / Pause | Tab / Esc | Y / Start |
| Spectate | click | LB / RB |

Controllers work via the browser Gamepad API (Xbox, PlayStation, most USB pads) — plug in and press any button. Menus are fully navigable with D-pad/stick + A, B to go back. Rumble, stick sensitivity, deadzone and invert-Y are in Settings.

## Structure
- `server.js` — static server, WebSocket matchmaking, 20 Hz authoritative match tick, shot validation
- `public/shared/match.js` — round rules, hit detection, medals (used by both server and practice mode)
- `public/shared/map.js` — map geometry, collision, raycasts
- `public/game.js` — Three.js client, input, bots, HUD, audio
