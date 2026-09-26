// Mars propulsive landing: belly-flop fall, flip, landing burn, touchdown.
//
// Pure ES module. 2-D (x downrange, y up), rigid ship with attitude theta
// (0 = upright, +90 = belly-flop with the nose pointing downrange).
// Gravity from src/physics/mars_body.js (`B`: mu / rMean -> 3.72 m/s^2),
// density/pressure from src/physics/mars_atmosphere.js (`A`), Raptor thrust at
// Mars ambient pressure from src/physics/vehicle.js (`V`); all feature-detected.

import { densityFn } from './entry.js';

export const LANDING_LIMITS = Object.freeze({
  vyGood: 2.0, vyOk: 4.0, vyCrash: 6.0,     // m/s vertical at touchdown (legs)
  vxOk: 1.0, vxCrash: 3.0,                   // m/s horizontal
  tiltCrash: 12,                             // deg
  padRadius: 25,                             // m
});

export function marsGravity(B) {
  const m = B?.MARS;
  if (m && m.mu && m.rMean) return m.mu / (m.rMean * m.rMean);
  return 3.71;
}

function engineModel(V) {
  if (V && V.SHIP && typeof V.thrust === 'function') {
    const g = V.SHIP.engines.find((x) => !/vac/i.test(x.engine.name || '')) || V.SHIP.engines[0];
    return {
      thrust: (pa, thr) => V.thrust(g.engine, pa, thr),
      mdot: (thr) => V.massFlow(g.engine, thr),
      throttleMin: g.engine.throttleMin ?? 0.4, count: g.count, source: 'physics/vehicle.js',
    };
  }
  return {
    thrust: (pa, thr) => thr <= 0 ? 0 : Math.max(0, 2.46e6 * Math.max(0.4, Math.min(1, thr)) - pa * 1.327),
    mdot: (thr) => thr <= 0 ? 0 : 703 * Math.max(0.4, Math.min(1, thr)),
    throttleMin: 0.4, count: 3, source: 'fallback',
  };
}

export function createLanding(opts = {}) {
  const g = marsGravity(opts.B);
  const eng = engineModel(opts.V);
  const rho = densityFn(opts.A);
  const pres = typeof opts.A?.pressure === 'function' ? (z) => opts.A.pressure(Math.max(0, z)) : (z) => 636 * Math.exp(-Math.max(0, z) / 11100);
  const s = {
    g, eng, rho, pres,
    dry: opts.dryMass ?? 200e3,               // ship + payload
    prop: opts.propKg ?? 100e3,
    x: 0, y: opts.altitude ?? 8000,
    vx: opts.vx ?? 400, vy: opts.vy ?? -250,
    theta: 80, omega: 0,                       // deg, deg/s
    throttle: 0, enginesOn: 0, enginesWanted: 3,
    t: 0, mode: 'fall',                        // fall | flip | burn | landed | crashed
    flipT: null, padX: 0, failReason: null, touchdown: null,
    peakG: 0,
  };
  // Put the pad at the ballistic impact point of the belly-flop fall, shifted
  // by the entry miss distance and short of it by the typical flip divert.
  s.padX = 0;
  if (opts.padX != null) s.padX = opts.padX;
  else {
    const probe = { ...s };
    for (let i = 0; i < 20000 && probe.mode !== 'landed' && probe.mode !== 'crashed'; i++) stepLanding(probe, 0.05, landingAutopilot(probe, true));
    s.padX = probe.x;
  }
  s.padX += Math.max(-3000, Math.min(3000, opts.missM ?? 0));
  return s;
}

function aero(s, rho) {
  // belly (normal) area 450 m^2 Cd 1.2; tail-first 64 m^2 Cd 0.8; blend by attitude vs velocity
  const v = Math.hypot(s.vx, s.vy);
  if (v < 1e-3) return [0, 0];
  // In the belly-flop the flaps hold the belly into the relative wind; after the
  // flip, drag depends on the angle between the body axis and the wind.
  const aoa = (s.theta * Math.PI / 180) - Math.atan2(-s.vx, -s.vy);
  const sn = s.mode === 'fall' ? 1 : Math.sin(aoa) ** 2;
  const CdA = 0.8 * 64 * (1 - sn) + 1.2 * 450 * sn;
  const D = 0.5 * rho * v * v * CdA;
  const m = s.dry + s.prop;
  return [-D / m * s.vx / v, -D / m * s.vy / v];
}

