// Phase 5: propulsive landing on Mars. Belly-flop fall, flip, landing burn
// with throttle / engine count / tilt control, touchdown scored on speed.
import * as Ld from '../sims/landing.js';
import { touchdownRating } from '../scoring.js';
import { drawEngines, LAYOUTS } from '../webcast.js';
import { el, panel, controlPad, fmt, every, fitCanvas } from '../ui.js';
import { hook, sceneObject, createTracker } from './common.js';

export async function create(game) {
  const { ctx, THREE, deps, input, layer, inputs, auto } = game;
  // Entry miss (km) becomes a pad offset; scaled because the landing phase
  // starts only ~25 km from the site.
  const missM = Math.max(-1200, Math.min(1200, (inputs.missKm ?? 0) * 20));
  const s = Ld.createLanding({ A: deps.A, B: deps.B, V: deps.V, altitude: inputs.altitude, vx: inputs.vx, vy: inputs.vy, propKg: inputs.propKg, missM });

  const tp = panel('LANDING', 'g-left');
  tp.text('msg', 'g-msg').row('alt', 'RADAR ALT', 'm').row('vs', 'VERTICAL SPEED', 'm/s').row('hs', 'HORIZONTAL SPEED', 'm/s')
    .row('dist', 'PAD DISTANCE', 'm').row('att', 'ATTITUDE', 'deg').row('thr', 'THROTTLE', '%').row('tw', 'T/W (MARS)').row('ign', 'BURN ADVISORY')
    .bar('prop', 'PROPELLANT').row('grav', 'GRAVITY', 'm/s2');
  layer.append(tp.root);

  const side = el('section', 'g-panel g-right g-sideview');
  side.innerHTML = '<h3 class="g-ptitle">SIDE VIEW</h3>';
  const cv = el('canvas', 'g-sidecv');
  const eng = el('canvas', 'g-wc-engines g-landeng');
  side.append(cv, eng);
  layer.append(side);

  const pad = controlPad(input, [
    [{ label: 'FLIP', code: 'KeyF', hold: false, cls: 'primary' }, { label: 'THR +', code: 'KeyW' }, { label: 'CUT', code: 'KeyX' }],
    [{ label: 'TILT L', code: 'KeyA' }, { label: 'THR -', code: 'KeyS' }, { label: 'TILT R', code: 'KeyD' }],
    [{ label: '1 ENG', code: 'Digit1', hold: false }, { label: '2 ENG', code: 'Digit2', hold: false }, { label: '3 ENG', code: 'Digit3', hold: false }],
    [{ label: 'AUTO', code: 'KeyU', hold: false }, { label: 'CAM', code: 'KeyC', hold: false }],
  ], 'g-pad-right g-pad-low');
  layer.append(pad);

  const ship = sceneObject(ctx, 'ship');
  const ship0 = ship ? ship.position.clone() : null;
  const tracker = createTracker(THREE, ctx.camera);
  let throttle = 0.7, engines = 3, autopilot = auto;
  const tick = every(15);
  game.setWarpLevels([0.25, 0.5, 1, 2], ['0.25x', '0.5x', '1x', '2x']);
  game.setWarp(2);

  function update(dt, warp) {
    if (input.wasPressed('KeyU')) { autopilot = !autopilot; game.toast(`Landing autopilot ${autopilot ? 'ON' : 'OFF'}`); }
    if (input.wasPressed('KeyC')) { tracker.set(tracker.mode === 'scene' ? 'track' : 'scene'); }
    for (const n of [1, 2, 3]) if (input.wasPressed(`Digit${n}`)) engines = n;
    throttle = Math.max(0.4, Math.min(1, throttle + input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) * 0.8 * dt));
    let c;
    if (autopilot) c = Ld.landingAutopilot(s);
    else c = { throttle, engines, tilt: input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), flip: input.wasPressed('KeyF'), cutoff: input.isDown('KeyX') };
    Ld.stepLanding(s, dt * warp, c);

    const st = { mode: s.mode, x: s.x - s.padX, altitude: s.y, vx: s.vx, vy: s.vy, thetaDeg: s.theta, throttle: s.throttle, enginesLit: s.prop > 0 ? s.enginesOn : 0 };
    if (!hook(ctx, 'setLandingState', st) && ship) {
      ship.position.set(ship0.x + (s.x - s.padX), ship0.y + s.y, ship0.z);
      ship.rotation.z = -s.theta * Math.PI / 180;
    }
    if (tracker.mode === 'track' && ship) tracker.follow(ship, 120 + Math.min(s.y, 5000) * 0.1);
    if (tick(dt)) render();
    if (s.mode === 'landed') {
      const r = Ld.landingResult(s);
      game.finish(r, {}, {
        headline: `TOUCHDOWN: ${touchdownRating(r.touchdown.vy)}`,
        summaryHtml: `${fmt(r.touchdown.vy, 2)} m/s vertical, ${fmt(r.touchdown.vx, 2)} m/s lateral, ${fmt(r.touchdown.tilt, 1)} deg tilt, ${fmt(r.touchdown.dist)} m from the pad. ${fmt(r.propKg / 1e3, 1)} t propellant left.`,
      });
    }
    if (s.mode === 'crashed') game.fail(s.failReason, Ld.landingResult(s));
  }

  function render() {
    const aMax = Ld.maxAccel(s, s.enginesWanted);
    const tw = aMax / s.g;
    const v = Math.hypot(s.vx, s.vy);
    const stop = s.vy < 0 ? (s.vy * s.vy) / (2 * Math.max(0.1, aMax * 0.8 - s.g)) : 0;
    let adv = '--';
    if (s.mode === 'fall') adv = s.y < -s.vy * 6 + stop + 1500 ? '<b class="warn">FLIP NOW (F)</b>' : `flip below ~${fmt((-s.vy * 6 + stop + 1500) / 1000, 1)} km`;
    else if (s.mode === 'burn') adv = stop > s.y ? '<b class="bad">MORE THRUST</b>' : 'MARGIN OK';
    tp.set('msg', {
      fall: 'Belly-flop descent. Flaps hold the belly into the wind. F: flip and light the engines.',
      flip: 'Flip manoeuvre: Raptors lighting, swinging upright.',
      burn: 'Landing burn. W/S throttle, A/D tilt to kill drift, 1-3 engines, hold X to cut. One engine at minimum throttle still out-thrusts Mars weight: no hover.',
      landed: 'Touchdown.', crashed: s.failReason,
    }[s.mode]);
    tp.set('alt', fmt(s.y)); tp.set('vs', fmt(s.vy, 1)); tp.set('hs', fmt(s.vx, 1)); tp.set('dist', fmt(s.x - s.padX));
    tp.set('att', fmt(s.theta, 1)); tp.set('thr', s.enginesOn ? fmt(s.throttle * 100) : 'OFF'); tp.set('tw', fmt(tw, 2)); tp.set('ign', adv);
    tp.setBar('prop', s.prop / 150e3, `${fmt(s.prop / 1e3, 1)} t`, s.prop < 10e3 ? 'bad' : '');
    tp.set('grav', fmt(s.g, 3));
    tp.flag('vs', s.y < 200 && s.vy < -Ld.LANDING_LIMITS.vyOk ? 'bad' : '');
    const lit = s.prop > 0 ? s.enginesOn : 0;
    drawEngines(eng, LAYOUTS.ship, [lit > 0, lit > 1, lit > 2, false, false, false]);
    drawSide(v);
    game.setStatus(`<span>JEZERO APPROACH</span>${autopilot ? '<span class="g-ap">AUTOPILOT</span>' : ''}`);
  }

  function drawSide() {
    const { g, w, h } = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    // log-ish vertical scale so both 8 km and the last 50 m are readable
    const Y = (y) => h - 18 - Math.log10(1 + Math.max(0, y) / 10) / Math.log10(1 + 10000 / 10) * (h - 36);
    const span = Math.max(300, Math.abs(s.x - s.padX) * 1.3, s.y * 0.6);
    const X = (x) => w / 2 + (x - s.padX) / span * (w / 2 - 10);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke();
    g.fillStyle = '#8fe3b0'; g.fillRect(X(s.padX) - 6, Y(0) - 1, 12, 3);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '10px ui-monospace, monospace';
    for (const a of [10, 100, 1000, 5000]) { g.fillText(a >= 1000 ? `${a / 1000} km` : `${a} m`, 4, Y(a) + 3); g.fillRect(40, Y(a), 6, 1); }
    const px = X(s.x), py = Y(s.y);
    g.save(); g.translate(px, py); g.rotate(s.theta * Math.PI / 180);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(-3, -16, 6, 20);
    if (s.enginesOn && s.prop > 0) { g.fillStyle = 'rgba(255,190,120,0.85)'; g.beginPath(); g.moveTo(-3, 4); g.lineTo(3, 4); g.lineTo(0, 4 + 10 + 10 * s.throttle); g.fill(); }
    g.restore();
    // velocity vector
    g.strokeStyle = 'rgba(255,200,120,0.8)'; g.beginPath(); g.moveTo(px, py); g.lineTo(px + s.vx * 0.05, py - s.vy * 0.05); g.stroke();
  }

  return {
    update,
    help: [['F', 'Flip and light the engines'], ['W S', 'Throttle'], ['A D', 'Tilt (gimbal / RCS)'], ['1 2 3', 'Engines lit'], ['X (hold)', 'Engine cutoff'], ['U', 'Autopilot'], ['C', 'Camera: scene / tracking']],
    debug: () => ({ mode: s.mode, y: s.y, vx: s.vx, vy: s.vy, prop: s.prop, padX: s.padX, x: s.x }),
  };
}
