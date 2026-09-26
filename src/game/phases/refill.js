// Phase 2: orbital refilling. The player flies each tanker to the depot's
// docking port (Clohessy-Wiltshire relative motion), then watches the transfer;
// boil-off runs the whole time.
import * as F from '../sims/refill.js';
import { shipPropulsion, propForDv, LANDING_RESERVE_KG, PAYLOAD_KG, FALLBACK_TRANSFER } from '../sims/cruise.js';
import { el, panel, controlPad, fmt, every, fitCanvas } from '../ui.js';
import { hook, sceneObject } from './common.js';

export async function create(game) {
  const { ctx, deps, input, layer, inputs, auto } = game;
  const s = F.createRefill({ R: deps.R, shipPropKg: inputs.shipPropKg });
  const prop = shipPropulsion(deps.V, 'all');
  // Requirement: the 2026 minimum-energy TMI plus the Mars landing reserve.
  const requiredKg = propForDv(FALLBACK_TRANSFER.tmiDv, prop.isp, prop.dry + PAYLOAD_KG + LANDING_RESERVE_KG) + LANDING_RESERVE_KG;

  const dp = panel('PROPELLANT DEPOT', 'g-left');
  dp.text('msg', 'g-msg').bar('prop', 'TOTAL').bar('lox', 'LOX').bar('ch4', 'CH4')
    .row('need', 'NEEDED FOR TMI', 't').row('boil', 'BOIL-OFF', 't/day').row('lost', 'LOST TO BOIL-OFF', 't')
    .row('day', 'ORBIT DAY').row('tk', 'TANKERS DOCKED').row('next', 'NEXT TANKER').row('src', 'MODEL');
  layer.append(dp.root);

  const dock = el('section', 'g-panel g-right g-dock');
  dock.innerHTML = '<h3 class="g-ptitle">DOCKING</h3>';
  const cv = el('canvas', 'g-dockcv'); dock.append(cv);
  const dk = panel(null, 'g-inline');
  dk.row('rng', 'RANGE', 'm').row('rr', 'CLOSING', 'm/s').row('lat', 'LATERAL', 'm').row('rcs', 'RCS DV', 'm/s');
  dock.append(dk.root);
  layer.append(dock);

  const pad = controlPad(input, [
    [{ label: 'UP R', code: 'KeyR' }, { label: 'FWD', code: 'KeyW' }, { label: 'DOWN R', code: 'KeyF' }],
    [{ label: 'LEFT', code: 'KeyA' }, { label: 'BACK', code: 'KeyS' }, { label: 'RIGHT', code: 'KeyD' }],
    [{ label: 'AUTO', code: 'KeyU', hold: false }, { label: 'NEXT', code: 'KeyN', hold: false, title: 'Skip to next tanker' }, { label: 'DEPART', code: 'Enter', hold: false, cls: 'primary' }],
  ], 'g-pad-right g-pad-low');
  layer.append(pad);

  const ship = sceneObject(ctx, 'ship', 'depot');
  const tanker = sceneObject(ctx, 'tanker');
  let autopilot = auto;
  const tick = every(12);
  let lastMode = s.mode;

  function setWarp() {
    if (s.mode === 'approach') game.setWarpLevels([1, 2, 5, 10, 25], ['1x', '2x', '5x', '10x', '25x']);
    else game.setWarpLevels([1, 60, 600, 3600, 21600], ['1x', '1 min/s', '10 min/s', '1 h/s', '6 h/s']);
  }
  setWarp();

  function update(dt, warp) {
    if (input.wasPressed('KeyU')) { autopilot = !autopilot; game.toast(`Approach autopilot ${autopilot ? 'ON' : 'OFF'}`); }
    const thrust = [input.axis(['KeyF'], ['KeyR']), input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']), input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight'])];
    let finish = input.wasPressed('Enter');
    const skip = input.wasPressed('KeyN') || (auto && s.mode === 'waiting');
    if (auto && s.tankers.length >= 2 && s.mode === 'waiting') finish = true;
    F.stepRefill(s, dt * warp, { thrust, auto: autopilot, skip, finish });
    if (s.mode !== lastMode) {
      if (s.mode === 'approach' || lastMode === 'approach') { game.setWarp(0); setWarp(); }
      if (s.mode === 'transfer') game.toast('Soft capture confirmed');
      lastMode = s.mode;
    }
    const st = { mode: s.mode, rel: s.rel ? { ...s.rel } : null, shipPropKg: s.shipProp, day: s.day, transferring: s.mode === 'transfer' };
    if (!hook(ctx, 'setRefillState', st) && ship && tanker && s.rel) {
      tanker.position.set(ship.position.x + s.rel.y, ship.position.y + s.rel.x, ship.position.z + s.rel.z);
    }
    if (tick(dt)) render(warp);
    if (s.mode === 'done') {
      const r = F.refillResult(s);
      game.finish(r, { shipPropKg: r.shipPropKg }, {
        scoreArg: requiredKg,
        summaryHtml: `${r.tankers} tanker(s) in ${fmt(r.days, 1)} days. Depot holds ${fmt(r.shipPropKg / 1e3)} t (need ${fmt(requiredKg / 1e3)} t). Boil-off ${fmt(r.boiloffKg / 1e3, 1)} t.`,
      });
    }
    if (s.mode === 'failed') game.fail(s.failReason, F.refillResult(s));
  }

  function render() {
    const cap = s.p.shipCapacityKg;
    const f = s.shipProp / cap;
    dp.set('msg', s.mode === 'approach' ? `${s.message}. Fly to the port: closing below ${s.p.dockMaxSpeed} m/s, within ${s.p.dockMaxLateral} m.` : s.mode === 'waiting' ? `${s.message}. N: skip ahead. ENTER: depart for TMI.` : s.message);
    dp.setBar('prop', f, `${fmt(s.shipProp / 1e3)} t`, s.shipProp >= requiredKg ? 'ok' : '');
    dp.setBar('lox', f, ''); dp.setBar('ch4', f, '');
    dp.set('need', fmt(requiredKg / 1e3));
    dp.set('boil', fmt(s.p.boilKgPerDay(s.shipProp / s.p.shipCapacityKg) / 1e3, 2));
    dp.set('lost', fmt(s.lostBoiloff / 1e3, 2));
    dp.set('day', fmt(s.day, 2)); dp.set('tk', String(s.tankers.length));
    dp.set('next', s.mode === 'waiting' ? `${fmt(Math.max(0, s.nextTankerDay - s.day), 2)} d` : s.mode === 'approach' ? 'ON APPROACH' : s.mode === 'transfer' ? 'DOCKED' : '--');
    dp.set('src', s.p.source);
    const rel = s.rel;
    if (rel) {
      dk.set('rng', fmt(F.range(rel), 1)); dk.set('rr', fmt(rel.vy, 2)); dk.set('lat', fmt(Math.hypot(rel.x, rel.z), 2)); dk.set('rcs', fmt(s.fuelUsedRcs, 1));
      dk.flag('rr', rel.vy > s.p.dockMaxSpeed && -rel.y < 30 ? 'bad' : '');
    } else { dk.set('rng', '--'); dk.set('rr', '--'); dk.set('lat', '--'); }
    drawDock();
    game.setStatus(`<span>LEO ${s.p.orbitAltKm} KM DEPOT</span>${autopilot ? '<span class="g-ap">AUTO APPROACH</span>' : ''}`);
  }

  function drawDock() {
    const { g, w, h } = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.42;
    // crosshair
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - 70, cy); g.lineTo(cx + 70, cy); g.moveTo(cx, cy - 70); g.lineTo(cx, cy + 70); g.stroke();
    g.beginPath(); g.arc(cx, cy, 30, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(120,220,160,0.7)';
    g.beginPath(); g.arc(cx, cy, 30 * s.p.dockMaxLateral / 2, 0, Math.PI * 2); g.stroke();
    if (s.rel) {
      const rel = s.rel;
      // lateral offset seen along the docking axis, scaled 15 px per metre (log beyond)
      const sc = (v) => Math.sign(v) * Math.min(70, 15 * Math.abs(v));
      const px = cx + sc(rel.z), py = cy - sc(rel.x);
      const ok = Math.hypot(rel.x, rel.z) <= s.p.dockMaxLateral;
      g.strokeStyle = ok ? '#8fe3b0' : '#ffb347'; g.lineWidth = 2;
      g.beginPath(); g.arc(px, py, 8, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(px - 12, py); g.lineTo(px + 12, py); g.moveTo(px, py - 12); g.lineTo(px, py + 12); g.stroke();
      // range bar along V-bar
      const y0 = h * 0.86, x0 = 16, x1 = w - 16;
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.stroke();
      const r = Math.min(1, Math.log10(1 + Math.max(0, -rel.y)) / Math.log10(1 + s.p.startRange));
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x1 - r * (x1 - x0), y0, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '10px ui-monospace, monospace';
      g.fillText('V-BAR (log)', x0, y0 - 8); g.fillText('PORT', x1 - 26, y0 - 8);
    } else {
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '12px ui-monospace, monospace'; g.textAlign = 'center';
      g.fillText(s.mode === 'transfer' ? 'DOCKED: PROPELLANT TRANSFER' : 'NO TARGET', cx, cy + 90); g.textAlign = 'left';
    }
  }

  return {
    update,
    help: [['W S', 'Along-track thrust (toward / away from port)'], ['A D', 'Cross-track thrust'], ['R F', 'Radial thrust up / down'], ['U', 'Approach autopilot'], ['N', 'Skip to next tanker (boil-off continues)'], ['Enter', 'Depart: finish refilling']],
    debug: () => ({ mode: s.mode, prop: s.shipProp, day: s.day, tankers: s.tankers.length, rel: s.rel }),
  };
}
