// Phase 3: departure date selection on a porkchop plot, the trans-Mars
// injection burn with the six Raptors, then a time-warped cruise.
import * as C from '../sims/cruise.js';
import { el, panel, controlPad, fmt, every, fitCanvas } from '../ui.js';
import { hook } from './common.js';

const AU = 149597870.7;

export async function create(game) {
  const { ctx, deps, input, layer, inputs, auto } = game;
  const T = deps.T, E = deps.E;
  const year = Number(game.params.get('year')) || 2026;
  const pc = C.buildPorkchop(T, { year });
  const s = C.createCruise({ V: deps.V, shipPropKg: inputs.shipPropKg, transfer: pc?.best ?? C.FALLBACK_TRANSFER });
  const iso = (jd) => (E && typeof E.isoDate === 'function' ? E.isoDate(jd) : `JD ${jd.toFixed(1)}`);
  let ci = 0, cj = 0;                       // porkchop cursor
  if (pc) outer: for (let i = 0; i < pc.deps.length; i++) for (let j = 0; j < pc.tofs.length; j++) if (pc.cells[i][j] === pc.best) { ci = i; cj = j; break outer; }

  const info = panel('TRANSFER', 'g-left');
  info.text('msg', 'g-msg').row('dep', 'DEPART').row('arr', 'ARRIVE').row('tof', 'TIME OF FLIGHT', 'd').row('c3', 'C3', 'km2/s2')
    .row('vinf', 'V-INF AT MARS', 'km/s').row('dv', 'TMI DELTA-V', 'm/s').row('avail', 'DV AVAILABLE', 'm/s').bar('prop', 'PROPELLANT')
    .row('go', 'STATUS');
  layer.append(info.root);

  const plot = el('section', 'g-panel g-right g-plot');
  const ptitle = el('h3', 'g-ptitle', 'PORKCHOP: C3 (km2/s2)');
  const cv = el('canvas', 'g-plotcv');
  plot.append(ptitle, cv);
  layer.append(plot);

  const burn = panel('TMI BURN', 'g-center g-burn hidden');
  burn.row('togo', 'DV TO GO', 'm/s').row('done', 'DV DONE', 'm/s').row('thr', 'THROTTLE', '%').row('bt', 'BURN TIME', 's').row('acc', 'ACCEL', 'g').row('ac', 'AUTO CUTOFF');
  layer.append(burn.root);

  const pad = controlPad(input, [
    [{ label: 'EARLIER', code: 'KeyA' }, { label: 'LONGER', code: 'KeyW' }, { label: 'LATER', code: 'KeyD' }],
    [{ label: 'SHORTER', code: 'KeyS' }, { label: 'COMMIT', code: 'Enter', hold: false, cls: 'primary' }, { label: 'CUTOFF', code: 'KeyX', hold: false, cls: 'warn' }],
    [{ label: 'IGNITE', code: 'Space', hold: false }, { label: 'TCM', code: 'KeyT', hold: false }, { label: 'AUTO', code: 'KeyG', hold: false }],
  ], 'g-pad-right g-pad-low');
  layer.append(pad);

  let throttle = 1, autoCut = true, repeat = 0;
  const tick = every(10);
  game.setWarpLevels([1], ['1x']);
  let lastMode = s.mode;

  function moveCursor(dt) {
    if (!pc) return;
    const ax = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), ay = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    if (!ax && !ay) { repeat = 0; return; }
    repeat -= dt;
    if (repeat > 0) return;
    repeat = repeat < -0.05 ? 0.06 : 0.18;
    ci = Math.max(0, Math.min(pc.deps.length - 1, ci + ax));
    cj = Math.max(0, Math.min(pc.tofs.length - 1, cj + ay));
    const cell = pc.cells[ci][cj];
    if (cell) C.selectTransfer(s, cell);
  }

  cv.addEventListener('pointerdown', (e) => {
    if (!pc || s.mode !== 'select') return;
    const r = cv.getBoundingClientRect(), m = margins(r.width, r.height);
    const i = Math.round((e.clientX - r.left - m.l) / (r.width - m.l - m.r) * (pc.deps.length - 1));
    const j = Math.round((1 - (e.clientY - r.top - m.t) / (r.height - m.t - m.b)) * (pc.tofs.length - 1));
    if (i >= 0 && i < pc.deps.length && j >= 0 && j < pc.tofs.length && pc.cells[i][j]) { ci = i; cj = j; C.selectTransfer(s, pc.cells[i][j]); }
  });

  function update(dt, warp) {
    if (s.mode === 'select') {
      moveCursor(dt);
      if (input.wasPressed('Enter') || auto) { C.stepCruise(s, 0, { ignite: true }); game.toast('TMI: Raptor ignition'); }
    } else if (s.mode === 'burn') {
      if (input.wasPressed('KeyG')) { autoCut = !autoCut; game.toast(`Auto cutoff ${autoCut ? 'ON' : 'OFF'}`); }
      throttle = Math.max(0.4, Math.min(1, throttle + input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) * 0.6 * dt));
      C.stepCruise(s, dt * warp, { throttle, ignite: input.wasPressed('Space'), cutoff: input.wasPressed('KeyX'), autoCutoff: autoCut });
    } else if (s.mode === 'coast') {
      if (input.wasPressed('KeyT')) {
        if (s.tcmDone) game.toast('TCM already performed');
        else { C.stepCruise(s, 0, { tcm: true }); game.toast(`TCM: ${fmt(s.tcmDv, 1)} m/s, corridor error nulled`); }
      }
      C.stepCruise(s, dt * warp, {});
    }
    if (s.mode !== lastMode) {
      lastMode = s.mode;
      if (s.mode === 'burn') { game.setWarpLevels([1, 2, 5], ['1x', '2x', '5x']); burn.root.classList.remove('hidden'); ptitle.textContent = 'HELIOCENTRIC VIEW'; }
      if (s.mode === 'coast') {
        burn.root.classList.add('hidden');
        game.setWarpLevels([3600, 86400, 432000, 1728000], ['1 h/s', '1 d/s', '5 d/s', '20 d/s']);
        game.setWarp(auto ? 3 : 1);
        game.toast(`TMI complete. Residual ${fmt(s.residual, 1)} m/s`);
      }
    }
    hook(ctx, 'setCruiseState', { mode: s.mode, day: s.day, tofDays: s.transfer.tofDays, firing: s.firing, throttle: s.throttle });
    if (tick(dt)) render();
    if (s.mode === 'arrived') {
      const r = C.cruiseResult(s);
      game.finish(r, { entrySpeed: r.entrySpeed, corridorErrDeg: r.corridorErrDeg, shipPropKg: r.shipPropKg, vinfArr: r.vinfArr },
        { scoreArg: pc?.best?.c3 ?? r.c3, summaryHtml: `Arrived at Mars after ${fmt(r.tofDays)} days. Entry speed ${fmt(r.entrySpeed)} m/s, corridor error ${fmt(r.corridorErrDeg, 2)} deg.` });
    }
    if (s.mode === 'failed') game.fail(s.failReason, C.cruiseResult(s));
  }

  function render() {
    const tr = s.transfer;
    const dvAv = C.dvAvailable(s);
    info.set('dep', iso(tr.jdDep)); info.set('arr', iso(tr.jdDep + tr.tofDays)); info.set('tof', fmt(tr.tofDays));
    info.set('c3', fmt(tr.c3, 2)); info.set('vinf', fmt(tr.vinfArr, 2)); info.set('dv', fmt(tr.tmiDv)); info.set('avail', fmt(dvAv));
    info.setBar('prop', s.shipProp / 1500e3, `${fmt(s.shipProp / 1e3)} t`);
    const ok = dvAv >= tr.tmiDv;
    info.set('go', s.mode === 'select' ? (ok ? '<b class="ok">GO: reserve kept</b>' : '<b class="warn">EATS LANDING RESERVE</b>') : s.mode.toUpperCase());
    let msg;
    if (s.mode === 'select') msg = pc ? 'Pick a departure (A/D) and flight time (W/S), or click the plot. ENTER commits and lights the engines.' : 'transfer.js unavailable: using a fixed 2026 minimum-energy transfer. ENTER to burn.';
    else if (s.mode === 'burn') msg = s.firing ? 'Six Raptors burning. W/S throttle, X cutoff.' : 'Engines off. SPACE to relight, X to end the burn.';
    else if (s.mode === 'coast') msg = `Cruise day ${fmt(s.day)} of ${fmt(tr.tofDays)}. ${s.tcmDone ? 'TCM done.' : `Corridor error ${fmt(s.corridorErrDeg, 2)} deg: T for a correction burn.`} Use time warp.`;
    else msg = s.failReason || '';
    info.set('msg', msg);
    if (s.mode === 'burn') {
      burn.set('togo', fmt(Math.max(0, C.dvRequired(s) - s.dvDone), 1)); burn.set('done', fmt(s.dvDone, 1));
      burn.set('thr', fmt(s.throttle * 100)); burn.set('bt', fmt(s.burnTime, 1));
      burn.set('acc', fmt(s.firing ? s.prop.F * s.throttle / C.shipMass(s) / 9.80665 : 0, 2)); burn.set('ac', autoCut ? 'ON' : 'OFF');
    }
    if (s.mode === 'select' && pc) drawPorkchop(); else drawHelio();
    game.setStatus(`<span>${s.mode === 'select' ? `${year} WINDOW` : s.mode === 'burn' ? 'TMI BURN' : 'CRUISE'}</span><span class="g-note">${s.prop.source === 'fallback' ? 'fallback engines' : ''}</span>`);
  }

  const margins = () => ({ l: 44, r: 10, t: 10, b: 30 });
  let porkImg = null;
  function drawPorkchop() {
    const { g, w, h } = fitCanvas(cv);
    const m = margins(w, h);
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    const nI = pc.deps.length, nJ = pc.tofs.length;
    if (!porkImg || porkImg.w !== nI) {
      // colour cells by C3 (log scale), cached to an offscreen canvas
      const oc = document.createElement('canvas'); oc.width = nI; oc.height = nJ;
      const og = oc.getContext('2d'); const img = og.createImageData(nI, nJ);
      const lo = Math.log(pc.best.c3), hi = Math.log(60);
      for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) {
        const c = pc.cells[i][j]; const k = ((nJ - 1 - j) * nI + i) * 4;
        if (!c || c.c3 > 60) { img.data[k + 3] = 30; continue; }
        const u = Math.max(0, Math.min(1, (Math.log(c.c3) - lo) / (hi - lo)));
        // dark blue -> teal -> amber ramp
        img.data[k] = 30 + 225 * u ** 1.3; img.data[k + 1] = 70 + 150 * Math.sin(u * Math.PI * 0.9); img.data[k + 2] = 150 * (1 - u) + 40; img.data[k + 3] = 230;
      }
      og.putImageData(img, 0, 0); porkImg = { c: oc, w: nI };
    }
    g.clearRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    g.drawImage(porkImg.c, m.l, m.t, pw, ph);
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.strokeRect(m.l, m.t, pw, ph);
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '10px ui-monospace, monospace';
    for (let i = 0; i < nI; i += Math.ceil(nI / 4)) g.fillText(iso(pc.deps[i]).slice(0, 10), m.l + i / (nI - 1) * pw - 26, h - 16);
    for (let j = 0; j < nJ; j += Math.ceil(nJ / 5)) g.fillText(String(pc.tofs[j]), 8, m.t + (1 - j / (nJ - 1)) * ph + 3);
    g.fillText('DEPARTURE', m.l + pw / 2 - 26, h - 3);
    g.save(); g.translate(10, m.t + ph / 2 + 20); g.rotate(-Math.PI / 2); g.fillText('TOF (d)', 0, 0); g.restore();
    // best + cursor
    const pos = (i, j) => [m.l + i / (nI - 1) * pw, m.t + (1 - j / (nJ - 1)) * ph];
    let bi = 0, bj = 0;
    for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) if (pc.cells[i][j] === pc.best) { bi = i; bj = j; }
    const [bx, by] = pos(bi, bj);
    g.strokeStyle = '#8fe3b0'; g.beginPath(); g.arc(bx, by, 5, 0, Math.PI * 2); g.stroke();
    const [x, y] = pos(ci, cj);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.stroke();
  }

  let pathCache = null;
  function drawHelio() {
    const { g, w, h } = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, sc = Math.min(w, h) / 2 / 1.75;
    const P = (xy) => [cx + xy[0] * sc, cy - xy[1] * sc];
    g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
    const tr = s.transfer;
    const have = E && typeof E.planetState === 'function';
    const orbit = (name, col) => {
      if (!have) return;
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath();
      const per = name === 'earth' ? 365.25 : 687;
      for (let k = 0; k <= 96; k++) { const st = E.planetState(name, tr.jdDep + per * k / 96); const [x, y] = P([st.r[0] / AU, st.r[1] / AU]); k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    };
    orbit('earth', 'rgba(120,170,255,0.35)'); orbit('mars', 'rgba(255,140,90,0.35)');
    const jd = tr.jdDep + (s.mode === 'coast' || s.mode === 'arrived' ? s.day : 0);
    if (have) {
      if (!pathCache || pathCache.tr !== tr) {
        const e0 = E.planetState('earth', tr.jdDep);
        const v0 = tr.vinfDepV ? e0.v.map((v, k) => v + tr.vinfDepV[k]) : null;
        pathCache = { tr, pts: v0 ? C.propagateHelio(e0.r, v0, tr.tofDays) : [] };
      }
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.setLineDash([4, 4]); g.beginPath();
      pathCache.pts.forEach((p, k) => { const [x, y] = P(p); k ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke(); g.setLineDash([]);
      const dot = (name, col, r) => { const st = E.planetState(name, jd); const [x, y] = P([st.r[0] / AU, st.r[1] / AU]); g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
      dot('earth', '#78aaff', 4); dot('mars', '#ff8c5a', 4);
      if (pathCache.pts.length) {
        const k = Math.min(pathCache.pts.length - 1, Math.round(s.day / tr.tofDays * (pathCache.pts.length - 1)));
        const [x, y] = P(pathCache.pts[k]); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '11px ui-monospace, monospace';
    g.fillText(iso(jd).slice(0, 10), 10, 16);
  }

  return {
    update,
    help: [['A D', 'Porkchop: earlier / later departure'], ['W S', 'Porkchop: flight time. Burn: throttle'], ['Enter', 'Commit departure, ignite'], ['Space', 'Relight engines'], ['X', 'Engine cutoff'], ['G', 'Auto cutoff on/off'], ['T', 'Trajectory correction manoeuvre (cruise)']],
    debug: () => ({ mode: s.mode, day: s.day, dvDone: s.dvDone, prop: s.shipProp, porkchop: !!pc }),
  };
}
