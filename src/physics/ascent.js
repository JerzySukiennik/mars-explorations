// Starship full-stack launch ascent from Starbase (pure ES module).
//
// 3-DOF point-mass integration in an Earth-centred inertial frame:
//   * Earth: WGS-84 ellipsoid for altitude, central gravity + J2, sidereal
//     rotation (the atmosphere co-rotates, so drag and the HUD speed use the
//     Earth-relative velocity v - w x r).
//   * Atmosphere: U.S. Standard Atmosphere 1976 (earth_atmosphere.js).
//   * Aerodynamics: Mach-dependent drag coefficient (slender nose-first
//     stack / ship, blunt tail-first booster on its way down), 9 m diameter
//     reference area.
//   * Propulsion: Raptor 2 / RVac thrust and mass flow from vehicle.js,
//     including the nozzle back-pressure loss F = F_vac - p_a * A_e.
//   * Guidance (guidance.js): vertical rise + pitch kick + gravity turn,
//     max-Q throttle bucket and acceleration cap, booster MECO on its
//     return-propellant reserve, hot staging, closed-loop ship insertion
//     guidance to the IFT-5 suborbital target orbit (SECO on perigee),
//     boostback on a predicted impact point, landing burn and divert to a
//     tower catch.
//
// Mission inputs are only vehicle/planet parameters, the launch site, the
// target orbit (-15 x 213 km, i = 26.2 deg, published for Flight 5) and the
// guidance design constants in FLIGHT_IFT5. The telemetry is integrated, not
// looked up.

import { ENGINES, BOOSTER, SHIP, thrust as engineThrust, massFlow } from './vehicle.js';
import { earthAtmosphere } from './earth_atmosphere.js';
import * as G from './guidance.js';

const { add, sub, scale, dot, cross, norm, unit } = G;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Earth
// ---------------------------------------------------------------------------
export const EARTH = Object.freeze({
  mu: 3.986004418e14,        // m^3/s^2 (WGS-84 / EGM96)
  J2: 1.08262668e-3,
  a: 6378137.0,              // equatorial radius (m)
  f: 1 / 298.257223563,
  omega: 7.292115e-5,        // rad/s, sidereal rotation
});
const B_EARTH = EARTH.a * (1 - EARTH.f);

/** Gravity acceleration with J2 (inertial, z = spin axis). */
export function gravity(r) {
  const [x, y, z] = r;
  const r2 = x * x + y * y + z * z;
  const rn = Math.sqrt(r2);
  const k = -EARTH.mu / (r2 * rn);
  const j = 1.5 * EARTH.J2 * (EARTH.a * EARTH.a) / r2;
  const z2 = (z * z) / r2;
  return [k * x * (1 + j * (1 - 5 * z2)), k * y * (1 + j * (1 - 5 * z2)), k * z * (1 + j * (3 - 5 * z2))];
}

/** Ellipsoid radius at the geocentric latitude of r (m). */
export function surfaceRadius(r) {
  const rn = norm(r);
  const s = r[2] / rn, c = Math.sqrt(Math.max(0, 1 - s * s));
  return (EARTH.a * B_EARTH) / Math.hypot(B_EARTH * c, EARTH.a * s);
}
/** Altitude above the ellipsoid (radial approximation, m). */
export const altitude = (r) => norm(r) - surfaceRadius(r);
/** Earth-relative (co-rotating) velocity. */
export const relVelocity = (r, v) => sub(v, cross([0, 0, EARTH.omega], r));
/** Rotate a vector about the spin axis by angle a. */
export function rotZ(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
}
/** Geodetic latitude/longitude/height -> Earth-fixed position. */
export function geodeticToEcef(latDeg, lonDeg, h = 0) {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  const e2 = EARTH.f * (2 - EARTH.f);
  const N = EARTH.a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  return [(N + h) * Math.cos(la) * Math.cos(lo), (N + h) * Math.cos(la) * Math.sin(lo), (N * (1 - e2) + h) * Math.sin(la)];
}

// Starbase orbital launch pad A (Boca Chica, Texas).
export const STARBASE = Object.freeze({ latDeg: 25.9969, lonDeg: -97.1572, h: 0 });

