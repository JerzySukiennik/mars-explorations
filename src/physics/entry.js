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
// Guidance: a numerical predictor-corrector (Apollo / MSL / FNPEG family).
// Every guidance cycle it integrates the remaining trajectory with the same
// dynamics for a trial bank magnitude and solves (secant) for the bank that
// makes the predicted downrange at the end of the hypersonic glide equal the
// distance to the target. Before the vehicle "feels" the atmosphere
// (drag < 0.05 g) it flies lift-up. Angle of attack follows a schedule:
// ~70 deg hypersonic, pitching up to the ~85-90 deg belly-flop subsonically.
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
  mass: 120e3,              // kg: ~100 t dry + ~20 t landing propellant in header tanks / residuals
  geom: STARSHIP_GEOM,
  alphaHyp: 70 * DEG,       // hypersonic angle of attack (belly-first)
  alphaSub: 88 * DEG,       // subsonic belly-flop attitude
  noseRadius: STARSHIP_GEOM.noseRadius,
});

/** Angle-of-attack schedule vs Mach. */
export function alphaSchedule(M, veh = STARSHIP_ENTRY) {
  // Hold the hypersonic attitude to M ~ 5, then pitch toward the belly-flop by M ~ 1.
  const f = M >= 5 ? 0 : M <= 1 ? 1 : (5 - M) / 4;
  return veh.alphaHyp + (veh.alphaSub - veh.alphaHyp) * f;
}

/** Air-data and aerodynamic accelerations at altitude h (m) and air-relative speed v (m/s). */
export function aeroState(planet, veh, h, v, alpha) {
  const s = planet.atm(h);
  const M = v / s.a;
  const Re1 = s.rho * v / viscosity(s.T, planet.gas);
  const c = coefficients(alpha, M, Re1, { geom: veh.geom, g: planet.gamma, flap: veh.flap ?? 0 });
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
