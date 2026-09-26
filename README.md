# Mars Explorations

A realistic Starship-to-Mars game in the browser: launch from Starbase, refill
in orbit, fly the trans-Mars injection, enter the Martian atmosphere, land
propulsively and build a base with a rover and 3D printers. Every piece is
judged blind against real footage and published data (see "Realism bench").

three.js r186 is vendored in `vendor/`; everything is plain ES modules with no
build step.

## Run

```sh
npm run serve            # python3 -m http.server 8080
# open http://localhost:8080/            (mission-select menu)
# or   http://localhost:8080/?scene=landing   (any phase directly)
```

Any static file server works. URL parameters:

| parameter | effect |
|---|---|
| `scene=<id>` | `menu` (default), `launch`, `refill`, `transfer`, `entry`, `landing`, `surface`, plus the viewer scenes `orbit`, `onboard` |
| `mode=campaign` | play the phase as part of the campaign (inputs carried from the previous phase, completion unlocks and moves to the next). Without it a phase uses default initial conditions. |
| `auto=1` | start the phase with its autopilot on (demo / smoke testing) |
| `year=2028` | transfer phase: pick another launch window |
| `shot=<id>` | deterministic capture for the critic harness. **No gameplay is attached in shot mode.** |

## Mission phases

Each phase can be played from the menu on its own or in sequence as a
campaign. Campaign progress (status, best score, the state handed from one
phase to the next) is stored in `localStorage` under
`mars-explorations.campaign.v1`; storage failures are ignored.

1. **Launch** (`launch`). Command Super Heavy + Starship from Starbase:
   terminal count, throttle, pitch trim, hot staging, SECO. Webcast-style
   telemetry strip: SPEED km/h, ALTITUDE km, LOX/CH4 bars, T+ clock and the
   33-engine / 3+3-engine diagrams lighting as the engines run. Guidance flies a
   gravity turn; the booster flies boostback and a landing burn to a tower
   catch if you stage with its reserve intact. Physics: point mass in a
   rotating Earth frame, Raptor thrust/Isp/mass flow vs ambient pressure from
   `src/physics/vehicle.js` (nozzle theory), Mach-dependent drag.
2. **Orbital refilling** (`refill`). Tankers arrive on V-bar; fly each one to
   the depot's port (Clohessy-Wiltshire relative motion, RCS translation) or
   hand it to the approach autopilot. Soft capture needs < 0.3 m/s closing and
   < 1 m misalignment; > 0.8 m/s is a collision. Propellant transfers at
   5 t/min, boil-off runs at 0.1 %/day the whole time (refs/data/p-refill).
   Depart when the depot holds enough for TMI plus the landing reserve.
3. **Trans-Mars injection** (`transfer`). Porkchop plot of C3 over the launch
   window (Lambert arcs between ephemeris states, `src/physics/transfer.js`);
   pick departure date and flight time, then fly the TMI burn with all six
   Raptors (throttle, cutoff, optional auto cutoff). Burn residuals become an
   entry-corridor error unless you spend propellant on a correction (TCM).
   Cruise with time warp up to 20 days/s on a heliocentric map.
4. **Mars entry** (`entry`). Choose the entry flight-path angle (the preview
   shows whether the corridor is survivable), then fly bank angle: lift up to
   shallow out and cut g-load, lift down to go steeper and shorter. g-load and
   stagnation heating (Sutton-Graves, Mars CO2) gauges; too steep fails on
   6 g or the TPS limit, too shallow skips out. Density from
   `src/physics/mars_atmosphere.js`.
5. **Propulsive landing** (`landing`). Belly-flop, flip, landing burn with
   throttle, 1-3 engines and tilt; Mars gravity 3.73 m/s^2 from
   `src/physics/mars_body.js`. One Raptor at minimum throttle still
   out-thrusts the ship's Mars weight, so it cannot hover: it is a hoverslam.
   Touchdown scored on vertical speed (< 2 m/s nominal, > 6 m/s impact),
   lateral speed, tilt, pad distance, propellant left.
6. **Surface base** (`surface`). Drive the rover at Perseverance's 4.2 cm/s
   limit with slip on slopes (`src/physics/rover.js`), manage battery and
   MMRTG power (loads from the activity model), recharge at the charging
   station, haul regolith from the dig site to the printer, and print from the
   build menu: landing pad, wall segment, habitat shell, rover spare wheel
   (masses, print times and power from `src/physics/printer.js`). Printers
   draw regolith and base power (solar field + battery bank) as they print
   and pause when either runs out; structures appear and grow layer by layer.
   Cameras: chase, Navcam, Mastcam-Z (26-110 mm), front Hazcam, scene view.
   Printing a landing pad and a habitat shell completes the campaign.

Game abstractions (not flight hardware): the rover tows a 3 t regolith cart,
the entry miss distance is scaled down into the landing pad offset, and the
Mars landing reserve is 100 t.

## Controls

Keyboard and on-screen buttons (bottom right) do the same things. `H` lists
the keys of the current phase.

| everywhere | |
|---|---|
| `,` `.` (or `[` `]`) | time warp down / up |
| `Esc` / `P` | pause (resume, restart phase, menu) |
| `H` | key list |