/** Launch azimuth (deg from north) that gives inclination incDeg, southeastward branch. */
export function launchAzimuth(latDeg, incDeg) {
  const s = Math.cos(incDeg * DEG) / Math.cos(latDeg * DEG);
  return 180 - Math.asin(Math.min(1, s)) / DEG;
}

// ---------------------------------------------------------------------------
// Aerodynamics
// ---------------------------------------------------------------------------
function interp(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return tab[tab.length - 1][1];
}
// Slender nose-first body (fineness ~13 stack, ~6 ship): subsonic skin
// friction + base drag, transonic wave-drag rise peaking just past Mach 1,
// supersonic decay (typical launch-vehicle axial-force curves).
export const CD_SLENDER = [[0, 0.30], [0.6, 0.30], [0.85, 0.36], [1.05, 0.55], [1.2, 0.52], [1.5, 0.45], [2, 0.38], [3, 0.30], [5, 0.26], [10, 0.25]];
// Booster descent, tail-first with grid fins deployed and flying at an angle
// of attack to glide toward the tower: EFFECTIVE axial drag coefficient on
// the 9 m reference area. Shape follows a blunt body (bluff subsonic value,
// rising toward the Newtonian plateau hypersonically); the magnitude
// (2.2-3.4, well above a bare base's ~1.2-1.8) is calibrated so that a
// ~480 t booster decelerates like a real Super Heavy re-entry; it lumps the
// four grid fins and cross-flow drag at angle of attack into one number.
export const CD_TAIL_FIRST = [[0, 2.2], [0.8, 2.4], [1.2, 2.6], [2.0, 2.6], [3.0, 3.2], [4, 3.4], [10, 3.4]];
export const REF_AREA = Math.PI * 4.5 ** 2; // 9 m diameter

// ---------------------------------------------------------------------------
// Flight definition (IFT-5: Booster 12 / Ship 30, Block 1, 13 Oct 2024)
// ---------------------------------------------------------------------------
export const FLIGHT_IFT5 = Object.freeze({
  name: 'Starship Flight 5 (B12 / S30)',
  site: STARBASE,
  // Published Flight 5 orbit: -15 x 213 km, i = 26.2 deg. The insertion altitude is
  // not published; propellant at SECO is flat (+/-1 t) for 110-160 km.
  targetOrbit: { perigeeKm: -15, apogeeKm: 213, incDeg: 26.2, insertionAltKm: 145 },
  booster: {
    dryMass: BOOSTER.dryMass,         // 275 t
    propMass: BOOSTER.propMass,       // 3400 t
    ringMass: 9e3,                    // hot-staging ring (jettisoned after boostback)
    engine: ENGINES.raptor2, nOuter: 20, nMiddle: 10, nCenter: 3,
    returnReserve: 0.16,             // fraction of load kept for boostback + landing
  },
  ship: {
    dryMass: SHIP.dryMass,            // 100 t
    propMass: 1200e3,                 // Block 1 ship propellant load
    sl: ENGINES.raptor2, nSl: 3, vac: ENGINES.raptor2Vac, nVac: 3,
  },
  timeline: {
    ignition: -3.0,                   // s, all 33 at full thrust (end of start sequence)
    release: 2.5,                     // s, clamp release
    hotStageDelay: 5.0,               // MECO -> ship ignition / separation (s)
    engineRamp: 2.0,                  // s, booster engine relight ramp
    landingRamp: 3.0,                 // s, 13-engine landing-burn relight ramp
    shipRamp: 3.0,                    // s, ship engine start-up during hot staging
    flip: 10.0,                        // s, booster flip on the 3 centre engines
    ringJettison: 5.0,                // s after boostback cutoff
  },
  ascentGuidance: {
    tVertical: 8, tKick: 10, kickDeg: 2.0,     // tower clearance, then a 2 deg pitch kick
    qTurn: 5e3,                                // Pa: start upper-atmosphere steering below this q (after max-Q)
    stagingGammaDeg: 31,                       // Earth-relative flight-path angle at MECO (pitch rate shot to it)
    throttle: { qLimit: 24e3, qBand: 0.15, accelLimit: 2.2 * 9.80665, slewUp: 0.002, slewDown: 0.08, min: 0.4, max: 0.92 },
  },
  // Guidance design constants. Engine throttle settings and trigger points
  // are not published; they are round values chosen so the flown profile
  // resembles SpaceX practice (max-Q bucket, ~2.2 g booster / 3.5 g ship
  // acceleration caps, throttled fine-targeting at the end of boostback,
  // RVac-only trim before SECO).
  shipGuidance: {
    throttle: 0.82, accelLimit: 3.5 * 9.80665,
    vernierDv: 500,                   // m/s to go when the SL engines shut down
    vernierThrottle: 0.5,             // RVac throttle during the final trim
  },
  boosterReturn: {
    flipThrottle: 0.5,
    boostbackPitchDeg: 0,             // boostback thrust horizontal (deg below horizontal)
    throttleDownDistance: 100e3, throttleDownTau: 0.5, // 13 engines throttle back inside 100 km
    trimDistance: 12e3, trimThrottle: 0.5, // last 12 km of impact-point walk on 3 engines
    ignitionThrottle: 0.8,            // planned 13-engine throttle at landing-burn ignition (margin)
    gateSpeed: 60, gateAlt: 150,       // 13 -> 3 engine switch gate (m/s, m)
    divertOffset: 700,                // m, offshore aim point east of the tower
    catchAlt: 100,                     // m (tower chopsticks)
  },
});

