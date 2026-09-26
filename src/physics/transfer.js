// Earth -> Mars ballistic transfers, patched conics.
// Heliocentric leg: Lambert arc between Standish ephemeris states. Departure:
// impulsive burn from a circular parking orbit onto the departure hyperbola
// (v_inf^2 = C3). Arrival: hyperbolic approach to the Mars entry interface.
// Pure ES module. Units: km, km/s, days.
import { MU_SUN, AU_KM, DAY_S, planetState, siderealPeriodDays, julianDate, elements, STANDISH } from './ephemeris.js';
import { lambert, vec } from './lambert.js';
import { MARS, EARTH } from './mars_body.js';

export const MU_EARTH = EARTH.mu / 1e9;      // km^3/s^2
export const R_EARTH = EARTH.rEq / 1e3;      // km
export const MU_MARS = MARS.mu / 1e9;
export const R_MARS = MARS.rEq / 1e3;
export const MARS_EI_ALT_KM = 125;
export const LEO_ALT_KM = 200;

/** Delta-v to go from circular orbit radius r to hyperbolic excess speed vinf. */
export function injectionDv(vinf, mu = MU_EARTH, r = R_EARTH + LEO_ALT_KM) {
  return Math.sqrt(vinf * vinf + 2 * mu / r) - Math.sqrt(mu / r);
}

/** Speed at radius r on a hyperbola with excess speed vinf (energy conservation). */
export function hyperbolicSpeed(vinf, mu, r) { return Math.sqrt(vinf * vinf + 2 * mu / r); }

/** Idealised circular-coplanar Hohmann transfer between the planets' mean semi-major axes. */
export function hohmann(from = 'earth', to = 'mars', leoAltKm = LEO_ALT_KM) {
  const r1 = STANDISH[from].el[0] * AU_KM, r2 = STANDISH[to].el[0] * AU_KM;
  const a = (r1 + r2) / 2;
  const vp = Math.sqrt(MU_SUN * (2 / r1 - 1 / a)), va = Math.sqrt(MU_SUN * (2 / r2 - 1 / a));
  const vinfDep = vp - Math.sqrt(MU_SUN / r1), vinfArr = Math.sqrt(MU_SUN / r2) - va;
  return {
    a, vinfDep, vinfArr, c3: vinfDep * vinfDep,
    tofDays: Math.PI * Math.sqrt(a * a * a / MU_SUN) / DAY_S,
    leoDv: injectionDv(vinfDep, MU_EARTH, R_EARTH + leoAltKm),
  };
}

/** Synodic period of two planets (days) from their sidereal mean motions. */
export function synodicPeriodDays(p1 = 'earth', p2 = 'mars') {
  const T1 = siderealPeriodDays(p1), T2 = siderealPeriodDays(p2);
  return 1 / Math.abs(1 / T1 - 1 / T2);
}

/** Evaluate one ballistic Earth->Mars trajectory. Returns null if Lambert fails. */
export function evalTransfer(jdDep, tofDays) {
  const E = planetState('earth', jdDep), M = planetState('mars', jdDep + tofDays);
  const s = lambert(E.r, M.r, tofDays * DAY_S, MU_SUN, { prograde: true });
  if (!s) return null;
  const vinfDepV = vec.sub(s.v1, E.v), vinfArrV = vec.sub(s.v2, M.v);
  const vinfDep = vec.norm(vinfDepV), vinfArr = vec.norm(vinfArrV);
  return {
    jdDep, jdArr: jdDep + tofDays, tofDays, type: s.theta < Math.PI ? 'I' : 'II',
    c3: vinfDep * vinfDep, vinfDep, vinfArr, vinfDepV, vinfArrV,
    transferAngleDeg: s.theta * 180 / Math.PI,
  };
}

