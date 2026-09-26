// Phase 1: launch from Starbase to low Earth orbit.
import * as Asc from '../sims/ascent.js';
import { createWebcast } from '../webcast.js';
import { el, panel, controlPad, fmt, clock, every } from '../ui.js';
import { hook, sceneObject, createTracker } from './common.js';

export async function create(game) {
  const { ctx, THREE, deps, input, layer, inputs, auto } = game;
  // An ascent module in src/physics (if one appears) may provide its own
  // vehicle constants; the sim itself uses src/physics/vehicle.js.
  const s = Asc.createAscent({ V: deps.V, AS: deps.AS, payload: inputs.payload ?? 100e3 });
  const wc = createWebcast(layer, { title: 'STARSHIP MARS MISSION' });

  const fd = panel('FLIGHT DIRECTOR', 'g-left');
  fd.text('msg', 'g-msg')
    .row('thr', 'THROTTLE', '%').row('auto', 'AUTO-THROTTLE').row('trim', 'PITCH TRIM', 'deg')
    .row('q', 'DYN PRESSURE', 'kPa').row('mach', 'MACH').row('g', 'ACCEL', 'g')
    .row('peri', 'PERIGEE', 'km').row('apo', 'APOGEE', 'km').row('bst', 'BOOSTER');
  layer.append(fd.root);

  const pad = controlPad(input, [
    [{ label: 'LAUNCH', code: 'Enter', hold: false, cls: 'primary' }, { label: 'STAGE', code: 'Space', hold: false, cls: 'warn' }, { label: 'SECO', code: 'KeyX', hold: false }],
    [{ label: 'THR +', code: 'KeyW' }, { label: 'THR -', code: 'KeyS' }, { label: 'AUTO', code: 'KeyG', hold: false }],
    [{ label: 'PITCH -', code: 'KeyA' }, { label: 'PITCH +', code: 'KeyD' }, { label: 'CAM', code: 'KeyC', hold: false }],
  ], 'g-pad-right');
  layer.append(pad);

  const stack = sceneObject(ctx, 'stack', 'ship');
  const stack0 = stack ? stack.position.clone() : null;
  const tracker = createTracker(THREE, ctx.camera);
  // Scenes that can follow the vehicle themselves (setCameraMode) start on the
  // webcast-style tracking camera; C cycles tracking -> chase -> pad view.
  const CAM_MODES = ['tracking', 'chase', 'fixed'], CAM_NAMES = { tracking: 'TRACKING', chase: 'CHASE', fixed: 'PAD' };
  const sceneCam = typeof ctx.setCameraMode === 'function';
  let camIdx = 0;
  if (sceneCam) hook(ctx, 'setCameraMode', CAM_MODES[camIdx]);

  let throttle = 1, trim = 0, autoThr = true, autopilot = auto;
  let resultAt = null;
  const tick = every(12);
  game.setWarpLevels([1, 2, 5, 10], ['1x', '2x', '5x', '10x']);

  function update(dt, warp) {
    if (input.wasPressed('Enter') && s.phase === 'prelaunch') { Asc.stepAscent(s, 0, { start: true }); game.toast('Countdown started: T-10 s'); }
    if (autopilot && s.phase === 'prelaunch') Asc.stepAscent(s, 0, { start: true });
    if (input.wasPressed('KeyG')) { autoThr = !autoThr; game.toast(`Auto-throttle ${autoThr ? 'ON' : 'OFF'}`); }
    if (input.wasPressed('KeyU')) { autopilot = !autopilot; game.toast(`Autopilot ${autopilot ? 'ON' : 'OFF'}`); }
    if (input.wasPressed('KeyC')) {
      if (sceneCam) { camIdx = (camIdx + 1) % CAM_MODES.length; hook(ctx, 'setCameraMode', CAM_MODES[camIdx]); game.toast(`Camera: ${CAM_NAMES[CAM_MODES[camIdx]]}`); }
      else { tracker.set(tracker.mode === 'scene' ? 'track' : 'scene'); game.toast(`Camera: ${tracker.mode.toUpperCase()}`); }
    }
    throttle = Math.max(0.4, Math.min(1, throttle + input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) * 0.5 * dt));
    trim = Math.max(-10, Math.min(10, trim + input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) * 4 * dt));
    const stageCmd = input.wasPressed('Space') && s.phase === 'booster' && s.t > 30;
    const cutCmd = input.wasPressed('KeyX') && s.phase === 'ship';
    const reserve = s.boosterReserve * s.veh.booster.prop;
    const c = { throttle, pitchBias: trim, autoThrottle: autoThr, stage: stageCmd, cutoff: cutCmd, autoStage: autopilot, autoCutoff: true };
    if (s.phase !== 'prelaunch') Asc.stepAscent(s, dt * (s.phase === 'countdown' ? 1 : warp), c);

    // scene binding
    const alt = Asc.altitude(s);
    const flight = {
      phase: s.phase, t: s.t, altitude: alt, downrange: Asc.downrange(s), speed: Asc.speedRel(s),
      pitchDeg: s.pitchDeg, throttle: s.throttle, staged: s.staged,
      boosterLit: Asc.boosterLitMask(s.boosterLit), shipLit: [s.shipLitSL, s.shipLitVac],
      booster: s.booster ? { altitude: s.booster.r - Asc.EARTH.R, downrange: s.booster.th * Asc.EARTH.R, lit: s.booster.lit, mode: s.booster.mode } : null,
    };
    if (!hook(ctx, 'setFlightState', flight) && stack && !s.staged) {
      stack.position.y = stack0.y + Math.min(alt, 30000);
    }
    if (!sceneCam) {
      if (tracker.mode === 'track' && stack) tracker.follow(stack, 180 + Math.min(alt, 30000) * 0.02);
      if (s.phase === 'booster' && tracker.mode === 'scene' && stack && s.t > 6 && s.t < 7) tracker.set('track');
    }

    if (tick(dt)) render(reserve);

    if (s.phase === 'orbit' && resultAt == null) resultAt = s.t;
    if (s.phase === 'orbit' && (s.booster?.outcome || s.t - resultAt > 20 / Math.max(1, warp))) {
      const r = Asc.ascentResult(s);
      game.finish(r, { shipPropKg: r.shipPropKg, orbitAltKm: r.periKm }, {
        summaryHtml: `Orbit ${fmt(r.periKm)} x ${fmt(r.apoKm)} km, ${fmt(r.shipPropKg / 1e3, 1)} t propellant aboard. Booster: ${r.boosterOutcome}.`,
        summary: { periKm: r.periKm, apoKm: r.apoKm },
      });
    }
    if (s.phase === 'failed') game.fail(s.failReason || 'Vehicle lost', Asc.ascentResult(s));
  }

  function render(reserve) {
    const tf = Asc.tankFractions(s);
    const spd = Asc.speedRel(s) * 3.6, alt = Asc.altitude(s) / 1e3;
    const b = s.booster;
    const bSpd = b ? Math.hypot(b.vr, b.vt) * 3.6 : spd, bAlt = b ? (b.r - Asc.EARTH.R) / 1e3 : alt;
    wc.update({
      clock: clock(s.t),
      events: s.events.map((e) => e.name),
      booster: { speedKmh: bSpd, altKm: Math.max(0, bAlt), lox: tf.booster, ch4: tf.booster * 1.01, lit: Asc.boosterLitMask(s.boosterLit), active: !b || !b.outcome, pitchDeg: b ? (b.mode === 'landing' || b.mode === 'coast' ? 180 : 150) : s.pitchDeg },
      ship: { speedKmh: spd, altKm: Math.max(0, alt), lox: tf.ship, ch4: tf.ship * 1.01, lit: [s.shipLitSL > 0, s.shipLitSL > 1, s.shipLitSL > 2, s.shipLitVac > 0, s.shipLitVac > 1, s.shipLitVac > 2], active: s.phase !== 'prelaunch', pitchDeg: s.pitchDeg },
    });
    let msg;
    if (s.phase === 'prelaunch') msg = 'Vehicle is GO for launch. Press ENTER (LAUNCH) to start the terminal count.';
    else if (s.phase === 'countdown') msg = s.t < -3 ? 'Terminal count. Raptor chill complete.' : 'Engine startup';
    else if (s.phase === 'booster') msg = s.boosterProp <= reserve ? '<b class="warn">BOOSTBACK RESERVE REACHED: STAGE NOW (SPACE)</b>' : s.q > 25e3 ? 'Through max-Q: auto-throttle bucket' : 'Super Heavy ascent. Guidance flying a gravity turn.';
    else if (s.phase === 'ship') msg = s.seco ? 'SECO' : 'Starship to orbit. Guidance will cut off at target perigee (X for manual SECO).';
    else if (s.phase === 'orbit') msg = 'Orbit insertion confirmed.';
    else msg = `<b class="bad">${s.failReason || ''}</b>`;
    fd.set('msg', msg);
    fd.set('thr', fmt(s.phase === 'ship' || s.phase === 'booster' ? s.throttle * 100 : throttle * 100));
    fd.set('auto', autoThr ? 'ON' : 'OFF');
    fd.set('trim', (trim >= 0 ? '+' : '') + trim.toFixed(1));
    fd.set('q', fmt(s.q / 1e3, 1)); fd.set('mach', fmt(s.mach, 2)); fd.set('g', fmt(s.accelG, 2));
    const o = Asc.orbitOf(s, s.omega);
    fd.set('peri', s.phase === 'prelaunch' || s.phase === 'countdown' ? '--' : fmt(o.periKm));
    fd.set('apo', Number.isFinite(o.apoKm) && s.phase !== 'prelaunch' ? fmt(o.apoKm) : '--');
    fd.set('bst', b ? (b.outcome || b.mode.toUpperCase()) : s.staged ? '' : 'ATTACHED');
    game.setStatus(`<span>${s.phase === 'prelaunch' ? 'STARBASE, TEXAS' : 'ASCENT'}</span>${autopilot ? '<span class="g-ap">AUTOPILOT</span>' : ''}`);
  }

  // Scene clock. With a setFlightState / setMissionTime hook the scene follows
  // the sim directly. Otherwise (a scene that plays its own liftoff loop, like
  // the current src/scenes/launch.js: starts at T+10 s, wraps from T+40 s to
  // T-3 s) its clock is re-aligned once to T-3 s, held until the countdown
  // reaches T-3, then advanced with mission time and frozen after T+39 s.
  const sceneHooked = typeof ctx.setFlightState === 'function' || typeof ctx.setMissionTime === 'function';
  let sceneAligned = false, lastT = s.t;
  const clampT = (t) => Math.max(-3, Math.min(39, t));
  function sceneDt(dt) {
    if (sceneHooked) { hook(ctx, 'setMissionTime', s.t); return dt; }
    if (stack) return dt;
    if (!sceneAligned) { sceneAligned = true; lastT = s.t; return 30.01; }
    const d = clampT(s.t) - clampT(lastT);
    lastT = s.t;
    return Math.max(0, d);
  }

  return {
    update, sceneDt,
    help: [['Enter', 'Start countdown'], ['W S', 'Throttle up / down'], ['A D', 'Pitch trim'], ['Space', 'Stage (hot staging)'], ['X', 'Manual SECO'], ['G', 'Auto-throttle on/off'], ['U', 'Autopilot on/off'], ['C', 'Camera: tracking / chase / pad']],
    debug: () => ({ phase: s.phase, t: s.t, alt: Asc.altitude(s), speed: Asc.speedRel(s), shipProp: s.shipProp, booster: s.booster?.mode }),
  };
}
