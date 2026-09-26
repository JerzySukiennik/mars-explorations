// Perseverance-class rover: mobility, power generation, storage and loads.
//
// Pure ES module (no DOM, no three.js): importable from node and the browser.
// Units: SI unless the name says otherwise (W, Wh, Ah, V, K, m, s; hours are
// Earth hours, one sol = 24.6597 h).
//
// Nothing here stores a battery trace. The sol timeline is produced by
// integrating, at a fixed small time step:
//   * a lumped surface energy balance (sunlight at Jezero, thermal inertia,
//     IR to space and downwelling from the dusty atmosphere) -> ground/air T;
//   * the MMRTG as a heat source feeding thermoelectric couples whose cold
//     side is set by a fin radiator (radiation + CO2 convection, with the
//     fin/housing heat capacity) -> electrical output from the couple
//     efficiency (Carnot fraction x figure of merit ZT);
//   * component loads switched by an activity plan, temperature-dependent
//     survival and actuator heaters, and an AutoNav drive whose motor power
//     comes from rolling resistance + grade on the terrain it is driving over,
//     with wheel slip reducing ground speed;
//   * two 8-cell Li-ion batteries (Ah counted through an open-circuit voltage
//     curve and internal resistance), capped by the shunt regulator at 100 %.
//
// Parameter sources (design values, not fitted to any timeline):
//  - Mass 1025 kg, wheel diameter 52.7 cm, top speed 4.2 cm/s (152 m/h),
//    mobility "< 200 W": NASA M2020 rover components pages.
//  - MMRTG: ~2000 W thermal at BOL from 4.8 kg PuO2 (Pu-238 half-life 87.7 yr),
//    PbTe/TAGS couples, hot junction ~530 C, cold junction ~210 C; ~110 W
//    electrical: NASA MMRTG fact sheet and M2020 press kit. Couple degradation
//    ~2.5 %/yr from the MSL flight trend (Manning & Simon 2017).
//  - Batteries: two Li-ion, 43 Ah each, 8 cells in series (M2020 press kit,
//    JPL Li-ion test report); cell OCV 3.0-4.1 V typical of the Yardney NCO
//    chemistry; ~98 % coulombic/charge acceptance.
//  - Loads: 45-70 W asleep, >= 150 W awake, up to ~500 W driving, peak demand
//    ~900 W (MSL/M2020 published figures); individual instrument/radio loads
//    from instrument papers (Electra-Lite UHF, X-band SSPA, Mastcam-Z,
//    SuperCam, PIXL, coring drill).
//  - Jezero: 18.44 N; thermal inertia ~350 SI and albedo ~0.2 (THEMIS/MEDA).

const DEG = Math.PI / 180;
const SIGMA = 5.670374e-8;
export const SOL_S = 88775.244;
export const SOL_H = SOL_S / 3600;          // 24.6597 Earth hours
export const G_MARS = 3.721;                // m/s^2
export const SOLS_PER_EARTH_YEAR = 365.25 * 86400 / SOL_S;

// ---------------------------------------------------------------- vehicle --
export const ROVER = Object.freeze({
  massKg: 1025,
  wheels: 6,
  wheelRadius_m: 0.2635,
  topSpeed_m_s: 0.042,             // wheel rim speed limit on flat hard ground
  crr: 0.15,                       // rolling resistance (Bekker-type, loose regolith)
  driveEfficiency: 0.22,           // motor x planetary/harmonic gear at cold temp
  steerAvg_W: 10,                  // steering actuators averaged over a drive
  brakeRelease_W: 20,              // wheel/steer brakes held open while moving
  motorController_W: 40,           // RMC electronics on during mobility
  vce_W: 25,                       // Vision Compute Element (AutoNav stereo/VO)
  driveCameras_W: 8,               // Navcam + Hazcams imaging while driving
  // AutoNav: the rover images and runs visual odometry every stepLength_m;
  // part of that is overlapped with motion ("thinking while driving") but a
  // short stop per step remains.
  stepLength_m: 1.0,
  stopPerStep_s: 8,
});

export const TOP_SPEED_M_PER_H = ROVER.topSpeed_m_s * 3600;

/** Wheel slip fraction on a grade (deg, + uphill). Empirical MER/MSL trend:
 * a few percent on the flat, ~20 % near 10 deg, near-total by ~20-25 deg. */
