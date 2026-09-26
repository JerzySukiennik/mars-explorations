// Trans-Mars injection and cruise.
//
// Pure ES module. The porkchop uses src/physics/transfer.js (Lambert arcs between
// Standish ephemeris states) passed in as `T`, with `E` = src/physics/ephemeris.js
// for dates/positions. Burn performance uses src/physics/vehicle.js (`V`) when
// present. Everything is feature-detected; with no modules the game falls back
// to a Hohmann-class transfer with fixed numbers.

const G0 = 9.80665;
const MU_SUN = 1.32712440018e11;   // km^3/s^2
const AU = 149597870.7;
const DAY = 86400;

/**
 * Porkchop grid of C3 / arrival v-inf / TMI dv over a departure window.
 * Returns { jdCentre, deps[], tofs[], cells[i][j] | null, best }.
 */
export function buildPorkchop(T, { year = 2026, depSpan = 60, dDep = 3, tofMin = 140, tofMax = 360, dTof = 8 } = {}) {
  if (!T || typeof T.evalTransfer !== 'function' || typeof T.opportunityCentre !== 'function') return null;
  const jc = T.opportunityCentre(year);
  if (jc == null) return null;
  const deps = [], tofs = [];
  for (let d = -depSpan; d <= depSpan + 1e-9; d += dDep) deps.push(jc + d);
  for (let t = tofMin; t <= tofMax + 1e-9; t += dTof) tofs.push(t);
  let best = null;
  const cells = deps.map((jd) => tofs.map((tof) => {
    const r = T.evalTransfer(jd, tof);
    if (!r || !Number.isFinite(r.c3)) return null;
    const sum = typeof T.transferSummary === 'function' ? T.transferSummary(r) : r;
    const cell = {
      jdDep: jd, tofDays: tof, c3: r.c3, vinfDep: r.vinfDep, vinfArr: r.vinfArr,
      vinfDepV: r.vinfDepV, type: r.type,
      tmiDv: (sum.leoTmiDv ?? tmiFallback(r.vinfDep)) * 1000,        // m/s
      entrySpeed: (sum.marsEntrySpeed ?? Math.sqrt(r.vinfArr ** 2 + 2 * 42828.37 / (3396.19 + 125))) * 1000,
    };
    if (!best || cell.c3 < best.c3) best = cell;
    return cell;
  }));
  return { jdCentre: jc, deps, tofs, cells, best };
}

function tmiFallback(vinf, mu = 398600.4418, r = 6378.137 + 200) {
  return Math.sqrt(vinf * vinf + 2 * mu / r) - Math.sqrt(mu / r);
}

/** Built-in transfer when transfer.js is unavailable (2026 min-energy-like). */
export const FALLBACK_TRANSFER = Object.freeze({
  jdDep: 2461343.0, tofDays: 294, c3: 9.15, vinfDep: 3.03, vinfArr: 2.95, type: 'I',
  tmiDv: 3632, entrySpeed: 5636, fallback: true,
});

/** Ship propulsion for the burn (vacuum): all six engines or RVacs only. */
export function shipPropulsion(V, mode = 'all') {
  if (V && V.SHIP && typeof V.thrust === 'function') {
    const groups = V.SHIP.engines.filter((g) => mode === 'all' || /vac/i.test(g.engine.name || ''));
    const F = groups.reduce((a, g) => a + g.count * V.thrust(g.engine, 0, 1), 0);
    const md = groups.reduce((a, g) => a + g.count * V.massFlow(g.engine, 1), 0);
    return { F, mdot: md, isp: F / (md * G0), dry: V.SHIP.dryMass, throttleMin: 0.4, source: 'physics/vehicle.js' };
  }
  const n = mode === 'all' ? 6 : 3;
  const F = mode === 'all' ? 3 * 2.43e6 + 3 * 2.62e6 : 3 * 2.62e6;
  return { F, mdot: n * 703, isp: F / (n * 703 * G0), dry: 100e3, throttleMin: 0.4, source: 'fallback' };
}

/** Propellant (kg) needed for a dv with a given final mass. */
export function propForDv(dv, isp, mFinal) { return mFinal * (Math.exp(dv / (isp * G0)) - 1); }

export const LANDING_RESERVE_KG = 100e3;  // supersonic-retropropulsion landing reserve at Mars
export const PAYLOAD_KG = 100e3;

export function createCruise(opts = {}) {
  const prop = shipPropulsion(opts.V, opts.engineMode ?? 'all');
  const tr = opts.transfer ?? FALLBACK_TRANSFER;
  return {
    prop, transfer: tr,
    payload: opts.payload ?? PAYLOAD_KG,
    shipProp: opts.shipPropKg ?? 1200e3,
    mode: 'select',                  // select | burn | coast | arrived | failed
    dvDone: 0, burnTime: 0, throttle: 1, firing: false,
    day: 0,                          // days since TMI
    tcmDone: false, tcmDv: 0,
    failReason: null,
  };
}

export function shipMass(s) { return s.prop.dry + s.payload + s.shipProp; }
export function dvRequired(s) { return s.transfer.tmiDv; }
/** Delta-v still available (m/s) keeping the landing reserve. */
export function dvAvailable(s) {
  const mf = s.prop.dry + s.payload + LANDING_RESERVE_KG;
  const m0 = shipMass(s);
  return m0 > mf ? s.prop.isp * G0 * Math.log(m0 / mf) : 0;
}