// ---------------------------------------------------------------------------
// Dynamics
// ---------------------------------------------------------------------------

/** Thrust (N) and mass flow (kg/s) of a set of engine groups at ambient pressure pa. */
function propulsion(groups, pa) {
  let F = 0, md = 0;
  for (const g of groups) {
    if (!g.n || !(g.tau > 0) || !(g.ramp > 0)) continue;
    F += g.n * g.ramp * engineThrust(g.engine, pa, g.tau);
    md += g.n * g.ramp * massFlow(g.engine, g.tau);
  }
  return { F, md };
}

function derivative(r, v, m, ctl) {
  const h = altitude(r);
  const atm = earthAtmosphere(h);
  let a = gravity(r);
  const vr = relVelocity(r, v);
  const sp = norm(vr);
  if (atm.rho > 1e-13 && sp > 1e-3) {
    const cd = interp(ctl.cd, sp / atm.a);
    a = add(a, scale(vr, (-0.5 * atm.rho * sp * cd * REF_AREA) / m));
  }
  if (ctl.groups && ctl.dir) {
    const { F } = propulsion(ctl.groups, atm.p);
    if (F > 0) a = add(a, scale(ctl.dir, F / m));
  }
  return a;
}

/** RK4 step of {r, v, m}; controls held over the step, mass flow constant. */
function step(s, dt, ctl) {
  const pa = earthAtmosphere(altitude(s.r)).p;
  const { md } = ctl.groups ? propulsion(ctl.groups, pa) : { md: 0 };
  const m0 = s.m, m1 = s.m - md * dt, mh = 0.5 * (m0 + m1);
  const k1v = derivative(s.r, s.v, m0, ctl), k1r = s.v;
  const r2 = add(s.r, scale(k1r, dt / 2)), v2 = add(s.v, scale(k1v, dt / 2));
  const k2v = derivative(r2, v2, mh, ctl), k2r = v2;
  const r3 = add(s.r, scale(k2r, dt / 2)), v3 = add(s.v, scale(k2v, dt / 2));
  const k3v = derivative(r3, v3, mh, ctl), k3r = v3;
  const r4 = add(s.r, scale(k3r, dt)), v4 = add(s.v, scale(k3v, dt));
  const k4v = derivative(r4, v4, m1, ctl), k4r = v4;
  return {
    ...s,
    r: add(s.r, scale(add(add(k1r, scale(k2r, 2)), add(scale(k3r, 2), k4r)), dt / 6)),
    v: add(s.v, scale(add(add(k1v, scale(k2v, 2)), add(scale(k3v, 2), k4v)), dt / 6)),
    m: m1,
    t: s.t + dt,
    usedProp: md * dt,
  };
}