/** Predict the unpowered impact x from the current state (belly-flop fall). */
export function predictImpactX(s0) {
  const s = { ...s0 };
  for (let i = 0; i < 20000 && s.y > 0; i++) {
    const [ax, ay] = aero(s, s.rho(s.y));
    s.vx += ax * 0.05; s.vy += (ay - s.g) * 0.05;
    s.x += s.vx * 0.05; s.y += s.vy * 0.05;
  }
  return s.x;
}

/** Attitude (deg) that points the thrust against the velocity, limited to +-70. */
export function retroDeg(s) {
  return Math.max(-70, Math.min(70, Math.atan2(-s.vx, -s.vy) * 180 / Math.PI));
}

export function maxAccel(s, n = s.enginesWanted) {
  return n * s.eng.thrust(s.pres(s.y), 1) / (s.dry + s.prop);
}

/**
 * controls: { throttle 0..1, tilt -1..1 (attitude rate command), flip bool,
 * engines 1..3, cutoff bool }
 */
export function stepLanding(s, dt, c = {}) {
  if (s.mode === 'landed' || s.mode === 'crashed') return s;
  const sub = Math.max(1, Math.ceil(dt / 0.02)), h = dt / sub;
  for (let i = 0; i < sub && s.mode !== 'landed' && s.mode !== 'crashed'; i++) step1(s, h, c);
  return s;
}

function step1(s, dt, c) {
  s.t += dt;
  if (c.engines) s.enginesWanted = Math.max(1, Math.min(s.eng.count, c.engines | 0));
  if (c.flip && s.mode === 'fall') { s.mode = 'flip'; s.flipT = s.t; }
  if (s.mode === 'flip') {
    // Flip: engines light and swing the ship upright (~25 deg/s); aero helps.
    s.enginesOn = s.enginesWanted; s.throttle = Math.max(s.throttle, s.eng.throttleMin);
    const target = retroDeg(s);                                        // point the engines along the velocity
    const d = target - s.theta;
    s.omega = Math.sign(d) * Math.min(25, Math.abs(d) * 3);
    if (Math.abs(d) < 2) s.mode = 'burn';
  } else if (s.mode === 'burn') {
    s.enginesOn = c.cutoff ? 0 : s.enginesWanted;
    const rate = s.enginesOn ? 12 : 3;
    s.omega = (c.tilt ?? 0) * rate;
  } else {
    s.enginesOn = 0;
    s.omega = (c.tilt ?? 0) * 3;           // flaps only
  }
  if (c.throttle != null && s.mode !== 'fall') s.throttle = Math.max(s.eng.throttleMin, Math.min(1, c.throttle));
  s.theta = Math.max(-100, Math.min(100, s.theta + s.omega * dt));

  const pa = s.pres(s.y);
  const lit = s.prop > 0 ? s.enginesOn : 0;
  const F = lit * s.eng.thrust(pa, s.throttle);
  const md = lit * s.eng.mdot(s.throttle);
  s.prop = Math.max(0, s.prop - md * dt);
  const m = s.dry + s.prop;
  const th = s.theta * Math.PI / 180;
  // thrust along the body axis (engines at the tail push toward the nose)
  const tx = F / m * Math.sin(th), ty = F / m * Math.cos(th);
  const [ax, ay] = aero(s, s.rho(s.y));
  const accX = tx + ax, accY = ty + ay - s.g;
  s.peakG = Math.max(s.peakG, Math.hypot(tx + ax, ty + ay) / 9.80665);
  s.vx += accX * dt; s.vy += accY * dt;
  s.x += s.vx * dt; s.y += s.vy * dt;
  s.accel = Math.hypot(accX, accY + s.g);
  if (s.y <= 0) touchdown(s);
}