/** Heliocentric phase angle of Mars ahead of Earth (rad, in (-pi, pi]). */
export function phaseAngle(jd) {
  const e = elements('earth', jd), m = elements('mars', jd);
  const d = m.L - e.L;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/**
 * Find the launch opportunity nearest the given year: the date when Mars leads
 * Earth by the Hohmann phase angle (mean motion), searched between Nov of the
 * previous year and Mar of the following year.
 */
export function opportunityCentre(year) {
  const h = hohmann();
  const nM = 2 * Math.PI / siderealPeriodDays('mars');
  const target = Math.PI - nM * h.tofDays;             // Mars lead angle at departure
  const f = (jd) => { const d = phaseAngle(jd) - target; return Math.atan2(Math.sin(d), Math.cos(d)); };
  const j0 = julianDate(year - 1, 11, 1), j1 = julianDate(year + 1, 3, 1);
  let prev = f(j0);
  for (let j = j0 + 1; j <= j1; j += 1) {
    const cur = f(j);
    if (prev > 0 && cur <= 0 && prev - cur < 1) {            // phase closing through target
      let a = j - 1, b = j;
      for (let k = 0; k < 40; k++) { const c = (a + b) / 2; if (f(c) > 0) a = c; else b = c; }
      return (a + b) / 2;
    }
    prev = cur;
  }
  return null;
}

function refine(fn, x, step, minStep) {
  // compass/pattern search in (dep, tof); robust on the flat C3 valley
  let best = fn(x[0], x[1]);
  while (step[0] > minStep) {
    let moved = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const c = [x[0] + dx * step[0], x[1] + dy * step[1]];
      const v = fn(c[0], c[1]);
      if (v < best) { best = v; x = c; moved = true; }
    }
    if (!moved) step = [step[0] / 2, step[1] / 2];
  }
  return x;
}

/**
 * Porkchop search for the minimum-C3 ballistic transfer of an opportunity.
 * @param {number} year opportunity year (departure near that year's Hohmann phasing)
 * @param {object} [opt] { depSpanDays=120, tofMin=100, tofMax=480, dDep=2, dTof=4, type }
 */
export function minC3Transfer(year, opt = {}) {
  const jc = opportunityCentre(year);
  if (jc == null) throw new Error(`no Earth-Mars opportunity near ${year}`);
  const span = opt.depSpanDays ?? 120, tofMin = opt.tofMin ?? 100, tofMax = opt.tofMax ?? 480;
  const dDep = opt.dDep ?? 2, dTof = opt.dTof ?? 4;
  const c3 = (jd, t) => {
    if (t < tofMin * 0.5) return Infinity;
    const r = evalTransfer(jd, t);
    if (!r || (opt.type && r.type !== opt.type)) return Infinity;
    return r.c3;
  };
  const grid = [];
  for (let d = -span; d <= span; d += dDep) {
    for (let t = tofMin; t <= tofMax; t += dTof) grid.push([jc + d, t, c3(jc + d, t)]);
  }
  grid.sort((a, b) => a[2] - b[2]);
  // refine the few best distinct basins, keep the global minimum
  const seeds = [];
  for (const g of grid) {
    if (!isFinite(g[2])) break;
    if (seeds.every((s) => Math.abs(s[0] - g[0]) > 15 || Math.abs(s[1] - g[1]) > 30)) seeds.push(g);
    if (seeds.length >= 4) break;
  }
  let best = null;
  for (const s of seeds) {
    const x = refine(c3, [s[0], s[1]], [dDep, dTof], 1e-4);
    const r = evalTransfer(x[0], x[1]);
    if (r && (!best || r.c3 < best.c3)) best = r;
  }
  best.opportunityCentreJd = jc;
  return best;
}

/** Full patched-conic summary of a transfer: TMI burn from LEO and Mars entry speed. */
export function transferSummary(tr, leoAltKm = LEO_ALT_KM, eiAltKm = MARS_EI_ALT_KM) {
  return {
    ...tr,
    leoTmiDv: injectionDv(tr.vinfDep, MU_EARTH, R_EARTH + leoAltKm),
    marsEntrySpeed: hyperbolicSpeed(tr.vinfArr, MU_MARS, R_MARS + eiAltKm),
  };
}
