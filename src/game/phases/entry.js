// Phase 4: Mars atmospheric entry. Choose the corridor (entry flight-path
// angle), then fly bank angle to manage g-load, heating and range.
import * as En from '../sims/entry.js';
import { el, panel, controlPad, fmt, every, fitCanvas } from '../ui.js';
import { hook } from './common.js';

export async function create(game) {
  const { ctx, deps, input, layer, inputs, auto } = game;
  const entrySpeed = inputs.entrySpeed ?? 5600;
  const err = inputs.corridorErrDeg ?? 0;
  const base = { A: deps.A, B: deps.B, X: deps.X, entrySpeed };
  // Target: where a nominal -11.5 deg / 60 deg-bank entry hands over.
  const nominalGamma = entrySpeed > 6500 ? -11.2 : -11.5;
  const nominal = En.simulateEntry({ ...base, gammaDeg: nominalGamma }, entrySpeed > 6500 ? 100 : 60, 0.5);
  const targetKm = nominal.mode === 'handoff' ? nominal.s / 1e3 : 1300;
  let gammaSel = nominalGamma;
  let s = null, bank = 60, pred = null, predT = 0;

  const ip = panel('ENTRY', 'g-left');
  ip.text('msg', 'g-msg').row('gam', 'CORRIDOR (EI FPA)', 'deg').row('err', 'NAV DISPERSION', 'deg').row('alt', 'ALTITUDE', 'km').row('vel', 'VELOCITY', 'm/s')
    .row('fpa', 'FLIGHT PATH', 'deg').row('bank', 'BANK', 'deg').row('range', 'RANGE TO GO', 'km').row('predr', 'PREDICTED MISS', 'km').row('blk', 'COMMS');
  layer.append(ip.root);

  const gauges = panel('LOADS', 'g-right g-gauges');
  gauges.bar('g', 'G-LOAD').bar('q', 'HEAT FLUX').bar('ql', 'HEAT LOAD').row('pg', 'PEAK G').row('pq', 'PEAK HEAT', 'kW/m2');
  const cv = el('canvas', 'g-profcv');
  gauges.root.append(cv);
  layer.append(gauges.root);

  const pad = controlPad(input, [
    [{ label: 'STEEPER', code: 'KeyS' }, { label: 'SHALLOWER', code: 'KeyW' }, { label: 'EI', code: 'Enter', hold: false, cls: 'primary' }],
    [{ label: 'LIFT UP', code: 'KeyA' }, { label: 'LIFT DOWN', code: 'KeyD' }, { label: 'AUTO', code: 'KeyU', hold: false }],
  ], 'g-pad-right g-pad-low');
  layer.append(pad);

  let autopilot = auto;
  const trace = [];
  const tick = every(10);
  game.setWarpLevels([1, 2, 5, 10], ['1x', '2x', '5x', '10x']);
  let preview = null, previewFor = null;

  function previewCorridor() {
    if (previewFor === gammaSel) return;
    previewFor = gammaSel;
    preview = En.simulateEntry({ ...base, gammaDeg: gammaSel + err, targetRangeKm: targetKm }, 60, 0.5);
    const q = En.createEntry({ ...base, gammaDeg: gammaSel + err });
    En.stepEntry(q, 0, { start: true });
    const pts = [];
    for (let i = 0; i < 3000 && q.mode === 'flying'; i++) { En.stepEntry(q, 2, { bankDeg: 60 }); pts.push([q.s / 1e3, Math.max(0, q.h / 1e3)]); }
    preview.path = pts;
  }

  /** Simple bank guidance: range error and g-load feedback. */
  function autoBank() {
    if (!pred) return 60;
    const miss = pred.missKm;
    let b = 60 + miss * 0.6;                           // long -> steeper bank (less lift up)
    if (s.g > 4.5) b = Math.min(b, 10);
    return Math.max(0, Math.min(180, b));
  }

  function update(dt, warp) {
    if (!s) {
      const d = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
      if (d) gammaSel = Math.round(Math.max(-16, Math.min(-8, gammaSel + d * 1.5 * dt)) * 100) / 100;
      previewCorridor();
      if (input.wasPressed('Enter') || auto) {
        s = En.createEntry({ ...base, gammaDeg: gammaSel + err, bankDeg: bank, targetRangeKm: targetKm });
        En.stepEntry(s, 0, { start: true });
        game.toast('Entry interface: 125 km');
      }
      if (tick(dt)) render();
      return;
    }
    if (input.wasPressed('KeyU')) { autopilot = !autopilot; game.toast(`Bank guidance ${autopilot ? 'ON' : 'OFF'}`); }
    if (autopilot) bank = autoBank();
    else bank = Math.max(0, Math.min(180, bank + input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) * 30 * dt));
    En.stepEntry(s, dt * warp, { bankDeg: bank });
    predT -= dt;
    if (predT <= 0 && s.mode === 'flying') {
      predT = 0.5;
      // fast-time prediction at the current bank
      const p = { ...s, mode: 'flying' };
      for (let i = 0; i < 4000 && p.mode === 'flying'; i++) En.stepEntry(p, 1, { bankDeg: bank });
      pred = { mode: p.mode, missKm: p.s / 1e3 - targetKm, reason: p.failReason };
    }
    if (trace.length === 0 || s.t - trace[trace.length - 1][2] > 2) trace.push([s.s / 1e3, s.h / 1e3, s.t]);
    hook(ctx, 'setEntryState', { altitude: s.h, speed: s.v, gammaDeg: s.gamma * 180 / Math.PI, bankDeg: bank, heatFlux: s.q, gLoad: s.g, t: s.t });
    if (tick(dt)) render();
    if (s.mode === 'handoff') {
      const r = En.entryResult(s);
      const g = s.gamma;
      game.finish(r, {
        altitude: s.h, vx: s.v * Math.cos(g), vy: s.v * Math.sin(g), missKm: r.missKm, propKg: inputs.shipPropKg != null ? Math.min(inputs.shipPropKg, 150e3) : 100e3,
      }, { summaryHtml: `Handover at ${fmt(r.altitude / 1e3, 1)} km, ${fmt(r.speed)} m/s. Peak ${fmt(r.peakG, 2)} g, ${fmt(r.peakHeatKW)} kW/m2. Miss ${fmt(r.missKm, 1)} km.` });
    }
    if (s.mode === 'failed') game.fail(s.failReason, En.entryResult(s));
  }

  function render() {
    const L = En.LIMITS;
    ip.set('gam', fmt(gammaSel, 2)); ip.set('err', (err >= 0 ? '+' : '') + fmt(err, 2));
    if (!s) {
      const p = preview;
      const outcome = p.mode === 'handoff' ? `<b class="ok">SURVIVABLE</b>: peak ${fmt(p.peakG, 1)} g, ${fmt(p.peakQ / 1e3)} kW/m2 at 60 deg bank` : `<b class="bad">${p.failReason}</b>`;
      ip.set('msg', `Entry at ${fmt(entrySpeed)} m/s. Choose the corridor with W/S, ENTER at entry interface. ${outcome}`);
      ['alt', 'vel', 'fpa', 'bank', 'range', 'predr', 'blk'].forEach((k) => ip.set(k, '--'));
      gauges.setBar('g', 0, ''); gauges.setBar('q', 0, ''); gauges.setBar('ql', 0, '');
      drawProfile(p);
      game.setStatus('<span>MARS APPROACH</span>');
      return;
    }
    ip.set('msg', s.mode === 'flying' ? 'A: roll lift up (shallower, less g). D: roll lift down (steeper). Keep g under 4 and hit the target range.' : s.failReason || 'Handover to landing');
    ip.set('alt', fmt(s.h / 1e3, 1)); ip.set('vel', fmt(s.v)); ip.set('fpa', fmt(s.gamma * 180 / Math.PI, 2));
    ip.set('bank', fmt(bank)); ip.set('range', fmt(targetKm - s.s / 1e3));
    ip.set('predr', pred ? (pred.mode === 'handoff' ? fmt(pred.missKm, 1) : `<b class="bad">${pred.mode === 'failed' ? 'FAIL' : '--'}</b>`) : '--');
    ip.set('blk', s.v > 3500 && s.h < 90e3 && s.h > 30e3 ? '<b class="warn">PLASMA BLACKOUT</b>' : 'NOMINAL');
    gauges.setBar('g', s.g / L.gFail, `${fmt(s.g, 2)} g`, s.g > L.gWarn ? 'bad' : '');
    gauges.setBar('q', s.q / L.heatFail, `${fmt(s.q / 1e3)} kW/m2`, s.q > L.heatWarn ? 'bad' : '');
    gauges.setBar('ql', s.heatLoad / 1e6 / 80, `${fmt(s.heatLoad / 1e6, 1)} MJ/m2`);
    gauges.set('pg', fmt(s.peakG, 2)); gauges.set('pq', fmt(s.peakQ / 1e3));
    drawProfile(null);
    game.setStatus(`<span>MARS ENTRY</span>${autopilot ? '<span class="g-ap">BANK GUIDANCE</span>' : ''}`);
  }

  function drawProfile(p) {
    const { g, w, h } = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    const mx = Math.max(targetKm * 1.25, 200), my = 130;
    const X = (km) => 8 + km / mx * (w - 16), Y = (hk) => h - 14 - hk / my * (h - 24);
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.moveTo(8, Y(0)); g.lineTo(w - 8, Y(0)); g.stroke();
    g.fillStyle = '#8fe3b0'; g.beginPath(); g.arc(X(targetKm), Y(En.LIMITS.handoffAlt / 1e3), 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '10px ui-monospace, monospace'; g.fillText('ALT vs DOWNRANGE', 10, 12);
    const line = (pts, col) => { g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke(); };
    if (p && !s) {
      line(p.path, p.mode === 'handoff' ? 'rgba(255,255,255,0.7)' : 'rgba(255,120,100,0.8)');
    }
    if (trace.length) line([...trace.map(([a, b]) => [a, b]), [s.s / 1e3, s.h / 1e3]], '#fff');
  }

  return {
    update,
    help: [['W S', 'Before EI: shallower / steeper corridor'], ['Enter', 'Commit corridor, begin entry'], ['A D', 'Bank: lift up / lift down'], ['U', 'Bank guidance on/off']],
    debug: () => (s ? { mode: s.mode, h: s.h, v: s.v, g: s.g, q: s.q } : { mode: 'pre', gamma: gammaSel }),
  };
}
