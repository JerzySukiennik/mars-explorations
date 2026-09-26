// Starship atmospheric entry / aerocapture / aerobraking dynamics.
// Pure ES module (node + browser).
//
// Point-mass, planar (orbit-plane) 3-DOF entry in an inertial frame with a
// co-rotating atmosphere. The in-plane component of the planet's spin,
// omega*cos(i), is carried exactly; the vehicle's lateral (out-of-plane)
// motion from banking is assumed cancelled by bank reversals, so only the
// in-plane lift component L*cos(bank) acts on the trajectory.
//
//   r'' = -mu r/|r|^3 + (D + L cos(bank))/m      (inertial)
//   v_rel = v - omega x r                          (air-relative velocity)
//   D along -v_rel, L perpendicular to v_rel, up side
//
// Aerodynamic coefficients come from src/physics/aero.js (crossflow +
// Newtonian model of the belly-first ship) as functions of angle of attack,
// Mach and Reynolds number. The atmosphere is US-1976 on Earth
// (src/physics/earth_atmosphere.js) and the derived Mars model
// (src/physics/mars_atmosphere.js).
//
// Guidance (Earth / Mars entry): "no-skip" altitude-rate guidance. Once the
// ship feels the atmosphere (drag > 0.05 g) the bank angle sets the vertical
// lift so that the altitude rate is damped to zero:
//   L cos(bank)/m = g - v_t^2/r + D sin(g)/m - k hdot,  k = 2 zeta omega,
// with omega^2 = (L/m)/H the natural frequency of the altitude oscillation of
// a lifting vehicle in an exponential atmosphere (scale height H) and
// zeta = 0.7. The pull-out therefore ends in a constant-altitude plateau
// (bank ~40-50 deg) that lasts until the required lift exceeds what the ship
// has; from then on it flies lift-up, descending along the equilibrium glide.
// Angle of attack follows a Mach schedule: ~62 deg hypersonic, pitching up to
// the ~88 deg belly-flop between Mach 5 and Mach 1.
// Aerocapture (Mars): numerical predictor-corrector (Apollo / MSL / FNPEG
// family) solving each cycle for the constant bank whose predicted exit orbit
// has the target apoapsis. Aerobraking: a lift-neutral pass through the upper
// atmosphere, reporting delta-v, peak heating and dynamic pressure.
//
// Convective stagnation heating: Sutton & Graves (1971),
//   q = k sqrt(rho / Rn) V^3, k = 1.7415e-4 (Earth air), 1.9027e-4 (Mars CO2).

import { earthAtmosphere } from './earth_atmosphere.js';
import { createAtmosphere, GM_MARS, R_MARS } from './mars_atmosphere.js';
import { coefficients, viscosity, STARSHIP_GEOM, refArea } from './aero.js';

export const DEG = Math.PI / 180;
export const SUTTON_GRAVES_K = Object.freeze({ earth: 1.7415e-4, mars: 1.9027e-4 });

/** Sutton-Graves convective stagnation-point heat flux (W/m^2). */
export function stagnationHeatFlux(rho, v, rn = STARSHIP_GEOM.noseRadius, body = 'mars') {
  const k = typeof body === 'number' ? body : SUTTON_GRAVES_K[body] ?? SUTTON_GRAVES_K.mars;
  return k * Math.sqrt(Math.max(0, rho) / rn) * v * v * v;
}
export const heatFlux = stagnationHeatFlux;

let _marsAtm = null;
const marsAtm = () => (_marsAtm ??= createAtmosphere());

export const EARTH = Object.freeze({
  name: 'earth',
  mu: 3.986004418e14,
  R: 6371.0e3,              // mean radius (HUD altitude is above the local surface)
  omega: 7.2921159e-5,
  gamma: 1.4,
  gas: 'air',
  atm(z) { return earthAtmosphere(Math.max(z, -1000)); },
});