function touchdown(s) {
  s.y = 0;
  const L = LANDING_LIMITS;
  const td = { vy: -s.vy, vx: Math.abs(s.vx), tilt: Math.abs(s.theta), dist: Math.abs(s.x - s.padX), prop: s.prop };
  s.touchdown = td;
  if (td.vy > L.vyCrash) { s.mode = 'crashed'; s.failReason = `Hard impact: ${td.vy.toFixed(1)} m/s vertical`; }
  else if (td.vx > L.vxCrash) { s.mode = 'crashed'; s.failReason = `Tipped over: ${td.vx.toFixed(1)} m/s lateral`; }
  else if (td.tilt > L.tiltCrash) { s.mode = 'crashed'; s.failReason = `Tipped over: ${td.tilt.toFixed(0)} deg tilt`; }
  else s.mode = 'landed';
  s.vx = s.vy = 0; s.enginesOn = 0;
}

/**
 * Landing autopilot: returns controls. Flip when the retrograde burn needs the
 * remaining height, fly a gravity-turn (retrograde) burn to kill horizontal
 * speed, then a terminal descent onto the pad on one engine.
 * `ballistic` = ignore the pad (used to place the pad at the nominal touchdown).
 */
export function landingAutopilot(s, ballistic = false) {
  const c = { engines: 3 };
  const aMax = maxAccel(s, 3);
  const v = Math.hypot(s.vx, s.vy);
  const vyAbs = Math.max(0, -s.vy);
  if (s.mode === 'fall') {
    const tb = v / Math.max(1, 0.7 * aMax);
    if (s.y < vyAbs * (tb / 2 + 4) * 1.15 + 400) c.flip = true;
    return c;
  }
  if (s.mode === 'flip') return c;
  const dx = ballistic ? 0 : s.padX - s.x;
  let thetaDes;
  const terminal = Math.abs(s.vx) < 25 || s.y < 600;
  if (!terminal) thetaDes = retroDeg(s);
  else {
    const vMax = s.y < 60 ? 0 : Math.min(30, s.y / 10);
    const vxDes = ballistic ? 0 : Math.max(-vMax, Math.min(vMax, dx / Math.max(3, s.y / 40 + 3)));
    const axDes = Math.max(-5, Math.min(5, (vxDes - s.vx) * 0.5));
    thetaDes = Math.max(-15, Math.min(15, Math.atan2(axDes, s.g + 2) * 180 / Math.PI));
    if (s.y < 25) thetaDes = Math.max(-3, Math.min(3, thetaDes));
  }
  c.tilt = Math.max(-1, Math.min(1, (thetaDes - s.theta) / 4));
  const cos = Math.max(0.35, Math.cos(s.theta * Math.PI / 180));
  if (!terminal) {
    // gravity-turn braking: all engines, throttle by how much speed is left
    c.engines = 3;
    const aReq = (s.vy * s.vy) / (2 * Math.max(1, s.y - 50)) + s.g;
    c.throttle = Math.max(Math.min(1, Math.abs(s.vx) / 120), Math.min(1, aReq / (aMax * cos)));
    return c;
  }
  // terminal: constant-deceleration (hoverslam) law to ~1 m/s at the surface.
  // One Raptor at minimum throttle out-thrusts the ship's Mars weight, so the
  // ship cannot hover: coast engines-off until the burn is needed.
  const vT = 1.0;
  const aReq = Math.max(0, (s.vy * s.vy - vT * vT)) / (2 * Math.max(0.5, s.y)) * (s.vy < 0 ? 1 : -1) + s.g;
  const aMin1 = maxAccel(s, 1) * s.eng.throttleMin * cos;
  const lit = s.enginesOn > 0;
  if ((!lit && aReq < 0.6 * maxAccel(s, 3) * cos) || (lit && aReq < aMin1 * 0.92 && s.vy > -4) || s.vy > 0.5) {
    c.cutoff = true; c.engines = 1; c.throttle = s.eng.throttleMin;
    return c;
  }
  let engines = 3;
  for (const n of [1, 2, 3]) { if (maxAccel(s, n) * cos * 0.97 >= aReq) { engines = n; break; } }
  c.engines = engines;
  c.throttle = Math.max(0, Math.min(1, aReq / (maxAccel(s, engines) * cos)));
  return c;
}

export function landingResult(s) {
  return {
    success: s.mode === 'landed',
    touchdown: s.touchdown, propKg: s.prop, peakG: s.peakG, t: s.t,
    failReason: s.failReason,
  };
}
