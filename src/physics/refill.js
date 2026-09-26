// Starship orbital refilling (ship-to-ship propellant transfer in LEO).
//
// Pure ES module (no DOM / three.js): importable from node and the browser.
//
// Everything here is derived from vehicle parameters (src/physics/vehicle.js),
// Earth parameters (src/physics/mars_body.js) and integrated dynamics:
//
//  * Tanker payload: a planar (2-D, rotating Earth, standard atmosphere,
//    drag) ascent of the full Super Heavy + Starship stack is integrated to
//    a circular LEO. The booster stages when its remaining propellant equals
//    what it needs for boostback + landing; the ship then flies a closed-loop
//    altitude-hold / horizontal-acceleration guidance until it reaches
//    circular speed. What is left in the tanks at insertion, minus the
//    rendezvous, deorbit and landing reserves (rocket equation), residuals,
//    loiter boil-off and settling propellant, is what a tanker delivers.
//  * Settling: the ullage acceleration needed to keep the liquid over the
//    outlets must dominate the environmental disturbances on the mated
//    stack (gravity gradient along the stack, aerodynamic drag, capillary
//    forces via the Bond number) by an order of magnitude.
//  * Transfer rate: pressure-driven incompressible flow through the LOX and
//    CH4 transfer lines (Darcy-Weisbach with Colebrook friction + fitting /
//    QD losses), with the mixture ratio enforced (the limiting line sets the
//    pace); full transfer time adds the line chill-down time, obtained from
//    the line thermal mass and the latent heat of the transferred cryogen.
//  * Boil-off: orbit-averaged radiative heat balance of the tank walls in
//    LEO (Earth IR, albedo, TPS-tile side with conduction through the tiles,
//    bare stainless side), heat divided by latent heat.
//  * Tanker count: event-driven campaign; the receiving ship reaches orbit
//    with its own ascent residual, tankers arrive at the launch cadence,
//    boil-off runs continuously, until the ship is full.
//  * Flight 3 demo: the IFT-3 transfer moved the LOX header tank contents
//    into the main tank; the header tank is sized for the landing burn
//    (belly-flop terminal velocity + flip + braking, integrated).

import * as V from './vehicle.js';
import { EARTH } from './mars_body.js';

const G0 = V.G0;
const SIGMA_SB = 5.670374419e-8;

// ---------------------------------------------------------------------------
// Parameters (physical constants of the fluids, geometry, mission inputs)
// ---------------------------------------------------------------------------
export const FLUIDS = {
  lox: { rho: 1141, hfg: 213e3, sigma: 0.0132, mu: 1.96e-4, tSat: 90.2 },   // NBP properties
  ch4: { rho: 422, hfg: 510e3, sigma: 0.0137, mu: 1.17e-4, tSat: 111.7 },
};