/** Diagnostic quantities of a state. */
export function describe(s) {
  const h = altitude(s.r);
  const vr = relVelocity(s.r, s.v);
  const sp = norm(vr);
  const atm = earthAtmosphere(h);
  const up = unit(s.r);
  return {
    t: s.t, alt: h, speed: sp, vInertial: norm(s.v),
    gamma: Math.asin(Math.max(-1, Math.min(1, sp > 0 ? dot(vr, up) / sp : 1))),
    mach: sp / atm.a, q: 0.5 * atm.rho * sp * sp, pa: atm.p, rho: atm.rho,
  };
}

// ---------------------------------------------------------------------------
// Phase 1: stacked ascent to separation
// ---------------------------------------------------------------------------
function stackMass(F) {
  return F.booster.dryMass + F.booster.ringMass + F.booster.propMass + F.ship.dryMass + F.ship.propMass;
}

export function flyStack(F, pitchRateDeg, dt, rec) {
  const B = F.booster, TL = F.timeline;
  const site = geodeticToEcef(F.site.latDeg, F.site.lonDeg, F.site.h);
  const az = launchAzimuth(F.site.latDeg, F.targetOrbit.incDeg);
  const nAll = B.nOuter + B.nMiddle + B.nCenter;
  const thr = new G.ThrottleController(F.ascentGuidance.throttle);
  const pg = { ...F.ascentGuidance, pitchRateDeg, azimuthDeg: az };
  let tTurn = null, qPeak = 0;
  // Propellant burned on the pad between the end of the start sequence and
  // clamp release, at full thrust.
  let boosterProp = B.propMass - nAll * massFlow(B.engine, 1) * (TL.release - TL.ignition);
  let s = {
    t: TL.release,
    r: rotZ(site, EARTH.omega * TL.release),
    m: stackMass(F) - (B.propMass - boosterProp),
  };
  s.v = cross([0, 0, EARTH.omega], s.r);
  let tMeco = null, tau = 1, events = {};
  while (true) {
    const d = describe(s);
    let groups, dir;
    if (tMeco === null) {
      const cd = interp(CD_SLENDER, d.mach);
      const rhoUp = earthAtmosphere(d.alt + 50).rho, rhoDn = earthAtmosphere(Math.max(0, d.alt - 50)).rho;
      tau = thr.update(dt, {
        q: d.q, mass: s.m, thrustPerTau: nAll * engineThrust(B.engine, d.pa, 1),
        rho: d.rho, drhodh: (rhoUp - rhoDn) / (d.alt + 50 - Math.max(0, d.alt - 50)),
        speed: d.speed, hdot: d.speed * Math.sin(d.gamma),
        gAlong: norm(gravity(s.r)) * Math.sin(d.gamma), drag: d.q * cd * REF_AREA,
      });
      groups = [{ engine: B.engine, n: nAll, tau, ramp: 1 }];
      qPeak = Math.max(qPeak, d.q);
      if (tTurn === null && qPeak > 1e4 && d.q < F.ascentGuidance.qTurn) tTurn = s.t - TL.release;
      dir = G.boosterPitchProgram({ t: s.t - TL.release, r: s.r, vRel: relVelocity(s.r, s.v), tTurn }, pg);
      if (boosterProp <= B.returnReserve * B.propMass) {
        tMeco = s.t;
        events.meco = { ...d, boosterProp, stackMass: s.m };
      }
    }
    if (tMeco !== null) {
      // Hot staging: 30 engines off, the 3 centre engines stay lit (low
      // throttle) until the ship lights and pushes off.
      groups = [{ engine: B.engine, n: B.nCenter, tau: 0.5, ramp: 1 }];
      dir = unit(relVelocity(s.r, s.v));
      if (s.t >= tMeco + TL.hotStageDelay - 1e-9) break;
    }
    if (rec) rec(s, d, { tau, phase: tMeco === null ? 'ascent' : 'hotstage' });
    const ns = step(s, dt, { groups, dir, cd: CD_SLENDER });
    boosterProp -= ns.usedProp;
    s = ns;
  }
  const shipMass = F.ship.dryMass + F.ship.propMass;
  return {
    events, tMeco, tSep: s.t,
    booster: { t: s.t, r: s.r, v: s.v, m: s.m - shipMass, prop: boosterProp },
    ship: { t: s.t, r: s.r, v: s.v, m: shipMass, prop: F.ship.propMass },
  };
}