export function slipFraction(slopeDeg) {
  if (slopeDeg <= 0) return 0.03;
  return Math.min(0.95, 0.03 + 0.0006 * Math.pow(slopeDeg, 2.5));
}

/** Ground speed (m/s) at the wheel speed limit on a grade. */
export function groundSpeed(slopeDeg, r = ROVER) {
  return r.topSpeed_m_s * (1 - slipFraction(slopeDeg));
}

/** Electrical power of the drive motors (W) while wheels turn at top speed. */
export function motorPower(slopeDeg, r = ROVER) {
  const th = slopeDeg * DEG;
  const w = r.massKg * G_MARS;
  const F = Math.max(0, w * (r.crr * Math.cos(th) + Math.sin(th)));
  // Wheels turn at rim speed; slip means that work is spent without progress.
  return F * r.topSpeed_m_s / r.driveEfficiency + r.steerAvg_W;
}

/** Representative undulating terrain: slope (deg, + uphill) vs distance. */
export function terrainSlope(x_m, base = 2) {
  return base + 4 * Math.sin(2 * Math.PI * x_m / 57) + 2.5 * Math.sin(2 * Math.PI * x_m / 19 + 1.1);
}

/** Time (s) to traverse one AutoNav step starting at x. */
function stepTime(x, r = ROVER, slopeFn = terrainSlope) {
  return r.stepLength_m / groundSpeed(slopeFn(x + r.stepLength_m / 2), r) + r.stopPerStep_s;
}

/** Average AutoNav rate (m/h) over a stretch of terrain, including stops. */
export function autonavRate(distance_m = 300, r = ROVER, slopeFn = terrainSlope) {
  let t = 0;
  for (let x = 0; x < distance_m; x += r.stepLength_m) t += stepTime(x, r, slopeFn);
  return distance_m / (t / 3600);
}

/** Distance (m) covered by AutoNav in a drive-time budget (h). */
export function driveDistanceInTime(hours, r = ROVER, slopeFn = terrainSlope) {
  let t = 0, x = 0;
  while (true) {
    const dt = stepTime(x, r, slopeFn);
    if (t + dt > hours * 3600) break;
    t += dt; x += r.stepLength_m;
  }
  return x;
}

// ------------------------------------------------------------ environment --
export const SITE = Object.freeze({
  latDeg: 18.44,              // Jezero
  Ls: 30,                     // season (deg), early northern spring
  albedo: 0.20,
  emissivity: 0.95,
  thermalInertia: 350,        // J m^-2 K^-1 s^-1/2
  tau: 0.5,                   // dust optical depth
  airCoupling: 0.62,          // 1.5 m air diurnal amplitude / ground amplitude
});

function sunDistanceAU(Ls) {
  const a = 1.52368, e = 0.0934, LsPeri = 251;
  return a * (1 - e * e) / (1 + e * Math.cos((Ls - LsPeri) * DEG));
}

/** Cosine of the solar zenith angle at local time (h since local midnight). */
export function cosZenith(t_h, site = SITE) {
  const dec = Math.asin(Math.sin(25.19 * DEG) * Math.sin(site.Ls * DEG));
  const H = 2 * Math.PI * (t_h / SOL_H - 0.5);
  const lat = site.latDeg * DEG;
  return Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
}

/** Integrate a lumped surface energy balance to its periodic diurnal cycle.
 * Returns fn(t_h) -> {Ts, Tair, Tsky} in K. */
