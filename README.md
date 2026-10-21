# Quickscope MLG

Browser sniper FPS built around old-school MW2 MLG quickscope rules. Online 1v1, 2v2 and 4v4 (plus FFA), and offline practice against bots.

## Run

```
npm install
npm start          # http://localhost:3000  (PORT env var to change)
```

## Deploy

One Node process, no database, any host with WebSockets.

**Render (free):** New → Blueprint → pick this repo → Apply. `render.yaml` handles the rest. Pushing to `main` redeploys. The free tier sleeps after 15 min idle, so the first visit takes about a minute.

**Anywhere else:** use the included `Dockerfile`. The server listens on `$PORT`.

## MLG rules
- Snipers only: Intervention, Barrett .50cal, WA2000, M21 EBR. No secondaries, grenades or killstreaks.
- One shot, one kill on any hitbox. Bullets go through players (collaterals).
- **No hardscoping:** once fully scoped you have 1 second to fire; kills after that are denied.
- Legal attachments: FMJ (wallbangs through walls up to 1.2m thick), Extended Mags.
- Legal perks: Sleight of Hand, Marathon, Lightweight, Cold-Blooded, Steady Aim, Ninja.
- Throwing knives allowed (one per life). Melee knifing is banned.
- Medals: Quickscope, No-Scope, 360, 360 No-Scope, Jumpshot, Wallbang, Collateral, Headshot, Longshot, Bullseye, First Blood, Payback, Double/Triple/Multi Kill.

## Modes and maps
| Mode | Rules |
|---|---|
| Elimination | One life per round, first to 6 rounds |
| Search & Destroy | Plant/defuse at A or B, sides swap each round, first to 4 |
| Team Deathmatch | Respawns, 10 / 20 / 30 kills for 1v1 / 2v2 / 4v4 |
| Free-for-All | Up to 6 players online, first to 15 |

Maps: **Dustbowl** (open desert yard, 2v2/4v4), **Derrick** (small oil yard with a tower, the 1v1 map), **Skyline** (rooftops at dusk where falling kills you). Online matches pick a map that suits the lobby size.

Lobbies start when full. FFA starts 20 seconds after a second player joins. Use a private lobby code to play with friends only.

## Mechanics
MW2-style sprint (limited without Marathon), crouch, prone (dropshots), jumpshots, scope sway with hold-breath, bolt cycling, reloads, minimap red dots when enemies fire, enemy name tags under your crosshair, footsteps, killcam after every death and a final killcam at the end of the match.

## Controls
| | Keyboard / Mouse | Controller |
|---|---|---|
| Move / Look | WASD / mouse | Left / right stick |
| Scope / Fire | RMB / LMB | LT / RT |
| Sprint / Hold breath | Shift | L3 |
| Jump | Space | A |
| Crouch / Prone | C / Z or Ctrl | B tap / B hold |
| Reload / Plant-Defuse | R / F (hold) | X tap / X hold |
| Throwing knife | G | RB |
| Scoreboard / Pause | Tab / Esc | Back or Y / Start |

Controllers work through the browser Gamepad API (Xbox, PlayStation, most USB pads). Menus are fully navigable with D-pad/stick + A, B to go back.

## Structure
- `server.js`: static files, matchmaking by mode/size/lobby code, 20 Hz match tick
- `public/shared/match.js`: modes, MLG rules, hit detection, medals (server and practice mode both run it)
- `public/shared/map.js`: the three maps, collision, raycasts, wallbangs
- `public/shared/weapons.js`: snipers, attachments, perks, default classes
- `public/game.js`: client state, input, movement, killcam, HUD, menus
- `public/client/`: rendering (`world.js`), sound (`audio.js`), practice bots (`bots.js`)