/** Find the upper-atmosphere pitch-over rate that gives the design flight-path angle at MECO. */
export function solvePitchRate(F = FLIGHT_IFT5, dt = 0.05) {
  const target = F.ascentGuidance.stagingGammaDeg;
  const g = (k) => flyStack(F, k, dt).events.meco.gamma / DEG - target;
  let lo = 0, hi = 1, glo = g(lo);
  if (glo <= 0) return 0;
  for (let i = 0; i < 40 && hi - lo > 1e-5; i++) {
    const mid = 0.5 * (lo + hi), gm = g(mid);
    if (gm > 0) { lo = mid; glo = gm; } else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ---------------------------------------------------------------------------
// Phase 2a: ship burn to SECO (closed-loop insertion guidance)
// ---------------------------------------------------------------------------
export function flyShip(F, sep, steer, dt, tEnd, rec) {
  const S = F.ship, SG = F.shipGuidance, TL = F.timeline, O = F.targetOrbit;
  const R = EARTH.a; // apsis altitudes quoted above the equatorial radius
  const tgt = G.insertionTarget(EARTH.mu, R, O.perigeeKm * 1000, O.apogeeKm * 1000, steer.insertionAltKm * 1000);
  let s = { t: sep.t, r: sep.r, v: sep.v, m: sep.m };
  let prop = sep.prop;
  let seco = null, tau = SG.throttle, dir = null, vernier = null;
  while (s.t < tEnd - 1e-9) {
    const d = describe(s);
    let ctl = { cd: CD_SLENDER };
    if (!seco) {
      const aps = G.apsides(s.r, s.v, EARTH.mu, R);
      if (aps.perigee >= O.perigeeKm * 1000 || prop <= 0 || d.alt < 0) {
        seco = { ...d, t: s.t, apogee: aps.apogee, perigee: aps.perigee, prop, mass: s.m, vernierStart: vernier };
        if (!rec) return { seco, state: s };
      } else {
        const ramp = Math.min(1, (s.t - sep.t) / TL.shipRamp + 0.05);
        // Velocity to gain: target horizontal speed and radial rate.
        const up = unit(s.r);
        const hdot = dot(s.v, up);
        const vh = norm(sub(s.v, scale(up, hdot)));
        const dv = Math.hypot(tgt.vh - vh, tgt.hdot - hdot);
        if (!vernier && dv < SG.vernierDv) vernier = s.t;
        if (vernier) {
          // Final trim: sea-level engines off, RVacs throttled back for a
          // precise cutoff.
          tau = SG.vernierThrottle;
          ctl.groups = [{ engine: S.vac, n: S.nVac, tau, ramp: 1 }];
        } else {
          const full = S.nSl * engineThrust(S.sl, d.pa, 1) + S.nVac * engineThrust(S.vac, d.pa, 1);
          tau = Math.max(S.sl.throttleMin, Math.min(SG.throttle, (SG.accelLimit * s.m) / full));
          ctl.groups = [
            { engine: S.sl, n: S.nSl, tau, ramp },
            { engine: S.vac, n: S.nVac, tau, ramp },
          ];
        }
        const { F: Fnow, md } = propulsion(ctl.groups.map((g) => ({ ...g, ramp: 1 })), d.pa);
        const tgo = vernier ? dv / (Fnow / s.m) : G.timeToGo(dv, Fnow / md, s.m, md, Fnow, SG.accelLimit);
        // Freeze the steering over the last seconds (t_go -> 0 singularity).
        if (!dir || tgo > 10) {
          dir = G.insertionSteering({ r: s.r, v: s.v, aThrust: (Fnow * ramp) / s.m, g: norm(gravity(s.r)) }, tgt, tgo);
        }
        ctl.dir = dir;
      }
    }
    if (rec) rec(s, d, { tau, phase: seco ? 'coast' : 'burn' });
    const ns = step(s, dt, ctl);
    prop -= ns.usedProp;
    s = ns;
  }
  return { seco, state: s };
}

// ---------------------------------------------------------------------------
// Phase 2b: booster flip, boostback, coast, landing burn, catch
// ---------------------------------------------------------------------------

/** Fast ballistic (drag-inclusive) impact prediction, Earth-fixed impact point. */
function predictImpact(s, dtp = 1.0) {
  let p = { t: s.t, r: s.r, v: s.v, m: s.m };
  const ctl = { cd: CD_TAIL_FIRST };
  for (let i = 0; i < 2000; i++) {
    const np = step(p, dtp, ctl);
    const h1 = altitude(np.r);
    if (h1 <= 0) {
      const h0 = altitude(p.r);
      const f = h0 / (h0 - h1);
      const r = add(p.r, scale(sub(np.r, p.r), f));
      return rotZ(r, -EARTH.omega * (p.t + f * dtp));
    }
    p = np;
  }
  return rotZ(p.r, -EARTH.omega * p.t);
}

export /** Drag deceleration (m/s^2) of the tail-first booster in state s. */
function dragDecel(s, d) {
  return (d.q * interp(CD_TAIL_FIRST, d.mach) * REF_AREA) / s.m;
}

/**
 * Predict a retrograde landing burn (engine group g, start-up ramp) from
 * state s until the Earth-relative speed drops to vGate; returns the state
 * at that point (alt) or the ground crossing.
 */
function predictLandingBurn(s, g, vGate, rampTime, dtp = 0.1) {
  let p = { t: s.t, r: s.r, v: s.v, m: s.m };
  for (let i = 0; i < 1000; i++) {
    const d = describe(p);
    if (d.speed <= vGate || d.alt <= 0) return d;
    const ramp = Math.min(1, (i * dtp) / rampTime + 0.2);
    p = step(p, dtp, { cd: CD_TAIL_FIRST, groups: [{ ...g, ramp }], dir: scale(unit(relVelocity(p.r, p.v)), -1) });
  }
  return describe(p);
}

function flyBooster(F, sep, dt, tEnd, rec) {
  const B = F.booster, TL = F.timeline, BR = F.boosterReturn;
  const siteEcef = geodeticToEcef(F.site.latDeg, F.site.lonDeg, F.site.h);
  let s = { t: sep.t, r: sep.r, v: sep.v, m: sep.m };
  let prop = sep.prop;
  // Boostback aims offshore of the tower (east, over the Gulf); the booster
  // only diverts onto the tower in the terminal phase of the landing burn.
  const { east } = G.localFrame(siteEcef);
  const aimEcef = add(siteEcef, scale(east, BR.divertOffset));
  const catchEcef = geodeticToEcef(F.site.latDeg, F.site.lonDeg, F.site.h + BR.catchAlt);
  let phase = 'flip', tPhase = s.t, miss0 = null, bbDir = null, tgo = 0;
  const ev = {};
  const n13 = B.nMiddle + B.nCenter;
  while (s.t < tEnd - 1e-9) {
    const d = describe(s);
    const vr = relVelocity(s.r, s.v);
    let ctl = { cd: CD_TAIL_FIRST };
    const gLocal = norm(gravity(s.r));
    if (phase === 'flip' || phase === 'boostback') {
      const miss = G.impactMiss(predictImpact(s), aimEcef);
      if (!miss0) miss0 = miss;
      // Boostback attitude: thrust in the vertical plane of the miss, pointed
      // back at the tower and pitched boostbackPitchDeg below the horizontal.
      {
        const up = unit(s.r);
        const back = scale(unit(sub(rotZ(miss, EARTH.omega * s.t), scale(up, dot(rotZ(miss, EARTH.omega * s.t), up)))), -1);
        const p = BR.boostbackPitchDeg * DEG;
        bbDir = add(scale(back, Math.cos(p)), scale(up, -Math.sin(p)));
      }
      if (phase === 'flip') {
        const f = Math.min(1, (s.t - tPhase) / TL.flip);
        ctl.dir = unit(add(scale(unit(vr), 1 - f), scale(bbDir, f)));
        ctl.groups = [{ engine: B.engine, n: B.nCenter, tau: BR.flipThrottle, ramp: 1 }];
        if (f >= 1) { phase = 'boostback'; tPhase = s.t; ev.boostbackStart = s.t; }
      } else {
        const ramp = Math.min(1, (s.t - tPhase) / TL.engineRamp);
        ctl.dir = bbDir;
        // Final trim of the impact point on the 3 centre engines only.
        // Fine targeting: 13 engines throttle back as the impact point
        // closes on the aim point, the last kilometres on 3 engines only.
        if (!ev.boostbackThrottleDown && norm(miss) < BR.throttleDownDistance) ev.boostbackThrottleDown = { t: s.t, speed: d.speed };
        if (!ev.boostbackTrim && norm(miss) < BR.trimDistance) ev.boostbackTrim = { t: s.t, speed: d.speed };
        const tau13 = ev.boostbackThrottleDown ? BR.throttleDownTau : 1;
        ctl.groups = ev.boostbackTrim
          ? [{ engine: B.engine, n: B.nCenter, tau: BR.trimThrottle, ramp: 1 }]
          : [
            { engine: B.engine, n: B.nCenter, tau: tau13, ramp: 1 },
            { engine: B.engine, n: B.nMiddle, tau: tau13, ramp },
          ];
        if (dot(miss, miss0) <= 0 || prop <= 0) {
          phase = 'coast'; tPhase = s.t; ev.boostbackEnd = { t: s.t, prop, mass: s.m };
          ctl.groups = null;
        }
      }
    } else if (phase === 'coast') {
      if (!ev.ringJettison && s.t >= tPhase + TL.ringJettison) { s = { ...s, m: s.m - B.ringMass }; ev.ringJettison = s.t; }
      if (d.gamma < 0 && d.alt < 15e3) {
        // Latest ignition that still reaches the gate: fast-time prediction
        // of a burn at the planned throttle, with drag.
        const gate = predictLandingBurn(s, { engine: B.engine, n: n13, tau: BR.ignitionThrottle }, BR.gateSpeed, TL.landingRamp);
        if (gate.alt <= BR.gateAlt) { phase = 'landing13'; tPhase = s.t; ev.landingBurn = { t: s.t, alt: d.alt, speed: d.speed, prop }; }
      }
    }
    if (phase === 'landing13') {
      // 13 engines, retrograde, throttled to reach the gate speed at the
      // gate altitude (constant-deceleration demand net of drag).
      const e = B.engine;
      const need = G.decelDemand(d.speed, d.alt, d.gamma, BR.gateSpeed, BR.gateAlt, gLocal) - dragDecel(s, d);
      // thrust(tau) = n * (Fvac * tau - pa * Ae)  ->  solve for tau
      let tau = (need * s.m / n13 + d.pa * e.exitArea) / e.thrustVac;
      tau = Math.max(e.throttleMin, Math.min(1, isFinite(tau) ? tau : 1));
      const ramp = Math.min(1, (s.t - tPhase) / TL.landingRamp + 0.2);
      ctl.groups = [{ engine: e, n: n13, tau, ramp }];
      ctl.dir = scale(unit(vr), -1);
      if (d.speed <= BR.gateSpeed) {
        phase = 'landing3'; tPhase = s.t;
        const dr = sub(rotZ(catchEcef, EARTH.omega * s.t), s.r);
        tgo = Math.max(5, (2 * norm(dr)) / d.speed);
        ev.gate = { t: s.t, alt: d.alt, speed: d.speed, divert: norm(dr), tgo };
      }
    } else if (phase === 'landing3') {
      // Terminal divert to the tower on the 3 centre engines: linear-in-time
      // acceleration that arrives at the catch point with zero Earth-relative
      // velocity at t_go (explicit two-point guidance).
      const e = B.engine;
      const T = Math.max(1, tgo - (s.t - tPhase));
      const dr = sub(rotZ(catchEcef, EARTH.omega * s.t), s.r);
      const a0 = add(scale(sub(dr, scale(vr, T)), 6 / (T * T)), scale(vr, 2 / T));
      const aDrag = scale(unit(vr), -dragDecel(s, d));
      const aT = sub(sub(a0, gravity(s.r)), aDrag);
      let tau = (norm(aT) * s.m / B.nCenter + d.pa * e.exitArea) / e.thrustVac;
      tau = Math.max(e.throttleMin, Math.min(1, tau));
      ctl.groups = [{ engine: e, n: B.nCenter, tau, ramp: 1 }];
      ctl.dir = unit(aT);
      if ((d.speed < 0.5 && norm(dr) < 20) || s.t - tPhase >= tgo || prop <= 0) {
        phase = 'caught'; ev.catch = { t: s.t, alt: d.alt, speed: d.speed, miss: norm(dr), prop, mass: s.m }; ctl.groups = null;
      }
    }
    if (phase === 'caught') {
      // Held by the tower: co-rotating with the Earth.
      if (rec) rec(s, { ...d, speed: 0 }, { phase });
      const r = rotZ(s.r, EARTH.omega * dt);
      s = { ...s, t: s.t + dt, r, v: cross([0, 0, EARTH.omega], r) };
      continue;
    }
    if (rec) rec(s, d, { phase });
    const ns = step(s, dt, ctl);
    prop -= ns.usedProp;
    s = ns;
  }
  return { events: ev, prop };
}

// ---------------------------------------------------------------------------
// Full mission
// ---------------------------------------------------------------------------

/**
 * Simulate the whole flight. Returns 1 s telemetry rows (unquantised) and
 * the key events.
 * @param {object} opts { flight, dt, tEnd, pitchRateDeg, shipSteer }
 */
export function simulateAscent(opts = {}) {
  const F = opts.flight ?? FLIGHT_IFT5;
  const dt = opts.dt ?? 0.05;
  const tEnd = opts.tEnd ?? 512;
  const pitchRateDeg = opts.pitchRateDeg ?? solvePitchRate(F, dt);
  const samples = new Map();
  const sampler = (key) => (s, d, extra) => {
    const k = Math.round(s.t);
    if (Math.abs(s.t - k) < dt / 2) {
      const row = samples.get(k) ?? { t: k };
      row[key + '_speed'] = d.speed;
      row[key + '_alt'] = d.alt;
      row[key + '_phase'] = extra.phase;
      if (extra.tau !== undefined) row[key + '_tau'] = extra.tau;
      row[key + '_q'] = d.q;
      samples.set(k, row);
    }
  };
  // Before release the stack sits on the pad (HUD reads 0).
  for (let k = 0; k < F.timeline.release; k++) samples.set(k, { t: k, stack_speed: 0, stack_alt: 0, stack_phase: 'pad' });
  const stack = flyStack(F, pitchRateDeg, dt, sampler('stack'));
  const shipSteer = opts.shipSteer ?? { insertionAltKm: F.targetOrbit.insertionAltKm };
  const ship = flyShip(F, stack.ship, shipSteer, dt, tEnd + dt, sampler('ship'));
  const booster = flyBooster(F, stack.booster, dt, tEnd + dt, sampler('booster'));
  const rows = [];
  for (let k = 0; k <= tEnd; k++) {
    const r = samples.get(k) ?? { t: k };
    rows.push({
      t: k,
      booster_speed_ms: r.booster_speed ?? r.stack_speed,
      booster_alt_m: r.booster_alt ?? r.stack_alt,
      ship_speed_ms: r.ship_speed ?? r.stack_speed,
      ship_alt_m: r.ship_alt ?? r.stack_alt,
      tau: r.stack_tau ?? r.ship_tau, q: r.stack_q ?? r.ship_q,
      booster_phase: r.booster_phase ?? r.stack_phase, ship_phase: r.ship_phase ?? r.stack_phase,
    });
  }
  return {
    rows, pitchRateDeg, shipSteer,
    events: {
      meco: stack.events.meco, tMeco: stack.tMeco, tSep: stack.tSep,
      seco: ship.seco, ...booster.events,
    },
  };
}

/**
 * Webcast HUD quantisation: SPEED in whole km/h and ALTITUDE in whole km,
 * both truncated (the HUD altitude steps to 1 km only once the vehicle is a
 * full kilometre up).
 */
export function hudSpeedKmh(ms) { return Math.max(0, Math.floor(ms * 3.6)); }
export function hudAltKm(m) { return Math.max(0, Math.floor(m / 1000)); }