export const MARS = Object.freeze({
  name: 'mars',
  mu: GM_MARS,
  R: R_MARS,
  omega: 7.088218e-5,
  gamma: 1.29,
  gas: 'co2',
  atm(z) {
    const A = marsAtm();
    if (z <= 190e3) return A.state(Math.max(z, -1000));
    const s = A.state(190e3); const f = Math.exp(-(z - 190e3) / 12e3);
    return { ...s, p: s.p * f, rho: s.rho * f };
  },
});

export const PLANETS = Object.freeze({ earth: EARTH, mars: MARS });

/** Starship Block 1 (Ship 30) in entry configuration. */
export const STARSHIP_ENTRY = Object.freeze({
  mass: 150e3,              // kg: ~120 t dry (Block 1 ship + TPS) + ~30 t landing propellant in the header tanks
  geom: STARSHIP_GEOM,
  alphaHyp: 62 * DEG,       // hypersonic trim angle of attack (belly-first; Starship flies ~60-70 deg). L/D ~0.5 here.
  alphaSub: 88 * DEG,       // subsonic belly-flop attitude
  noseRadius: STARSHIP_GEOM.noseRadius,
});

/** Angle-of-attack schedule vs Mach. */
export function alphaSchedule(M, veh = STARSHIP_ENTRY) {
  // Hold the hypersonic attitude to M ~ 5, then pitch toward the belly-flop by M ~ 1.
  const f = M >= 5 ? 0 : M <= 1 ? 1 : (5 - M) / 4;
  return veh.alphaHyp + (veh.alphaSub - veh.alphaHyp) * f;
}

/**
 * Effective ratio of specific heats in the shock layer (equilibrium real gas).
 * Above ~2 km/s vibrational excitation and then O2 (N2 / CO2) dissociation
 * soak up energy: the normal-shock density ratio eps rises from the perfect-gas
 * limit (g+1)/(g-1) (6 for air) to ~15 at 7.5 km/s (equilibrium-air normal
 * shock tables, e.g. Anderson, Hypersonic and High-Temperature Gas Dynamics,
 * ch. 14; Mars CO2 dissociates earlier and reaches ~17-19). The Newtonian
 * stagnation pressure uses gamma_eff = (eps+1)/(eps-1).
 */
export function shockLayerGamma(planet, v) {
  const g = planet.gamma;
  const eps0 = (g + 1) / (g - 1);
  const epsHi = planet.gas === 'co2' ? 18 : 15;
  const f = Math.max(0, Math.min(1, (v - 2000) / 5500));
  const eps = eps0 + (epsHi - eps0) * f;
  return (eps + 1) / (eps - 1);
}

/** Air-data and aerodynamic accelerations at altitude h (m) and air-relative speed v (m/s). */
export function aeroState(planet, veh, h, v, alpha) {
  const s = planet.atm(h);
  const M = v / s.a;
  const Re1 = s.rho * v / viscosity(s.T, planet.gas);
  const c = coefficients(alpha, M, Re1, { geom: veh.geom, g: shockLayerGamma(planet, v), flap: veh.flap ?? 0 });
  const q = 0.5 * s.rho * v * v;
  const A = refArea(veh.geom);
  return { ...s, M, q, CL: c.CL, CD: c.CD, LD: c.LD, drag: q * c.CD * A / veh.mass, lift: q * c.CL * A / veh.mass };
}

/**
 * State helpers. Internal state: [x, y, vx, vy] inertial, planet centre origin,
 * motion counter-clockwise (prograde with the in-plane spin omegaEff).
 */
export function makeState(planet, { h, v, gammaDeg = 0, theta = 0 }, omegaEff) {
  const r = planet.R + h;
  const gam = gammaDeg * DEG;
  const vr = v * Math.sin(gam), vt = v * Math.cos(gam) + omegaEff * r;
  const c = Math.cos(theta), s = Math.sin(theta);
  return [r * c, r * s, vr * c - vt * s, vr * s + vt * c];
}

export function describe(planet, st, omegaEff) {
  const [x, y, vx, vy] = st;
  const r = Math.hypot(x, y);
  const ux = x / r, uy = y / r;
  const wx = vx + omegaEff * y, wy = vy - omegaEff * x;   // v - omega x r
  const v = Math.hypot(wx, wy);
  const vr = wx * ux + wy * uy, vt = -wx * uy + wy * ux;
  return { r, h: r - planet.R, v, vr, vt, gamma: Math.atan2(vr, vt), theta: Math.atan2(y, x), wx, wy, ux, uy };
}