export function makeClimate(site = SITE, dt = 60) {
  const S0 = 1361 / sunDistanceAU(site.Ls) ** 2;
  // Downwelling IR from the CO2/dust column (Mars GCMs: ~ 10-15 % of the
  // absorbed sunlight in clear-ish conditions, more with dust).
  const Ldown = 8 + 30 * site.tau;
  const C = site.thermalInertia * Math.sqrt(SOL_S / (2 * Math.PI)); // skin heat capacity
  const G = site.thermalInertia * Math.sqrt(2 * Math.PI / SOL_S);   // coupling to depth
  const n = Math.round(SOL_S / dt);
  const insol = (t_h) => {
    const mu = cosZenith(t_h, site);
    if (mu <= 0) return 0;
    const direct = Math.exp(-site.tau / Math.max(mu, 0.05));
    const diffuse = 0.5 * (1 - direct);          // forward-scattered half
    return S0 * mu * (direct + diffuse);
  };
  let Ts = 210, Tdeep = 210;
  let series = new Float64Array(n);
  for (let sol = 0; sol < 12; sol++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const t_h = i * dt / 3600;
      const q = (1 - site.albedo) * insol(t_h) + site.emissivity * Ldown
        - site.emissivity * SIGMA * Ts ** 4 + G * (Tdeep - Ts);
      Ts += q * dt / C;
      series[i] = Ts; sum += Ts;
    }
    Tdeep = sum / n; // deep layer sits at the diurnal mean
  }
  const Tmean = Tdeep;
  const Tsky = (Ldown / SIGMA) ** 0.25;
  return (t_h) => {
    const u = (((t_h / SOL_H) % 1) + 1) % 1 * n;
    const i = Math.floor(u), f = u - i;
    const T = series[i] * (1 - f) + series[(i + 1) % n] * f;
    return { Ts: T, Tair: Tmean - 8 + site.airCoupling * (T - Tmean), Tsky };
  };
}

// ------------------------------------------------------------------ MMRTG --
export const MMRTG = Object.freeze({
  thermalBOL_W: 2000,
  puHalfLife_yr: 87.7,
  coupleDegradation_per_yr: 0.025, // TE sublimation / contact resistance growth
  hotJunction_K: 803,              // ~530 C at design heat flux
  coldJunction_K: 483,             // ~210 C at design heat flux
  zt: 0.55,                        // device-average figure of merit PbTe/TAGS
  finArea_m2: 2.0,                 // effective radiating area of the 8 fins
  finEmissivity: 0.9,
  hConv: 1.5,                      // W/m^2/K forced CO2 convection at ~5 m/s
  finToColdJunction_K_per_W: 0.05,
  heatCapacity_J_K: 45 * 900,      // 45 kg of housing/fins
});

/** Thermoelectric conversion efficiency at junction temperatures (K). */
export function teEfficiency(Th, Tc, zt = MMRTG.zt) {
  const s = Math.sqrt(1 + zt);
  return (Th - Tc) / Th * (s - 1) / (s + Tc / Th);
}

/** Thermal output and couple degradation factor at mission age (sols). */
function mmrtgAge(sol, m = MMRTG) {
  const yr = sol / SOLS_PER_EARTH_YEAR;
  return {
    Q: m.thermalBOL_W * Math.pow(0.5, yr / m.puHalfLife_yr),
    degr: Math.pow(1 - m.coupleDegradation_per_yr, yr),
  };
}

/** Electrical output (W) given cold-junction temperature and mission age. */
export function mmrtgElectrical(Tc, sol = 0, m = MMRTG) {
  const { Q, degr } = mmrtgAge(sol, m);
  // Couple conductance fixed: temperature drop scales with heat through them.
  const dT = (m.hotJunction_K - m.coldJunction_K) * Q / m.thermalBOL_W;
  return Q * teEfficiency(Tc + dT, Tc, m.zt) * degr;
}

/** Steady fin temperature for a heat load and environment (Newton solve). */
export function finTemperature(Qrej, Tenv4, Tair, m = MMRTG) {
  let T = 380;
  for (let k = 0; k < 30; k++) {
    const f = m.finEmissivity * SIGMA * m.finArea_m2 * (T ** 4 - Tenv4) + m.hConv * m.finArea_m2 * (T - Tair) - Qrej;
    const d = 4 * m.finEmissivity * SIGMA * m.finArea_m2 * T ** 3 + m.hConv * m.finArea_m2;
    T -= f / d;
  }
  return T;
}

/** Radiative environment seen by the fins: half ground, half sky. */
const envT4 = (c) => 0.5 * c.Ts ** 4 + 0.5 * c.Tsky ** 4;