export const PARAMS = {
  config: 'block2',
  launchLatDeg: 25.99,          // Starbase
  leoAltKm: 250,                // depot / refilling orbit
  // booster guidance / recovery
  verticalRiseS: 12,
  kickDeg: 6.0,                 // pitch-over kick after the vertical rise
  kickDurS: 10,
  boosterLandingDv: 450,        // m/s landing burn (incl. gravity loss)
  // boostback dv = factor * downrange ground speed: cancel it, then fly back
  // at ~0.8x that speed on a ballistic return arc (RTLS to the tower)
  boostbackFactor: 1.8,
  boosterAccelLimit: 3.0 * G0,
  boosterIspRes: 350,           // s, boostback in thin air
  // ship guidance
  guidanceOmega: 0.012,         // rad/s, altitude-hold natural frequency
  guidanceZeta: 1.0,
  shipAccelLimit: 3.0 * G0,     // throttle-limited axial acceleration
  // orbital ops budget (m/s)
  rendezvousDv: 60,             // phasing + terminal rendezvous + docking
  deorbitPerigeeKm: 40,
  shipIspRcs: 60,               // s, warm-gas ullage thrusters (vent gas)
  residualFrac: 0.005,          // unusable trapped propellant, of loaded prop
  tankerLoiterDays: 1.0,        // insertion -> docking -> transfer start
  // landing (flip & burn)
  // belly-flop: broadside cylinder at Re ~ 4e7 is supercritical, Cd ~ 0.6
  landingCd: 0.6, landingFlipS: 5.0, landingEnginesFlip: 3, engineStartS: 1.5,
  headerMargin: 0.20,           // landing flight-performance reserve (winds, vT dispersion, engine-out)
  headerResidualFrac: 0.02,
  // mated stack geometry (tail-to-tail docking)
  aftBayLen: 4.5,               // m, tail (engine skirt) to aft LOX dome
  settlingMargin: 10,           // settling / disturbance (Kutter & Zegler)
  bondMin: 10,                  // interface dominated by body force
  // transfer plumbing
  lineDia: 0.20,                // m, both lines (20 cm class)
  lineLength: 30,               // m, tank-to-tank including QD
  lineRoughness: 1.5e-6,        // m, drawn stainless
  lineMinorK: 8.0,              // entrance+exit+valves+bends+QD poppets
  drivePressure: 0.7e5,         // Pa, donor ullage minus vented receiver
  lineWallThk: 0.004,           // m, stainless
  lineCp: 300,                  // J/kg/K stainless avg 100-300 K
  lineInitTempK: 250,
  // thermal environment / surfaces
  solar: 1361, albedo: 0.30, earthIR: 237,
  steelAlphaS: 0.40, steelEps: 0.12,
  // fibrous silica tile: 0.035 W/m/K is the 1-atm value; in vacuum the gas
  // conduction vanishes and k drops to ~0.015 W/m/K at 100-250 K
  tileAlphaS: 0.90, tileEps: 0.85, tileK: 0.015, tileThk: 0.04,
  tileFrac: 0.5,                // windward half of the barrel is tiled
  // Depot / receiving-ship thermal protection: MLI blanket over the bare
  // (leeward) steel half of the barrel. Modified Lockheed equation (Keller
  // et al. 1974, NASA CR-134477): layer density in layers/cm; installed
  // blankets (seams, penetrations, compression) run ~2-3x the lab value.
  mliLayers: 30, mliDensity: 15, mliDegradation: 3,
  mliAlphaS: 0.40, mliEps: 0.85,  // beta-cloth outer cover
  receiverMli: true,            // loitering depot / Mars ship carries MLI
  tankerMli: false,             // tankers are bare ships (1-day loiter)
  viewEarthNadirHalf: 0.62,     // bare steel half faces nadir
  viewEarthZenithHalf: 0.06,
  albedoOrbitAvg: 0.30,         // orbit-averaged albedo illumination factor
  // non-barrel heat paths (see parasiticHeat): skirts, engine mounts,
  // feed/pressurisation plumbing, tank domes facing the aft/forward bays
  skirtThk: 0.004, skirtLen: 3.0,       // m: steel skirt conduction path
  steelK: 10,                           // W/m/K, 304L averaged 90-290 K
  mountArea: 0.02, mountLen: 1.0,       // per-engine thrust-structure section
  plumbingW: 150,                       // lines, valves, sensors, QD (W)
  domeAreaFactor: 1.35,                 // 2:1-ish ellipsoidal dome / pi R^2
  // campaign
  cadenceDays: 6,               // tanker launch interval
  receiverPayloadT: 100,        // cargo on the Mars-bound ship
};

// ---------------------------------------------------------------------------
// Standard atmosphere (US-1976 layers to 86 km, tabulated above)
// ---------------------------------------------------------------------------
const LAYERS = [ // base km, lapse K/km, T0, p0
  [0, -6.5, 288.15, 101325], [11, 0, 216.65, 22632.1], [20, 1.0, 216.65, 5474.89],
  [32, 2.8, 228.65, 868.019], [47, 0, 270.65, 110.906], [51, -2.8, 270.65, 66.9389],
  [71, -2.0, 214.65, 3.95642], [86, 0, 186.87, 0.3734],
];
const R_AIR = 287.053;
const HI_RHO = [[86, 6.958e-6], [100, 5.604e-7], [150, 2.076e-9], [200, 2.541e-10],
  [250, 6.073e-11], [300, 1.916e-11], [400, 2.803e-12], [500, 5.215e-13]];