function deriv(planet, veh, st, bank, alpha, omegaEff) {
  const d = describe(planet, st, omegaEff);
  const g = planet.mu / (d.r * d.r);
  let ax = -g * d.ux, ay = -g * d.uy;
  let aero = null;
  if (d.v > 1 && d.h < 400e3) {
    aero = aeroState(planet, veh, d.h, d.v, alpha);
    const ex = d.wx / d.v, ey = d.wy / d.v;
    // lift direction: v_rel rotated +90 deg (counter-clockwise flight => toward +r side)
    let nx = -ey, ny = ex;
    if (nx * d.ux + ny * d.uy < 0) { nx = -nx; ny = -ny; }
    const Lc = aero.lift * Math.cos(bank);
    ax += -aero.drag * ex + Lc * nx;
    ay += -aero.drag * ey + Lc * ny;
  }
  return { ds: [st[2], st[3], ax, ay], d, aero, g };
}

function rk4(planet, veh, st, dt, bank, alpha, w) {
  const k1 = deriv(planet, veh, st, bank, alpha, w).ds;
  const s2 = st.map((v, i) => v + 0.5 * dt * k1[i]);
  const k2 = deriv(planet, veh, s2, bank, alpha, w).ds;
  const s3 = st.map((v, i) => v + 0.5 * dt * k2[i]);
  const k3 = deriv(planet, veh, s3, bank, alpha, w).ds;
  const s4 = st.map((v, i) => v + dt * k3[i]);
  const k4 = deriv(planet, veh, s4, bank, alpha, w).ds;
  return st.map((v, i) => v + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

/** Ground (surface) range angle travelled, rad: inertial angle minus planet rotation. */
const groundAngle = (theta0, theta, t, w) => theta - theta0 - w * t;

/**
 * Integrate an entry.
 * opts: planet, vehicle, inclinationDeg, init {t, h, v, gammaDeg},
 *       guidance(ctx) -> {bank, alpha} (rad), dt, tMax, stop(ctx) -> bool
 * Returns { samples: [{t,h,v,gamma,range,M,q,decel,heat,bank,alpha}], ... }.
 */
export function simulateEntry(opts = {}) {
  const planet = opts.planet ?? EARTH;
  const veh = { ...STARSHIP_ENTRY, ...(opts.vehicle ?? {}) };
  const w = planet.omega * Math.cos((opts.inclinationDeg ?? 0) * DEG);
  const dt = opts.dt ?? 0.5;
  const init = opts.init;
  let st = makeState(planet, init, w);
  let t = init.t ?? 0;
  const t0 = t;
  const theta0 = 0;
  let thetaUnwrapped = 0, lastTheta = 0;
  const guidance = opts.guidance ?? ((c) => ({ bank: 0, alpha: alphaSchedule(c.M ?? 30, veh) }));
  const samples = [];
  let heatLoad = 0;
  const tMax = opts.tMax ?? t0 + 5000;
  let cmd = { bank: 0, alpha: veh.alphaHyp };
  for (;;) {
    const d = describe(planet, st, w);
    let dth = d.theta - lastTheta;
    if (dth < -Math.PI) dth += 2 * Math.PI;
    if (dth > Math.PI) dth -= 2 * Math.PI;
    thetaUnwrapped += dth; lastTheta = d.theta;
    const range = groundAngle(theta0, thetaUnwrapped, t - t0, w) * planet.R;
    const a = aeroState(planet, veh, d.h, d.v, cmd.alpha);
    const heat = stagnationHeatFlux(a.rho, d.v, veh.noseRadius, planet.name);
    const ctx = { t, h: d.h, v: d.v, gamma: d.gamma, range, M: a.M, q: a.q, rho: a.rho,
      decel: Math.hypot(a.drag, a.lift) , drag: a.drag, LD: a.LD, heat, st, planet, veh, w, t0, heatLoad };
    cmd = guidance(ctx) ?? cmd;
    samples.push({ t, h: d.h, v: d.v, gamma: d.gamma, range, M: a.M, q: a.q, decel: a.drag,
      aeroAccel: Math.hypot(a.drag, a.lift), heat, bank: cmd.bank, alpha: cmd.alpha, LD: a.LD });
    if (t >= tMax || d.h < (opts.hMin ?? 0) || (opts.stop && opts.stop(ctx))) break;
    st = rk4(planet, veh, st, dt, cmd.bank, cmd.alpha, w);
    heatLoad += heat * dt;
    t += dt;
  }
  return { samples, heatLoad, vehicle: veh, planet };
}

/** Local density scale height (m). */
export function scaleHeight(planet, h) {
  const a = planet.atm(h - 500).rho, b = planet.atm(h + 500).rho;
  return a > 0 && b > 0 ? 1000 / Math.log(a / b) : 7000;
}

/**
 * No-skip altitude-rate guidance (see header). Returns a guidance(ctx) function.
 * opts: zeta (damping), activation (drag, m/s^2, at which bank control starts),
 *       hdotRef(ctx) (m/s, default 0 = hold altitude).
 */
export function altitudeRateGuidance(opts = {}) {
  const zeta = opts.zeta ?? 0.7;
  const act = opts.activation ?? 0.05 * 9.80665;
  const aMod = opts.alphaMin != null;              // angle-of-attack modulation enabled
  const aMax = opts.alphaMax ?? null, aMin = opts.alphaMin ?? null;
  const pitchRate = (opts.pitchRateDeg ?? 1) * DEG;  // rad/s, body-flap limited
  let aHyp = null, tLast = null;
  return (c) => {
    const hi = aMax ?? c.veh.alphaHyp;
    if (aHyp == null) aHyp = hi;
    const dt = tLast == null ? 0 : c.t - tLast; tLast = c.t;
    const sched = (ah) => alphaSchedule(c.M, { ...c.veh, alphaHyp: ah });
    if (c.drag < act) return { bank: 0, alpha: sched(aHyp) };
    const r = c.planet.R + c.h;
    const vt = c.v * Math.cos(c.gamma) + c.w * r;          // inertial horizontal speed
    const g = c.planet.mu / (r * r);
    const hdot = c.v * Math.sin(c.gamma);
    const href = opts.hdotRef ? opts.hdotRef(c) : 0;
    const liftAt = (a) => {
      const s = aeroState(c.planet, c.veh, c.h, c.v, sched(a));
      return { lift: Math.max(s.lift, 1e-4), drag: s.drag };
    };
    const needAt = (ls) => {
      const k = 2 * zeta * Math.sqrt(ls.lift / scaleHeight(c.planet, c.h));
      return (g - vt * vt / r + ls.drag * Math.sin(c.gamma) - k * (hdot - href)) / Math.cos(c.gamma);
    };
    let target = hi;
    if (aMod) {
      // Lift saturated at the current attitude: pitch down (less drag, more L/D)
      // before giving up altitude; pitch back up while bank margin remains.
      const cur = liftAt(aHyp);
      const ratio = needAt(cur) / cur.lift;
      if (ratio > 1) target = aMin;
      else if (ratio < (opts.pitchUpMargin ?? 0.9)) target = hi;
      else target = aHyp;
    }
    const step = pitchRate * dt;
    aHyp += Math.max(-step, Math.min(step, target - aHyp));
    const ls = liftAt(aHyp);
    const cb = Math.max(opts.cosMin ?? -1, Math.min(1, needAt(ls) / ls.lift));
    return { bank: Math.acos(cb), alpha: sched(aHyp) };
  };
}

/** Keplerian apoapsis altitude (m) of an inertial state; Infinity if hyperbolic. */
export function apoapsisAltitude(planet, st) {
  const [x, y, vx, vy] = st;
  const r = Math.hypot(x, y), v2 = vx * vx + vy * vy;
  const eps = v2 / 2 - planet.mu / r;
  if (eps >= 0) return Infinity;
  const a = -planet.mu / (2 * eps);
  const hmom = x * vy - y * vx;
  const e = Math.sqrt(Math.max(0, 1 - hmom * hmom / (planet.mu * a)));
  return a * (1 + e) - planet.R;
}

/**
 * Fly one pass through the atmosphere at constant bank until atmospheric exit
 * (h > hExit climbing) or the ground. Used by aerocapture prediction and
 * aerobraking. Returns { exit, apoapsis, samples, heatLoad, dv }.
 */
export function atmosphericPass({ planet = MARS, vehicle, inclinationDeg = 0, init, bankDeg = 0, hExit = 130e3, dt = 1, guidance } = {}) {
  const w = planet.omega * Math.cos(inclinationDeg * DEG);
  const veh = { ...STARSHIP_ENTRY, ...(vehicle ?? {}) };
  let last = null;
  const res = simulateEntry({
    planet, vehicle: veh, inclinationDeg, init, dt, hMin: 0, tMax: (init.t ?? 0) + 4000,
    guidance: guidance ?? ((c) => ({ bank: bankDeg * DEG, alpha: alphaSchedule(c.M, c.veh) })),
    stop: (c) => { last = c; return c.gamma > 0 && c.h > hExit; },
  });
  const s = res.samples;
  const exit = s.at(-1).h > hExit;
  const apo = exit ? apoapsisAltitude(planet, last.st) : -Infinity;
  const vIn = s[0].v, vOut = s.at(-1).v;
  return { exit, apoapsis: apo, samples: s, heatLoad: res.heatLoad, dv: vIn - vOut,
    peakHeat: Math.max(...s.map((q) => q.heat)), peakDecel: Math.max(...s.map((q) => q.aeroAccel)), peakQ: Math.max(...s.map((q) => q.q)), w };
}

/**
 * Aerocapture predictor-corrector: returns guidance(ctx) that every `cycle`
 * seconds re-solves (secant on cos(bank)) for the constant bank whose
 * predicted exit apoapsis equals targetApoapsis (m).
 */
export function aerocaptureGuidance({ targetApoapsis, cycle = 10, inclinationDeg = 0 } = {}) {
  let cb = 0.3, tNext = -Infinity;
  const predict = (c, cosb) => {
    const d = describe(c.planet, c.st, c.w);
    const p = atmosphericPass({ planet: c.planet, vehicle: c.veh, inclinationDeg, dt: 2,
      init: { t: c.t, h: d.h, v: d.v, gammaDeg: d.gamma / DEG }, bankDeg: Math.acos(Math.max(-1, Math.min(1, cosb))) / DEG });
    return p.exit ? p.apoapsis : -1e7;
  };
  return (c) => {
    const alpha = alphaSchedule(c.M, c.veh);
    if (c.t >= tNext && c.h < 200e3) {
      tNext = c.t + cycle;
      let x0 = Math.max(-1, cb - 0.2), x1 = Math.min(1, cb + 0.2);
      let f0 = predict(c, x0) - targetApoapsis, f1 = predict(c, x1) - targetApoapsis;
      for (let i = 0; i < 8 && Math.abs(f1) > 5e3 && f1 !== f0; i++) {
        const x2 = Math.max(-1, Math.min(1, x1 - f1 * (x1 - x0) / (f1 - f0)));
        x0 = x1; f0 = f1; x1 = x2; f1 = predict(c, x1) - targetApoapsis;
      }
      cb = x1;
    }
    return { bank: Math.acos(Math.max(-1, Math.min(1, cb))), alpha };
  };
}

/** Linear interpolation of a sample series at time t. */
export function sampleAt(samples, t, key) {
  if (t <= samples[0].t) return samples[0][key];
  const n = samples.length;
  if (t >= samples[n - 1].t) return samples[n - 1][key];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (samples[m].t <= t) lo = m; else hi = m; }
  const f = (t - samples[lo].t) / (samples[hi].t - samples[lo].t);
  return samples[lo][key] + f * (samples[hi][key] - samples[lo][key]);
}