/** MMRTG model with fin thermal state; step(dt, climate) -> electrical W. */
export function createMMRTG({ sol = 0, climate, t0_h = 0, m = MMRTG } = {}) {
  const c0 = climate(t0_h);
  const { Q } = mmrtgAge(sol, m);
  let Tf = finTemperature(Q - 110, envT4(c0), c0.Tair, m);
  let P = 0;
  const Tc = () => Tf + (Q - P) * m.finToColdJunction_K_per_W;
  P = mmrtgElectrical(Tc(), sol, m);
  return {
    get power() { return P; },
    get finT() { return Tf; },
    step(dt, t_h) {
      const c = climate(t_h);
      const qOut = m.finEmissivity * SIGMA * m.finArea_m2 * (Tf ** 4 - envT4(c)) + m.hConv * m.finArea_m2 * (Tf - c.Tair);
      Tf += (Q - P - qOut) * dt / m.heatCapacity_J_K;
      P = mmrtgElectrical(Tc(), sol, m);
      return P;
    },
  };
}

/** Diurnal-mean MMRTG output (W) at a given mission age. */
export function mmrtgMeanPower(sol = 0, climate = makeClimate()) {
  const g = createMMRTG({ sol, climate });
  const dt = 120; let t = 0, sum = 0, n = 0;
  for (let k = 0; k < 2; k++) for (let i = 0; i < SOL_S / dt; i++) {
    t += dt; const p = g.step(dt, t / 3600);
    if (k === 1) { sum += p; n++; }
  }
  return sum / n;
}

/** MMRTG output decline rate (W per sol) around mission age `sol`. */
export function mmrtgDecayPerSol(sol = 0, climate = makeClimate()) {
  const span = 300;
  return (mmrtgMeanPower(sol, climate) - mmrtgMeanPower(sol + span, climate)) / span;
}

// ---------------------------------------------------------------- battery --
export const BATTERY = Object.freeze({
  count: 2,
  capacityAh: 43,                // each
  cellsSeries: 8,
  cellResistance_ohm: 0.004,     // per cell at ~0 C
  chargeAcceptance: 0.98,
});

/** Cell open-circuit voltage vs state of charge (0..1), Li-ion NCO shape. */
export function cellOCV(soc) {
  const s = Math.min(1, Math.max(0, soc));
  return 3.0 + 0.62 * s + 0.48 * s ** 3 - 0.35 * Math.exp(-12 * s) + 0.35 * Math.exp(-12);
}

/** Total stored energy between 0 and 100 % SOC (Wh), from the OCV curve. */
export function batteryEnergyWh(b = BATTERY) {
  let e = 0; const n = 1000;
  for (let i = 0; i < n; i++) e += cellOCV((i + 0.5) / n) * b.cellsSeries / n;
  return e * b.capacityAh * b.count;
}

export function createBattery({ soc = 0.75, b = BATTERY } = {}) {
  const cap = b.capacityAh * b.count; // Ah on the bus (parallel)
  let q = soc * cap;
  const R = b.cellResistance_ohm * b.cellsSeries / b.count;
  return {
    get soc() { return q / cap; },
    get voltage() { return cellOCV(q / cap) * b.cellsSeries; },
    /** Apply net bus power (W, + charging) for dt seconds; returns power shunted. */
    step(Pnet, dt) {
      const V = cellOCV(q / cap) * b.cellsSeries;
      // Terminal: Pnet = I (V + I R)  ->  solve for I (sign follows Pnet).
      const I = (-V + Math.sqrt(V * V + 4 * R * Pnet)) / (2 * R);
      let dq = (I > 0 ? I * b.chargeAcceptance : I) * dt / 3600;
      let shunt = 0;
      if (q + dq > cap) { shunt = (q + dq - cap) / (dq || 1) * Pnet; dq = cap - q; }
      q = Math.max(0, q + dq);
      return shunt;
    },
  };
}

// ------------------------------------------------------------------ loads --
export const LOADS = Object.freeze({
  sleepBase_W: 44,               // power electronics, clocks, HRS pump, RTC
  survivalSetpoint_K: 233,       // electronics / battery keep-warm (-40 C)
  survivalGain_W_per_K: 0.35,
  awakeAvionics_W: 110,          // added when awake: RCE, avionics, telecom idle
  actuatorSetpoint_K: 218,       // -55 C minimum operating for gearboxes
  actuatorGain_W_per_K: 3.0,
  actuatorHeaterMax_W: 150,
  uhfTx_W: 38,                   // Electra-Lite transmitting
  xbandTx_W: 95,                 // SSPA for direct-to-Earth
  imaging_W: 25,                 // Mastcam-Z + Navcams
  remoteScience_W: 40,           // SuperCam / MEDA / Mastcam-Z sequence
  arm_W: 85,                     // arm joints + contact instrument (PIXL/SHERLOC)
  drill_W: 190,                  // coring drill percussion + rotation
  sampleHandling_W: 60,          // Adaptive Caching Assembly (tube handling arm, seal)
});