export function atmosphere(hM) {
  const h = Math.max(0, hM / 1000);
  if (h >= 86) {
    let i = 0; while (i < HI_RHO.length - 2 && HI_RHO[i + 1][0] < h) i++;
    const [h0, r0] = HI_RHO[i], [h1, r1] = HI_RHO[i + 1];
    const rho = Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * (h - h0) / (h1 - h0));
    return { rho, p: rho * R_AIR * 186.87, T: 186.87, a: Math.sqrt(1.4 * R_AIR * 186.87) };
  }
  let L = LAYERS[0];
  for (const l of LAYERS) if (h >= l[0]) L = l;
  const [hb, lapse, Tb, pb] = L;
  const T = Tb + lapse * (h - hb);
  const gM = G0 * 0.0289644 / 8.3144598;
  const p = lapse === 0 ? pb * Math.exp(-gM * (h - hb) * 1000 / Tb) : pb * Math.pow(Tb / T, gM / (lapse / 1000));
  return { rho: p / (R_AIR * T), p, T, a: Math.sqrt(1.4 * R_AIR * T) };
}

/** Axial drag coefficient of the slender stack vs Mach. */
function cdMach(M) {
  if (M < 0.8) return 0.30;
  if (M < 1.1) return 0.30 + (M - 0.8) / 0.3 * 0.45;
  if (M < 2.0) return 0.75 - (M - 1.1) / 0.9 * 0.25;
  return Math.max(0.30, 0.50 - (M - 2) * 0.04);
}

// ---------------------------------------------------------------------------
// Ascent to LEO (2-D, inertial frame, rotating atmosphere)
// ---------------------------------------------------------------------------
export function simulateAscent({ payloadT = 0, params = PARAMS, dt = 0.05 } = {}) {
  const P = params;
  const cfg = V.CONFIGS[P.config];
  const B = cfg.booster, S = cfg.ship;
  const mu = EARTH.mu, R = EARTH.rEq;
  const wc = EARTH.spinRate * Math.cos(P.launchLatDeg * Math.PI / 180);
  const area = Math.PI * (B.diameter / 2) ** 2;
  const rT = R + P.leoAltKm * 1000;
  const payload = payloadT * 1000;

  // state: x, y, vx, vy (inertial, Earth centre origin, launch site at (0,R))
  let x = 0, y = R, vx = wc * R, vy = 0;
  let mB = B.propMass, mS = S.propMass;
  let t = 0, phase = 'booster';
  let staging = null;
  let maxQ = 0;

  const vAtm = (px, py) => [wc * py, -wc * px];

  for (let it = 0; it < 400000; it++) {
    const r = Math.hypot(x, y);
    const h = r - R;
    const ur = [x / r, y / r], uh = [ur[1], -ur[0]];        // radial, downrange (east)
    const atm = atmosphere(h);
    const va = vAtm(x, y);
    const rvx = vx - va[0], rvy = vy - va[1];
    const vrel = Math.hypot(rvx, rvy);
    const q = 0.5 * atm.rho * vrel * vrel;
    maxQ = Math.max(maxQ, q);
    const cd = cdMach(vrel / atm.a);
    const mass = phase === 'booster'
      ? B.dryMass + mB + S.dryMass + mS + payload
      : S.dryMass + mS + payload;
    const dragA = vrel > 0 ? q * cd * area / mass : 0;
    const ax0 = -mu * x / r ** 3 - (vrel > 0 ? dragA * rvx / vrel : 0);
    const ay0 = -mu * y / r ** 3 - (vrel > 0 ? dragA * rvy / vrel : 0);
    let F = 0, mdot = 0, dir = ur;

    if (phase === 'booster') {
      // full throttle, throttled back late in the burn to the structural
      // acceleration limit (as the ship does)
      const Fmax = V.stageThrust(B, atm.p, 1);
      const thr = Math.min(1, P.boosterAccelLimit * mass / Fmax);
      F = V.stageThrust(B, atm.p, thr);
      mdot = V.stageMassFlow(B, thr);
      if (t < P.verticalRiseS) dir = ur;
      else if (t < P.verticalRiseS + P.kickDurS) {
        const k = (P.kickDeg * Math.PI / 180) * (t - P.verticalRiseS) / P.kickDurS;
        dir = [ur[0] * Math.cos(k) + uh[0] * Math.sin(k), ur[1] * Math.cos(k) + uh[1] * Math.sin(k)];
      } else dir = [rvx / vrel, rvy / vrel];                  // gravity turn
      // recovery reserve: boostback (kill + reverse downrange speed) + landing
      const vhGround = rvx * uh[0] + rvy * uh[1];
      const dvRes = P.boostbackFactor * Math.max(0, vhGround) + P.boosterLandingDv;
      const reserve = B.dryMass * (Math.exp(dvRes / (P.boosterIspRes * G0)) - 1);
      if (mB <= reserve) {
        staging = { t, h, v: Math.hypot(rvx, rvy), vInertial: Math.hypot(vx, vy),
          vr: vx * ur[0] + vy * ur[1], boosterPropUsed: B.propMass - mB, boosterReserve: mB };
        phase = 'ship';
        continue;
      }
    } else {
      const vr = vx * ur[0] + vy * ur[1];
      const vh = vx * uh[0] + vy * uh[1];
      const vCirc = Math.sqrt(mu / r);
      if (vh >= vCirc) break;                                 // insertion
      const Fmax = V.stageThrust(S, atm.p, 1);
      const mdMax = V.stageMassFlow(S, 1);
      const thr = Math.min(1, P.shipAccelLimit * mass / Fmax);
      F = Fmax * thr; mdot = mdMax * thr;
      const aT = F / mass;
      const w = P.guidanceOmega;
      const aCmd = w * w * (rT - r) - 2 * P.guidanceZeta * w * vr;
      const gEff = mu / (r * r) - vh * vh / r;
      const s = Math.max(-0.95, Math.min(0.95, (aCmd + gEff) / aT));
      const c = Math.sqrt(1 - s * s);
      dir = [ur[0] * s + uh[0] * c, ur[1] * s + uh[1] * c];
      if (mS <= 0) { mS = 0; break; }
    }
    const a = F / mass;
    // semi-implicit Euler at small dt is adequate here; use midpoint update
    const axT = ax0 + a * dir[0], ayT = ay0 + a * dir[1];
    const nvx = vx + axT * dt, nvy = vy + ayT * dt;
    x += 0.5 * (vx + nvx) * dt; y += 0.5 * (vy + nvy) * dt;
    vx = nvx; vy = nvy;
    if (phase === 'booster') mB -= mdot * dt; else mS -= mdot * dt;
    t += dt;
  }
  const r = Math.hypot(x, y);
  const ur = [x / r, y / r], uh = [ur[1], -ur[0]];
  const vr = vx * ur[0] + vy * ur[1], vh = vx * uh[0] + vy * uh[1];
  // orbit at insertion
  const v2 = vx * vx + vy * vy;
  const aSemi = 1 / (2 / r - v2 / mu);
  const hAng = r * vh;
  const e = Math.sqrt(Math.max(0, 1 - hAng * hAng / (mu * aSemi)));
  return {
    t, staging, maxQ,
    insertion: { h: r - R, vr, vh, rp: aSemi * (1 - e), ra: aSemi * (1 + e), a: aSemi, e },
    shipPropLeft: mS, shipMass: S.dryMass + mS + payload,
  };
}

