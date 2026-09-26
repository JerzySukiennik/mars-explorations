// Mars atmospheric entry of Starship (planar, lifting, bank-angle modulated).
//
// Pure ES module. Atmosphere density comes from src/physics/mars_atmosphere.js
// (`A`, feature-detected: density(zMeters) or createAtmosphere().density) and
// gravity from src/physics/mars_body.js (`B`). If src/physics/entry.js exists
// (`X`), its heating / aero functions are used when recognised.
//
//   dh/dt = v sin(g)
//   dv/dt = -D/m - gr sin(g)
//   dg/dt = (L cos(bank))/(m v) - (gr/v - v/r) cos(g)
//   ds/dt = v cos(g) Rm / r
// Stagnation heating: Sutton-Graves, Mars CO2 constant k = 1.9027e-4 (SI).

export const DEFAULT_VEH = Object.freeze({
  mass: 200e3,            // kg: dry 100 t + payload 100 t (header-tank reserve inside dry margin)
  area: 9 * 50,           // m^2: belly-first planform
  cd: 1.3,                // hypersonic, ~60-70 deg angle of attack
  lod: 0.30,              // lift-to-drag at that attitude
  noseRadius: 4.5,        // m, effective radius of the windward curvature
});

export const LIMITS = Object.freeze({
  gFail: 6.0, gWarn: 4.0,                 // Earth g: crew / cargo structural
  heatFail: 900e3, heatWarn: 600e3,       // W/m^2 stagnation convective on the tiles
  eiAlt: 125e3,
  handoffAlt: 8e3, handoffSpeed: 650,    // hand over to the landing phase
});

const MU_M = 4.282837e13, R_M = 3389.5e3;

/** Fallback density: two-scale exponential fitted to MCD mean values. */
function fallbackDensity(z) {
  return 0.020 * Math.exp(-Math.max(0, z) / 11100);
}

export function densityFn(A) {
  if (A) {
    if (typeof A.density === 'function') return (z) => Math.max(0, A.density(Math.min(z, 130e3))) * (z > 130e3 ? Math.exp(-(z - 130e3) / 9000) : 1);
    if (A.DEFAULT_ATMOSPHERE?.density) return (z) => A.DEFAULT_ATMOSPHERE.density(Math.min(z, 130e3));
  }
  return fallbackDensity;
}

export function suttonGraves(rho, v, rn) { return 1.9027e-4 * Math.sqrt(Math.max(0, rho) / rn) * v * v * v; }

export function createEntry(opts = {}) {
  const B = opts.B?.MARS;
  const mu = B?.mu ?? MU_M, R = B?.rMean ?? R_M;
  const veh = { ...DEFAULT_VEH, ...(opts.vehicle || {}) };
  const heat = typeof opts.X?.stagnationHeatFlux === 'function' ? (rho, v) => opts.X.stagnationHeatFlux(rho, v, veh.noseRadius)
    : typeof opts.X?.heatFlux === 'function' ? (rho, v) => opts.X.heatFlux(rho, v, veh.noseRadius)
    : (rho, v) => suttonGraves(rho, v, veh.noseRadius);
  return {
    mu, R, veh, rho: densityFn(opts.A), heat,
    h: LIMITS.eiAlt, v: opts.entrySpeed ?? 5600, gamma: (opts.gammaDeg ?? -11) * Math.PI / 180,
    gammaDeg0: opts.gammaDeg ?? -11,
    s: 0, t: 0, bank: (opts.bankDeg ?? 60) * Math.PI / 180,
    g: 0, q: 0, qdyn: 0, peakG: 0, peakQ: 0, heatLoad: 0,
    mode: 'pre',          // pre | flying | handoff | failed
    failReason: null,
    targetRangeKm: opts.targetRangeKm ?? null,
    rising: false, minH: LIMITS.eiAlt,
  };
}

/** One step. controls: { bankDeg (target), start } */
export function stepEntry(s, dt, c = {}) {
  if (s.mode === 'pre') { if (c.start) s.mode = 'flying'; else return s; }
  if (s.mode !== 'flying') return s;
  const sub = Math.max(1, Math.ceil(dt / 0.05)), h = dt / sub;
  for (let i = 0; i < sub && s.mode === 'flying'; i++) {
    if (c.bankDeg != null) {
      // bank reversals are rate limited (RCS + flaps): 15 deg/s
      const tgt = c.bankDeg * Math.PI / 180, max = 15 * Math.PI / 180 * h;
      s.bank += Math.max(-max, Math.min(max, tgt - s.bank));
    }
    const r = s.R + s.h;
    const gr = s.mu / (r * r);
    const rho = s.rho(s.h);
    const qd = 0.5 * rho * s.v * s.v;
    const D = qd * s.veh.cd * s.veh.area, L = D * s.veh.lod;
    const m = s.veh.mass;
    const dv = -D / m - gr * Math.sin(s.gamma);
    const dg = (L * Math.cos(s.bank)) / (m * s.v) - (gr / s.v - s.v / r) * Math.cos(s.gamma);
    s.v += dv * h; s.gamma += dg * h;
    s.h += s.v * Math.sin(s.gamma) * h;
    s.s += s.v * Math.cos(s.gamma) * s.R / r * h;
    s.t += h;
    s.qdyn = qd;
    s.g = Math.hypot(L, D) / m / 9.80665;
    s.q = s.heat(rho, s.v);
    s.heatLoad += s.q * h;
    s.peakG = Math.max(s.peakG, s.g); s.peakQ = Math.max(s.peakQ, s.q);
    s.minH = Math.min(s.minH, s.h);
    if (s.g > LIMITS.gFail) { s.mode = 'failed'; s.failReason = `Structural limit: ${s.g.toFixed(1)} g (corridor too steep)`; }
    else if (s.q > LIMITS.heatFail) { s.mode = 'failed'; s.failReason = `TPS overheated: ${(s.q / 1e3).toFixed(0)} kW/m^2 (corridor too steep)`; }
    else if (s.h > LIMITS.eiAlt + 5e3 && s.gamma > 0) {
      s.mode = 'failed';
      s.failReason = s.v > Math.sqrt(2 * s.mu / r) ? 'Skipped out of the atmosphere (corridor too shallow): lost to heliocentric space' : 'Skipped out (corridor too shallow): uncontrolled re-entry';
    } else if (s.h <= LIMITS.handoffAlt || (s.v < LIMITS.handoffSpeed && s.h < 30e3)) {
      s.mode = 'handoff';
    } else if (s.h <= 0) { s.mode = 'failed'; s.failReason = 'Impacted the surface'; }
  }
  return s;
}

/** Run a whole entry at constant bank (used for the target range and for tests). */
export function simulateEntry(opts, bankDeg = opts.bankDeg ?? 60, dt = 0.25) {
  const s = createEntry({ ...opts, bankDeg });
  stepEntry(s, 0, { start: true });
  for (let i = 0; i < 40000 && s.mode === 'flying'; i++) stepEntry(s, dt, { bankDeg });
  return s;
}

export function entryResult(s) {
  const missKm = s.targetRangeKm != null ? s.s / 1e3 - s.targetRangeKm : 0;
  return {
    success: s.mode === 'handoff',
    altitude: s.h, speed: s.v, gammaDeg: s.gamma * 180 / Math.PI,
    rangeKm: s.s / 1e3, missKm,
    peakG: s.peakG, peakHeatKW: s.peakQ / 1e3, heatLoadMJ: s.heatLoad / 1e6,
    failReason: s.failReason,
  };
}