const survivalHeater = (Tair, L = LOADS) => Math.max(0, (L.survivalSetpoint_K - Tair) * L.survivalGain_W_per_K);
const actuatorHeater = (Tair, L = LOADS) =>
  Math.min(L.actuatorHeaterMax_W, Math.max(0, (L.actuatorSetpoint_K - Tair) * L.actuatorGain_W_per_K));

/** Load (W) for an activity mode at an air temperature. `drive` gives the
 * instantaneous mobility state {moving, slopeDeg}. */
export function activityLoad(mode, Tair, drive = null, L = LOADS, r = ROVER) {
  const sleep = L.sleepBase_W + survivalHeater(Tair, L);
  if (mode === 'sleep') return sleep;
  const awake = sleep + L.awakeAvionics_W;
  switch (mode) {
    case 'wake': return awake;
    case 'uhf': return awake + L.uhfTx_W;
    case 'dte': return awake + L.xbandTx_W + actuatorHeater(Tair + 10, L); // pre-heat for the drive
    case 'imaging': return awake + L.imaging_W;
    case 'remote': return awake + L.remoteScience_W + L.imaging_W * 0.5;
    case 'arm': return awake + L.arm_W + actuatorHeater(Tair, L);
    case 'coring': return awake + L.arm_W + L.drill_W + L.sampleHandling_W + actuatorHeater(Tair, L)
      + L.xbandTx_W + L.imaging_W + L.remoteScience_W;
    case 'drive': {
      let p = awake + r.motorController_W + r.vce_W + r.driveCameras_W + actuatorHeater(Tair, L);
      if (drive && drive.moving) p += motorPower(drive.slopeDeg, r) + r.brakeRelease_W;
      return p;
    }
    default: throw new Error(`unknown mode ${mode}`);
  }
}

/** Highest load the model can command: coring with the arm, caching system,
 * X-band, cameras and remote science all on, in a cold worst case (150 K air)
 * where the survival and actuator heaters are at their limits. */
export function peakLoad(L = LOADS, Tair = 150) {
  return activityLoad('coring', Tair, null, L);
}

// ------------------------------------------------------------ sol timeline --
/** A typical drive sol, in LOCAL MEAN SOLAR hours (converted to Earth hours
 * below). Drive length is a distance goal; its duration comes out of the
 * AutoNav simulation. */
export const DRIVE_SOL_PLAN = Object.freeze([
  { at: 3.35, mode: 'uhf', dur: 0.42 },        // pre-dawn orbiter relay
  { at: 8.95, mode: 'wake', dur: 0.20 },       // boot, health check
  { at: 9.15, mode: 'dte', dur: 0.75 },        // X-band uplink + actuator pre-heat
  { at: 9.90, mode: 'arm', dur: 0.45 },        // proximity science at the workspace
  { at: 10.35, mode: 'remote', dur: 0.80 },    // remote sensing
  { at: 11.15, mode: 'imaging', dur: 0.20 },   // pre-drive imaging
  { at: 11.35, mode: 'drive', distance_m: 270, maxDur: 3.0 },
  { mode: 'imaging', dur: 0.55 },              // post-drive workspace/mosaic
  { mode: 'remote', dur: 0.75 },               // post-drive remote sensing / atmospheric obs
  { mode: 'uhf', dur: 0.35 },                  // afternoon relay pass
  { at: 20.40, mode: 'uhf', dur: 0.40 },       // evening relay pass
]);

const LMST_TO_EARTH_H = SOL_H / 24;

/**
 * Simulate one sol. Returns a sampler plus per-step arrays.
 * opts: { plan, socStart, sol (mission age), dt (s), climate, cadence_h, t_end_h }
 */