// ---------------------------------------------------------------------------
// Orbital-ops propellant budget
// ---------------------------------------------------------------------------
const rocketProp = (m0, dv, isp) => m0 * (1 - Math.exp(-dv / (isp * G0)));
const reverseProp = (mf, dv, isp) => mf * (Math.exp(dv / (isp * G0)) - 1);

/** Circularisation dv at apoapsis of the insertion orbit, then into target circle. */
function circularizeDv(ins, rT) {
  const mu = EARTH.mu;
  const vApo = Math.sqrt(mu * (2 / ins.ra - 1 / ins.a));
  let dv = Math.abs(Math.sqrt(mu / ins.ra) - vApo);
  // Hohmann correction from ra to target radius if different
  if (Math.abs(ins.ra - rT) > 1) {
    const at = (ins.ra + rT) / 2;
    dv += Math.abs(Math.sqrt(mu * (2 / ins.ra - 1 / at)) - Math.sqrt(mu / ins.ra));
    dv += Math.abs(Math.sqrt(mu / rT) - Math.sqrt(mu * (2 / rT - 1 / at)));
  }
  return dv;
}

/** Deorbit dv from circular radius r to a perigee at rp (vis-viva). */
export function deorbitDv(r, rp) {
  const mu = EARTH.mu, a = (r + rp) / 2;
  return Math.sqrt(mu / r) - Math.sqrt(mu * (2 / r - 1 / a));
}