| phase | keys |
|---|---|
| launch | `Enter` countdown, `W`/`S` throttle, `A`/`D` pitch trim, `Space` stage, `X` SECO, `G` auto-throttle, `U` autopilot, `C` tracking camera |
| refill | `W`/`S` along-track, `A`/`D` cross-track, `R`/`F` radial thrust, `U` approach autopilot, `N` skip to next tanker, `Enter` depart |
| transfer | `A`/`D` departure date, `W`/`S` flight time (then throttle), click the porkchop, `Enter` commit + ignite, `Space` relight, `X` cutoff, `G` auto cutoff, `T` TCM |
| entry | `W`/`S` corridor, `Enter` entry interface, `A`/`D` bank (lift up / down), `U` bank guidance |
| landing | `F` flip + ignite, `W`/`S` throttle, `A`/`D` tilt, `1` `2` `3` engines, hold `X` cutoff, `U` autopilot, `C` camera |
| surface | `W`/`S` drive, `A`/`D` steer, `E` excavate / unload / fit wheel, `B` build menu then `1`-`4`, `C` camera, arrows mast pan/tilt, `1`-`7` Mastcam-Z focal length, `U` haul autopilot |
| menu | arrows + `Enter` play a phase, `C` continue the campaign |

## Code layout

```
index.html              page, import map, HUD styles (g-* classes)
src/main.js             scene router; ?shot -> deterministic capture, otherwise attaches src/game/play.js
src/scenes/*.js         visual scenes (one per phase + menu, orbit, onboard)
src/physics/*.js        physics models (pure ES modules, node-testable)
src/game/
  play.js               gameplay shell: phase dispatch, warp, pause, results, campaign wiring
  menu.js               mission-select menu (DOM over the menu scene)
  campaign.js           campaign state machine + persistence (pure)
  scoring.js            per-phase scoring (pure)
  deps.js               loads each physics module separately, tolerating missing ones
  input.js ui.js webcast.js
  sims/*.js             per-phase simulations (pure, tested; physics modules injected)
  phases/*.js           per-phase controllers: HUD, input, scene binding
tests/                  node --test suites (p-* physics, game_* gameplay)
tools/                  shoot.mjs, smoke.mjs, blind.py, judge.py, export/
refs/                   real footage (refs/real) and published data (refs/data)
```

### Scene hooks

Scenes stay purely visual. The gameplay layer requires nothing from them and
uses what they expose, calling the scene's own `update(dt)` first each frame so
gameplay placement wins:

| scene exposes | used by |
|---|---|
| `setFlightState(state)`, `setMissionTime(t)` | launch: altitude, speed, pitch, per-engine lit mask, staging, booster state |
| `stack` / `ship` (Object3D) | launch / landing: moved from the sim when no hook exists |
| `setRefillState`, `ship` + `tanker` | refill relative position |
| `setCruiseState`, `setEntryState`, `setLandingState` | transfer / entry / landing state each frame |
| `rover` (Object3D, or `{group, mastcamL, setMast, casters}`) | surface: placed on the terrain from the sim; forward is -z, heading 0 = north |
| `heightAt(x,z)` or `terrain.heightAt`, `terrain.follow`, `terrain.setShadowBoxes` | surface terrain height, detail streaming, rover shadows |
| `base.{printer,charger,dig}` positions | surface site layout (defaults otherwise, with simple markers) |
| `roverCamera(mode, camera, rover)` | surface camera override |
| `setSurfaceState`, `setSolTime(fraction)` | surface state and time of day |

Without a scene `heightAt` / `rover`, the surface phase adds a simple ground
and rover so it stays playable.

## Tests

```sh
node --test tests/*.test.js          # all suites
node --test tests/game_*.test.js     # gameplay: campaign, scoring, per-phase sims
node tools/smoke.mjs                 # headless Chromium: every scene in play mode
node tools/smoke.mjs landing --auto  # one scene, plus a run with its autopilot on
```

`tools/smoke.mjs` opens each scene without `?shot`, plays a few seconds of
scripted keyboard input, screenshots page + HUD to `work/smoke/<scene>.png`
and fails on page errors or console errors. 404s for the optional physics
modules the game probes for (`src/physics/refill.js`, `entry.js`,
`ascent.js`) are reported as notes, not failures. Frame rates under
SwiftShader are far below a real GPU.

## Realism bench

Each piece of the game is judged blind: a critic with fresh context sees our
rendered frame or sim output next to a real one, labels stripped and order
shuffled. A piece passes when the critic picks ours as the real one.

- `refs/real/MANIFEST.json`: the real reference set (SpaceX webcast frames of
  liftoff, ascent, hot staging, booster, reentry, landing; NASA Perseverance
  Navcam / Mastcam-Z / Hazcam raw images; flight telemetry CSVs), with the
  source, what each frame shows, why it is known to be real, and crop boxes
  that remove broadcast overlays.
- `refs/data/p-*.{real.json,real.csv,tolerances.json,sources.md}`: published
  numbers per physics piece (vehicle, ascent, refill, transfer, entry, Mars
  atmosphere and gravity, rover, printer) with tolerance bands and sources;
  `tools/export/p-*.mjs` export our model in the same format, and the
  `tests/p-*.test.js` suites check the tolerances.
- `node tools/shoot.mjs <scene> <shot> <out.png> [w h]`: renders a
  deterministic shot (`?scene=..&shot=..`) in headless Chromium.
- `python3 tools/blind.py img <real> <ours> [--crop-real ..]` (also `table`,
  `series --x COL --y COL`): builds a normalised, shuffled A/B pair in
  `work/blind/<id>/`; the answer key goes outside the critic's view
  (`$BLIND_KEYS`, default `~/.blind_keys`).
- `python3 tools/judge.py <pair_dir> <A|B> <piece> <round> [--gap ..] [--tests pass|fail|na]`:
  scores the critic's pick against the key and appends the round to
  `work/progress.jsonl`. `progress/index.html` shows the live log.