export function simulateSol(opts = {}) {
  const plan = opts.plan ?? DRIVE_SOL_PLAN;
  const dt = opts.dt ?? 30;
  const climate = opts.climate ?? makeClimate();
  const tEnd = opts.t_end_h ?? SOL_H;
  const r = opts.rover ?? ROVER;
  const slopeFn = opts.slopeFn ?? terrainSlope;

  // Warm up the MMRTG fin temperature over the previous sol.
  const gen = createMMRTG({ sol: opts.sol ?? 0, climate });
  for (let t = -SOL_S; t < 0; t += dt) gen.step(dt, t / 3600 + SOL_H);
  const bat = createBattery({ soc: (opts.socStart ?? 75) / 100 });

  // Resolve plan into absolute Earth-hour windows (drive end set during sim).
  const acts = plan.map((a) => ({ ...a, start: a.at != null ? a.at * LMST_TO_EARTH_H : null }));
  let cursor = 0;
  for (const a of acts) {
    if (a.start == null) a.start = cursor;
    a.end = a.mode === 'drive' ? Infinity : a.start + a.dur * LMST_TO_EARTH_H;
    cursor = a.end;
  }
  const out = { t_h: [], soc: [], mmrtg: [], load: [], mode: [], x_m: [], Tair: [] };
  let x = 0, stepLeft = 0, stopLeft = 0, driveDone = false, driveStats = null;
  for (let i = 0; i * dt <= tEnd * 3600 + 1e-6; i++) {
    const t = i * dt / 3600;
    const c = climate(t);
    let act = acts.find((a) => t >= a.start && t < a.end);
    let mode = act ? act.mode : 'sleep';
    let drv = null;
    if (mode === 'drive') {
      if (!driveStats) { driveStats = { start: t, dist: 0 }; stepLeft = r.stepLength_m; stopLeft = 0; }
      const tooLong = (t - act.start) >= act.maxDur * LMST_TO_EARTH_H;
      if (x >= act.distance_m || tooLong) {
        // Drive complete: close its window and shift later untimed activities.
        act.end = t; driveDone = true; driveStats.end = t; driveStats.dist = x;
        let cur = t;
        for (const a of acts.slice(acts.indexOf(act) + 1)) {
          if (plan[acts.indexOf(a)].at != null) break;
          a.start = cur; a.end = cur + a.dur * LMST_TO_EARTH_H; cur = a.end;
        }
        act = acts.find((a) => t >= a.start && t < a.end);
        mode = act ? act.mode : 'sleep';
      } else {
        // AutoNav: drive one step at speed limited by slip, then stop to image/VO.
        const slope = slopeFn(x);
        let tl = dt;
        let moving = 0;
        while (tl > 0) {
          if (stopLeft > 0) { const u = Math.min(stopLeft, tl); stopLeft -= u; tl -= u; continue; }
          const v = groundSpeed(slopeFn(x), r);
          const u = Math.min(tl, stepLeft / v);
          x += v * u; stepLeft -= v * u; tl -= u; moving += u;
          if (stepLeft <= 1e-9) { stepLeft = r.stepLength_m; stopLeft = r.stopPerStep_s; }
        }
        const f = moving / dt;
        const pMove = activityLoad('drive', c.Tair, { moving: true, slopeDeg: slope });
        const pStop = activityLoad('drive', c.Tair, { moving: false, slopeDeg: slope });
        drv = f * pMove + (1 - f) * pStop;
      }
    }
    const load = drv ?? activityLoad(mode, c.Tair);
    const P = gen.power;
    out.t_h.push(t); out.soc.push(bat.soc * 100); out.mmrtg.push(P); out.load.push(load);
    out.mode.push(mode); out.x_m.push(x); out.Tair.push(c.Tair);
    bat.step(P - load, dt);
    gen.step(dt, t + dt / 3600);
  }
  out.drive = driveStats;
  out.dt = dt;
  return out;
}

/** Resample a sol simulation at a cadence: SOC and MMRTG at the sample time,
 * load averaged over the following interval (as a telemetry bin). */
export function sampleSol(sim, cadence_h = 0.25, tEnd_h = 24.5) {
  const rows = [];
  const per = Math.round(cadence_h * 3600 / sim.dt);
  for (let k = 0; k * cadence_h <= tEnd_h + 1e-9; k++) {
    const i = k * per;
    let s = 0, n = 0;
    for (let j = i; j < i + per && j < sim.load.length; j++) { s += sim.load[j]; n++; }
    rows.push({ time_h: k * cadence_h, battery_soc_pct: sim.soc[i], mmrtg_power_W: sim.mmrtg[i], load_W: s / n });
  }
  return rows;
}