/** Belly-flop terminal speed, flip and braking burn: landing propellant (kg). */
export function landingBurn(params = PARAMS) {
  const P = params;
  const S = V.CONFIGS[P.config].ship;
  const eng = S.engines.find((g) => g.engine.ispSL > 300).engine;  // SL Raptor
  const bellyArea = S.diameter * S.length;
  const atm = atmosphere(0);
  // iterate: landing mass includes the landing propellant
  let mp = 5000;
  let out;
  for (let k = 0; k < 30; k++) {
    let m = S.dryMass + mp;
    const vT = Math.sqrt(2 * m * G0 / (atm.rho * P.landingCd * bellyArea));
    let v = -vT, t = 0, used = 0; const dt = 0.01;
    // flip: all engines lit at minimum throttle (engine-out redundancy and
    // gimbal authority for the rotation) while the body rotates 0->90 deg;
    // only the vertical thrust component brakes.
    const nF = P.landingEnginesFlip;
    const Ff = nF * V.thrust(eng, atm.p, eng.throttleMin), mdf = nF * V.massFlow(eng, eng.throttleMin);
    // start transient: thrust ramps linearly from 0 to min throttle over
    // engineStartS while the turbopumps already pass propellant at the
    // min-throttle flow (chill-down/spin-up); the ship is still belly-down
    // so none of that thrust brakes the fall
    { const ts = P.engineStartS; used += mdf * ts; m -= mdf * ts; }
    while (t < P.landingFlipS) {
      const th = (Math.PI / 2) * t / P.landingFlipS;
      v += (Ff * Math.sin(th) / m - G0) * dt;
      m -= mdf * dt; used += mdf * dt; t += dt;
    }
    // braking to touchdown on one engine; guidance design throttle sits
    // midway between the hover throttle and 100 %, leaving equal margin for
    // dispersions (thrust up to stop short, down to avoid stopping high)
    const hover = m * G0 / V.thrust(eng, atm.p, 1);
    const thr = Math.min(1, Math.max(eng.throttleMin, 0.5 * (hover + 1)));
    const F = V.thrust(eng, atm.p, thr), md = V.massFlow(eng, thr);
    while (v < 0) { v += (F / m - G0) * dt; m -= md * dt; used += md * dt; t += dt; }
    out = { vTerminal: vT, prop: used, burnS: t };
    if (Math.abs(used - mp) < 1) break;
    mp = used;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Settling acceleration
// ---------------------------------------------------------------------------
/** Height of the top of the main tanks above the tail (m), from the tank volumes. */
export function tankStackTop(params = PARAMS) {
  const S = V.CONFIGS[params.config].ship;
  const A = Math.PI * (S.diameter / 2) ** 2;
  return params.aftBayLen + (S.loxVolume + S.ch4Volume) / A;
}

export function settlingAccel(params = PARAMS) {
  const P = params;
  const mu = EARTH.mu, r = EARTH.rEq + P.leoAltKm * 1000;
  const n2 = mu / r ** 3;
  const S = V.CONFIGS[P.config].ship;
  // mated tail-to-tail stack, CoM near the docking interface. The tidal
  // (gravity-gradient) acceleration acts on the liquid, so the relevant
  // lever arm is the farthest liquid from the CoM: the top of the full
  // main CH4 tank (aft bay + LOX barrel + CH4 barrel), not the ship's nose.
  const xMax = tankStackTop(P);
  const aGG = 3 * n2 * xMax;                                  // radial-attitude worst case
  const massStack = 2 * (S.dryMass) + S.propMass;             // ~ one ship load split across both
  const atm = atmosphere(P.leoAltKm * 1000);
  const aDrag = 0.5 * atm.rho * mu / r * 2.2 * S.diameter * S.length / massStack;
  const R = S.diameter / 2;
  const aBond = Math.max(...Object.values(FLUIDS).map((f) => P.bondMin * f.sigma / (f.rho * R * R)));
  const disturbance = Math.max(aGG, aDrag, aBond);
  return { accel: P.settlingMargin * disturbance, aGG, aDrag, aBond, massStack };
}

// ---------------------------------------------------------------------------
// Transfer line hydraulics
// ---------------------------------------------------------------------------
function colebrook(Re, relRough) {
  if (Re < 2300) return 64 / Re;
  let f = 0.02;
  for (let i = 0; i < 50; i++) {
    const rhs = -2 * Math.log10(relRough / 3.7 + 2.51 / (Re * Math.sqrt(f)));
    f = 1 / (rhs * rhs);
  }
  return f;
}

export function lineFlow(fluid, params = PARAMS, dP = params.drivePressure) {
  const P = params, D = P.lineDia, A = Math.PI * D * D / 4;
  let v = 3;
  for (let i = 0; i < 60; i++) {
    const Re = fluid.rho * v * D / fluid.mu;
    const f = colebrook(Re, P.lineRoughness / D);
    const K = f * P.lineLength / D + P.lineMinorK;
    v = Math.sqrt(2 * dP / (fluid.rho * K));
  }
  return { v, mdot: fluid.rho * v * A };
}

export function transferRate(params = PARAMS) {
  const P = params;
  const mr = V.PROPELLANT.mixtureRatio;
  const { accel } = settlingAccel(P);
  // settled hydrostatic head adds to the drive (tiny at ~1 mm/s^2)
  const head = tankStackTop(P) / 2;
  const lox = lineFlow(FLUIDS.lox, P, P.drivePressure + FLUIDS.lox.rho * accel * head);
  const ch4 = lineFlow(FLUIDS.ch4, P, P.drivePressure + FLUIDS.ch4.rho * accel * head);
  // hold mixture ratio: the limiting line sets the pace, the other throttles
  const loxRate = Math.min(lox.mdot, ch4.mdot * mr);
  const total = loxRate * (1 + mr) / mr;                      // kg/s
  return { total, lox, ch4, limitedBy: lox.mdot < ch4.mdot * mr ? 'lox' : 'ch4' };
}

/** Line chill-down: line wall mass cooled from lineInitTempK to T_sat by boiling cryogen. */
export function chilldownTime(params = PARAMS) {
  const P = params, D = P.lineDia;
  const wallMass = Math.PI * (D + P.lineWallThk) * P.lineWallThk * P.lineLength * 7900;
  const tr = transferRate(P);
  let t = 0;
  for (const [key, f] of Object.entries(FLUIDS)) {
    const Q = wallMass * P.lineCp * (P.lineInitTempK - f.tSat);
    const mBoil = Q / f.hfg;                                   // cryogen vaporised
    // chill flow limited to a trickle (10 % of nominal) to avoid geysering
    const md = 0.1 * (key === 'lox' ? tr.lox.mdot : tr.ch4.mdot);
    t = Math.max(t, mBoil / md);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Boil-off (orbit-averaged heat balance)
// ---------------------------------------------------------------------------
/** Modified Lockheed MLI heat flux (W/m^2) between warm face Th and cold face Tc. */
export function mliFlux(Th, Tc, P = PARAMS) {
  const N = P.mliLayers, Nd = P.mliDensity;
  const solid = 8.95e-8 * Nd ** 2.63 * (Th - Tc) * (Th + Tc) / (2 * (N + 1));
  const rad = 5.39e-10 * 0.031 * (Th ** 4.67 - Tc ** 4.67) / N;
  return P.mliDegradation * (solid + rad);
}

/** Heat through an MLI blanket whose outer cover absorbs qAbs (W/m^2). */
function mliHeat(qAbs, P, tLiq) {
  let lo = tLiq, hi = 400;
  for (let i = 0; i < 100; i++) {
    const T = 0.5 * (lo + hi);
    if (P.mliEps * SIGMA_SB * T ** 4 + mliFlux(T, tLiq, P) > qAbs) hi = T; else lo = T;
  }
  return mliFlux(0.5 * (lo + hi), tLiq, P);
}

/**
 * Heat leaking in through everything but the barrel (W): conduction along
 * the forward and aft skirts and the engine thrust structure from the
 * enclosed bays, plumbing, and radiation from the bay walls onto the two
 * tank end domes (bare steel-to-steel, or through MLI when the vehicle
 * carries it). Bay walls sit at the radiative-equilibrium temperature of
 * the bare hull in the orbit-averaged environment.
 */
export function parasiticHeat(params = PARAMS, mli = params.receiverMli) {
  const P = params;
  const S = V.CONFIGS[P.config].ship;
  const R = S.diameter / 2;
  const tLiq = 0.5 * (FLUIDS.lox.tSat + FLUIDS.ch4.tSat);
  const absN = P.steelEps * P.earthIR * P.viewEarthNadirHalf
    + P.steelAlphaS * P.albedo * P.solar * P.viewEarthNadirHalf * P.albedoOrbitAvg;
  const absZ = P.steelEps * P.earthIR * P.viewEarthZenithHalf
    + P.steelAlphaS * P.albedo * P.solar * P.viewEarthZenithHalf * P.albedoOrbitAvg;
  const tBay = ((absN + absZ) / 2 / (P.steelEps * SIGMA_SB)) ** 0.25;
  const dT = tBay - tLiq;
  const skirts = 2 * P.steelK * Math.PI * S.diameter * P.skirtThk * dT / P.skirtLen;
  const mounts = S.engineCount * P.steelK * P.mountArea * dT / P.mountLen;
  const domeA = 2 * P.domeAreaFactor * Math.PI * R * R;
  const epsEff = 1 / (2 / P.steelEps - 1);
  const qDome = mli ? mliFlux(tBay, tLiq, P) : epsEff * SIGMA_SB * (tBay ** 4 - tLiq ** 4);
  const domes = domeA * qDome;
  return { total: skirts + mounts + domes + P.plumbingW, skirts, mounts, domes, tBay };
}

function tileHeat(qAbs, P, tLiq) {
  // outer tile surface: qAbs = eps*sigma*T^4 + (k/t)(T - Tliq)
  const G = P.tileK / P.tileThk;
  let lo = tLiq, hi = 400;
  for (let i = 0; i < 100; i++) {
    const T = 0.5 * (lo + hi);
    if (P.tileEps * SIGMA_SB * T ** 4 + G * (T - tLiq) > qAbs) hi = T; else lo = T;
  }
  return G * (0.5 * (lo + hi) - tLiq);
}

/**
 * Boil-off for a tank set at fill fraction `fill` (1 = full). Wall heat
 * reaches the liquid only through the wetted barrel (settled liquid; heat
 * into dry ullage walls superheats the vapour instead), so it scales with
 * fill; structural/plumbing/dome heat (parasiticHeat) does not.
 */
export function boiloff(params = PARAMS, fill = 1, mli = params.receiverMli) {
  const P = params;
  const S = V.CONFIGS[P.config].ship;
  const R = S.diameter / 2;
  // tank barrel length from the propellant volumes
  const Lox = S.loxVolume / (Math.PI * R * R), Lch4 = S.ch4Volume / (Math.PI * R * R);
  const Qpar = parasiticHeat(P, mli).total;
  let Q = Qpar, mdot = 0;
  for (const [key, L] of [['lox', Lox], ['ch4', Lch4]]) {
    const f = FLUIDS[key];
    const side = 2 * Math.PI * R * L * fill;
    const steelA = side * (1 - P.tileFrac), tileA = side * P.tileFrac;
    // bare stainless half faces nadir: Earth IR + albedo (wall ~ at T_liq, re-emission negligible)
    const qSteel = mli
      ? mliHeat(P.mliEps * P.earthIR * P.viewEarthNadirHalf
        + P.mliAlphaS * P.albedo * P.solar * P.viewEarthNadirHalf * P.albedoOrbitAvg, P, f.tSat)
      : P.steelEps * P.earthIR * P.viewEarthNadirHalf
        + P.steelAlphaS * P.albedo * P.solar * P.viewEarthNadirHalf * P.albedoOrbitAvg
        - P.steelEps * SIGMA_SB * f.tSat ** 4;
    const qTileAbs = P.tileEps * P.earthIR * P.viewEarthZenithHalf
      + P.tileAlphaS * P.albedo * P.solar * P.viewEarthZenithHalf * P.albedoOrbitAvg;
    const qTile = tileHeat(qTileAbs, P, f.tSat);
    const Qk = steelA * qSteel + tileA * qTile;
    Q += Qk;
    mdot += Qk / f.hfg;
  }
  // parasitic heat split by mass fraction into the mixed latent heat
  const mr = V.PROPELLANT.mixtureRatio;
  const hMix = (mr * FLUIDS.lox.hfg + FLUIDS.ch4.hfg) / (1 + mr);
  mdot += Qpar / hMix;
  return { Q, mdot, tPerDay: mdot * 86400 / 1000, pctPerDay: 100 * mdot * 86400 / S.propMass };
}

/** Integrate boil-off of a tank set holding `mass` kg over `days`. */
export function loiter(mass, days, params = PARAMS, mli = params.receiverMli) {
  const cap = V.CONFIGS[params.config].ship.propMass;
  const dt = 3600, n = Math.ceil(days * 86400 / dt), h = days * 86400 / n;
  let m = mass;
  for (let i = 0; i < n && m > 0; i++) m -= boiloff(params, m / cap, mli).mdot * h;
  return Math.max(0, m);
}

// ---------------------------------------------------------------------------
// Tanker delivery, campaign, flight-3 demo
// ---------------------------------------------------------------------------
export function tankerDelivery(params = PARAMS) {
  const P = params;
  const S = V.CONFIGS[P.config].ship;
  const asc = simulateAscent({ payloadT: 0, params: P });
  const rT = EARTH.rEq + P.leoAltKm * 1000;
  const vacIsp = V.stageIsp(S, 0, 1, V.bestVacuumGroups(S));
  const land = landingBurn(P);
  const eng = S.engines.find((g) => g.engine.ispSL > 300).engine;
  // work backwards from touchdown: landing prop, then deorbit, are reserved
  const mLand = S.dryMass + land.prop;
  const deorbit = deorbitDv(rT, EARTH.rEq + P.deorbitPerigeeKm * 1000);
  const mDeorbitStart = mLand + reverseProp(mLand, deorbit, V.isp(eng, 0));
  const reserve = mDeorbitStart - S.dryMass;
  // forward from insertion: circularise + rendezvous
  let m = asc.shipMass;
  const dvCirc = circularizeDv(asc.insertion, rT);
  const pCirc = rocketProp(m, dvCirc + P.rendezvousDv, vacIsp); m -= pCirc;
  const onboard = m - S.dryMass;
  const pBoil = onboard - loiter(onboard, P.tankerLoiterDays, P, P.tankerMli);
  const residual = P.residualFrac * S.propMass;
  // settling propellant during the transfer (tanker pays; vent-gas thrusters)
  const settle = settlingAccel(P);
  const tr = transferRate(P);
  let deliver = m - S.dryMass - reserve - pBoil - residual;
  const tXfer = deliver / tr.total + chilldownTime(P);
  const pSettle = settle.accel * (S.dryMass * 2 + S.propMass) * tXfer / (P.shipIspRcs * G0);
  deliver -= pSettle;
  return { deliver, ascent: asc, dvCirc, reserve, landingProp: land.prop, pCirc, pBoil, residual, pSettle, vacIsp };
}

/** Ship that goes to Mars: launched with cargo, filled by tankers at the launch cadence. */
export function campaign(params = PARAMS) {
  const P = params;
  const S = V.CONFIGS[P.config].ship;
  const cap = S.propMass;
  const tk = tankerDelivery(P);
  const rx = simulateAscent({ payloadT: P.receiverPayloadT, params: P });
  const rT = EARTH.rEq + P.leoAltKm * 1000;
  let prop = rx.shipPropLeft
    - rocketProp(rx.shipMass, circularizeDv(rx.insertion, rT), tk.vacIsp);
  const bo = boiloff(P);
  let n = 0;
  const log = [prop];
  while (prop < cap - 1e-6 && n < 100) {
    prop = loiter(prop, P.cadenceDays, P);        // waits for the next tanker
    prop = Math.min(cap, prop + tk.deliver);
    n++;
    log.push(prop);
  }
  return { tankers: n, receiverStartProp: log[0], log, days: n * P.cadenceDays, tanker: tk, boiloff: bo };
}

/** IFT-3: header-to-main LOX transfer; header LOX tank sized for the landing burn. */
export function flight3Demo(params = PARAMS) {
  const P = params;
  const mr = V.PROPELLANT.mixtureRatio;
  const land = landingBurn(P);
  const headerLox = land.prop * mr / (1 + mr) * (1 + P.headerMargin);
  return { headerLox, transferred: headerLox * (1 - P.headerResidualFrac), landing: land };
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------
export function refillSummary(params = PARAMS) {
  const P = params;
  const S = V.CONFIGS[P.config].ship;
  const camp = campaign(P);
  const tr = transferRate(P);
  const rate = tr.total * 60 / 1000;
  const fullH = (S.propMass / tr.total + chilldownTime(P)) / 3600;
  return {
    ship_prop_capacity_t: S.propMass / 1000,
    prop_per_tanker_t: camp.tanker.deliver / 1000,
    tankers_for_full_fill: camp.tankers,
    flight3_transfer_demo_t: flight3Demo(P).transferred / 1000,
    transfer_rate_t_per_min: rate,
    full_transfer_time_h: fullH,
    boiloff_pct_per_day: camp.boiloff.pctPerDay,
    settling_accel_mms2: settlingAccel(P).accel * 1000,
  };
}