/** Corridor error at Mars (deg of entry flight-path angle) from a burn residual (m/s). */
export function corridorError(dvResidual) { return Math.max(-6, Math.min(6, dvResidual * 0.08)); }

export function selectTransfer(s, cell) { if (s.mode === 'select' && cell) s.transfer = cell; return s; }

/** controls: { ignite, cutoff, throttle, autoCutoff, tcm } ; dt real sim seconds during burn, or days via warp in coast */
export function stepCruise(s, dt, c = {}) {
  if (s.mode === 'select') {
    if (c.ignite) {
      const need = propForDv(dvRequired(s), s.prop.isp, s.prop.dry + s.payload + LANDING_RESERVE_KG);
      s.mode = 'burn'; s.firing = true;
      s.propMargin = s.shipProp - need;
    }
    return s;
  }
  if (s.mode === 'burn') {
    if (c.cutoff) s.firing = false;
    if (c.ignite && s.dvDone < dvRequired(s)) s.firing = true;
    s.throttle = Math.max(s.prop.throttleMin, Math.min(1, c.throttle ?? s.throttle));
    if (s.firing) {
      const sub = Math.max(1, Math.ceil(dt / 0.02)), h = dt / sub;
      for (let i = 0; i < sub && s.firing; i++) {
        const m = shipMass(s);
        const md = s.prop.mdot * s.throttle;
        if (s.shipProp <= 0) { s.firing = false; break; }
        s.dvDone += s.prop.F * s.throttle / m * h;
        s.shipProp -= md * h; s.burnTime += h;
        if (c.autoCutoff !== false && s.dvDone >= dvRequired(s)) s.firing = false;
      }
    }
    if (!s.firing && s.dvDone > 0) {
      const req = dvRequired(s);
      const res = s.dvDone - req;
      if (s.dvDone < 0.9 * req) {
        // a short cutoff just pauses the burn; running dry this early ends the mission
        if (s.shipProp <= 0) { s.mode = 'failed'; s.failReason = `TMI underburn: ${(-res).toFixed(0)} m/s short, no Mars encounter`; }
        return s;
      }
      if (c.cutoff || c.autoCutoff !== false || s.shipProp <= 0 || s.dvDone >= req) {
        s.residual = res; s.corridorErrDeg = corridorError(res);
        s.mode = 'coast';
      }
    }
    return s;
  }
  if (s.mode === 'coast') {
    if (c.tcm && !s.tcmDone) {
      const dv = Math.abs(s.residual) * 0.6 + 0.5;          // correction partly absorbed by leverage
      const m = shipMass(s);
      const used = m * (1 - Math.exp(-dv / (s.prop.isp * G0)));
      s.shipProp -= used; s.tcmDv = dv; s.tcmDone = true; s.corridorErrDeg = 0;
    }
    s.day += dt / DAY;
    if (s.day >= s.transfer.tofDays) { s.day = s.transfer.tofDays; s.mode = 'arrived'; }
  }
  return s;
}

export function cruiseResult(s) {
  return {
    success: s.mode === 'arrived',
    entrySpeed: s.transfer.entrySpeed, vinfArr: s.transfer.vinfArr, tofDays: s.transfer.tofDays,
    jdDep: s.transfer.jdDep, c3: s.transfer.c3,
    residual: s.residual ?? 0, corridorErrDeg: s.corridorErrDeg ?? 0, tcm: s.tcmDone,
    shipPropKg: Math.max(0, s.shipProp), failReason: s.failReason,
  };
}

// --- heliocentric path for the cruise display --------------------------------
/** Two-body RK4 propagation from r0 (km) v0 (km/s) for tofDays; returns [x,y] samples. */
export function propagateHelio(r0, v0, tofDays, n = 160) {
  const pts = [];
  let r = r0.slice(), v = v0.slice();
  const acc = (p) => { const d = Math.hypot(p[0], p[1], p[2]); const k = -MU_SUN / (d * d * d); return [k * p[0], k * p[1], k * p[2]]; };
  const steps = n * 8, h = tofDays * DAY / steps;
  for (let i = 0; i <= steps; i++) {
    if (i % 8 === 0) pts.push([r[0] / AU, r[1] / AU]);
    const a1 = acc(r);
    const r2 = r.map((x, k) => x + v[k] * h / 2), v2 = v.map((x, k) => x + a1[k] * h / 2);
    const a2 = acc(r2);
    const r3 = r.map((x, k) => x + v2[k] * h / 2), v3 = v.map((x, k) => x + a2[k] * h / 2);
    const a3 = acc(r3);
    const r4 = r.map((x, k) => x + v3[k] * h), v4 = v.map((x, k) => x + a3[k] * h);
    const a4 = acc(r4);
    r = r.map((x, k) => x + h / 6 * (v[k] + 2 * v2[k] + 2 * v3[k] + v4[k]));
    v = v.map((x, k) => x + h / 6 * (a1[k] + 2 * a2[k] + 2 * a3[k] + a4[k]));
  }
  return pts;
}
