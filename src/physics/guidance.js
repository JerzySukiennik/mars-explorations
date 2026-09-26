// Launch-ascent guidance laws for the Starship stack (pure ES module).
//
// Everything here is a *control law*: it looks at the current vehicle state
// (and, for the booster return, at a fast-time ballistic prediction of it)
// and returns a thrust direction / throttle. No reference trajectory or
// telemetry is stored here; the flown profile emerges from these laws plus
// the integrated dynamics in ascent.js.
//
//   * boosterPitchProgram  - vertical rise, pitch kick in the launch azimuth,
//                            then zero-angle-of-attack gravity turn (thrust
//                            along the Earth-relative velocity).
//   * ThrottleController   - max-Q throttle bucket (dynamic-pressure limit,
//                            flown as a q-rate envelope: dq/dt is held to a
//                            first-order approach to the limit) plus a sensed-acceleration cap, both with a
//                            finite throttle slew rate (engine throttle
//                            response), clamped to the engine throttle range.
//   * linearTangentPitch   - bilinear/linear-tangent steering for the ship:
//                            tan(pitch) = tan(pitch0) - c * t. This is the
//                            optimal steering law for a vacuum burn in a flat
//                            gravity field; c is found by shooting (ascent.js)
//                            so that the cutoff state has the target apogee.
//   * boostbackDirection   - point the thrust horizontally so the predicted
//                            (drag-inclusive) impact point walks back to the
//                            launch tower; cut off when it gets there.
//   * landingBurn          - "hover-slam" suicide-burn logic: ignite when the
//                            deceleration needed to reach the engine-switch
//                            gate reaches a fraction of the available thrust,
//                            then the 3-engine terminal phase flies a constant
//                            deceleration to zero speed at catch height.

// ---------------------------------------------------------------------------
// Small vector helpers (arrays [x, y, z])
// ---------------------------------------------------------------------------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => { const n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; };

/** Local geocentric frame at position r: up, east, north unit vectors. */
export function localFrame(r) {
  const up = unit(r);
  let east = cross([0, 0, 1], up);
  east = norm(east) > 1e-9 ? unit(east) : [0, 1, 0];
  const north = cross(up, east);
  return { up, east, north };
}

// ---------------------------------------------------------------------------
// Booster ascent: vertical rise + pitch kick + gravity turn
// ---------------------------------------------------------------------------

/**
 * Thrust direction for the stacked ascent.
 * @param {object} s    { t, r, vRel, tTurn } (t in s after clamp release;
 *                       tTurn = time the upper-atmosphere steering began)
 * @param {object} p    { tVertical, tKick, kickDeg, azimuthDeg, pitchRateDeg }
 */
export function boosterPitchProgram(s, p) {
  const { up, east, north } = localFrame(s.r);
  if (s.t < p.tVertical) return up;
  const az = p.azimuthDeg * Math.PI / 180;
  const downrange = add(scale(north, Math.cos(az)), scale(east, Math.sin(az)));
  const kick = p.kickDeg * Math.PI / 180;
  if (s.t < p.tVertical + p.tKick) {
    // Pitch over at a constant rate to the kick angle.
    const a = kick * (s.t - p.tVertical) / p.tKick;
    return add(scale(up, Math.cos(a)), scale(downrange, Math.sin(a)));
  }
  // Gravity turn: once the velocity vector has tipped over past the kick
  // attitude, fly zero angle of attack; until then hold the kick attitude.
  const vDir = unit(s.vRel);
  const vTilt = Math.acos(Math.max(-1, Math.min(1, dot(vDir, up))));
  if (vTilt >= kick) {
    // Above the sensible atmosphere (after max-Q, once q has decayed below
    // qTurn) the booster steers nose-down of its velocity at a constant
    // pitch-over rate, flattening the trajectory toward the staging
    // flight-path angle (a linear approximation of optimal vacuum steering).
    if (s.tTurn !== undefined && s.tTurn !== null && p.pitchRateDeg) {
      const d = (p.pitchRateDeg * (s.t - s.tTurn) * Math.PI) / 180;
      const n = unit(sub(up, scale(vDir, dot(up, vDir))));
      return add(scale(vDir, Math.cos(d)), scale(n, -Math.sin(d)));
    }
    return vDir;
  }
  return add(scale(up, Math.cos(kick)), scale(downrange, Math.sin(kick)));
}

// ---------------------------------------------------------------------------
// Throttle controller (q limit + acceleration cap + slew rate)
// ---------------------------------------------------------------------------
export class ThrottleController {
  /**
   * @param {object} p { qLimit (Pa), accelLimit (m/s^2, sensed), slewUp,
   *                     slewDown (1/s), min, max, qBand, accelHold (m/s^2,
   *                     sensed, held until max-Q has passed), qGain (1/s: set to
   *                     use the q-rate envelope follower instead of the
   *                     proportional q band) }
   */
  constructor(p) {
    this.p = { qBand: 0.25, slewUp: 0.02, slewDown: 0.1, min: 0.4, max: 1, ...p };
    this.tau = this.p.max;
  }

  /**
   * @param {number} dt       step (s)
   * @param {object} s        { q (Pa), thrustPerTau (N of thrust per unit
   *                            throttle, at current back pressure), mass;
   *                            for the q-envelope mode also rho, drhodh,
   *                            speed, hdot (Earth-relative), gAlong
   *                            (g sin gamma, m/s^2) and drag (N) }
   */
  update(dt, s) {
    const p = this.p;
    let cmd = p.max;
    if (p.qLimit && p.qGain && s.rho > 0 && s.speed > 1) {
      // Dynamic-pressure envelope follower. Differentiating q = rho v^2 / 2
      // along the trajectory,
      //   dq/dt = rho v dv/dt + (v^2 / 2) (drho/dh) (dh/dt),
      // and the guidance asks q to close on the limit no faster than a
      // first-order lag: dq/dt <= qGain (qLimit - q). That fixes the largest
      // allowed along-track acceleration dv/dt; the throttle that produces
      // it is thrust = m (dv/dt + g sin(gamma)) + drag (thrust along the
      // velocity in the zero-alpha gravity turn). Far below the limit the
      // allowed rate is large and the engines stay at full throttle; as q
      // builds, the throttle rolls off smoothly, bottoms out near max-Q and
      // recovers on its own once the thinning air takes over.
      const qdotMax = p.qGain * (p.qLimit - s.q);
      const aMax = (qdotMax - 0.5 * s.speed * s.speed * s.drhodh * s.hdot) / (s.rho * s.speed);
      const Fneed = s.mass * (aMax + s.gAlong) + s.drag;
      if (s.thrustPerTau > 0) cmd = Math.min(cmd, Fneed / s.thrustPerTau);
    } else if (p.qLimit && s.q > 0) {
      // Proportional q hold: the command falls linearly from full throttle
      // at q = qLimit * (1 - qBand) to minimum throttle at q = qLimit.
      const x = (s.q / p.qLimit - (1 - p.qBand)) / p.qBand;
      cmd = Math.min(cmd, p.max - (p.max - p.min) * Math.max(0, Math.min(1, x)));
    }
    if (p.accelLimit && s.thrustPerTau > 0) {
      cmd = Math.min(cmd, (p.accelLimit * s.mass) / s.thrustPerTau);
    }
    // Low-altitude load hold: while climbing into max-Q the stack carries
    // aerodynamic bending on top of axial thrust load, so the sensed
    // acceleration is held to a lower limit until the dynamic-pressure peak
    // has clearly passed (q back below 90 % of the peak seen).
    this.qPeak = Math.max(this.qPeak ?? 0, s.q ?? 0);
    if (!this.pastMaxQ && p.qLimit && this.qPeak > 0.5 * p.qLimit && s.q < 0.9 * this.qPeak) this.pastMaxQ = true;
    if (p.accelHold && !this.pastMaxQ && s.thrustPerTau > 0) {
      cmd = Math.min(cmd, (p.accelHold * s.mass) / s.thrustPerTau);
    }
    cmd = Math.max(p.min, Math.min(p.max, cmd));
    const d = cmd - this.tau;
    const lim = d > 0 ? p.slewUp * dt : p.slewDown * dt;
    this.tau += Math.max(-lim, Math.min(lim, d));
    // The acceleration cap is a hard structural limit: never exceed it even
    // while slewing up.
    if (p.accelLimit && s.thrustPerTau > 0) {
      this.tau = Math.min(this.tau, Math.max(p.min, (p.accelLimit * s.mass) / s.thrustPerTau));
    }
    return this.tau;
  }
}

// ---------------------------------------------------------------------------
// Ship: linear-tangent steering in the current orbital plane
// ---------------------------------------------------------------------------

/**
 * Thrust direction for linear-tangent steering.
 * pitch measured from the local (inertial) horizontal in the plane of r, v.
 * @param {object} s  { t (s since ship ignition), r, v (inertial) }
 * @param {object} p  { tanPitch0, rate }
 */
export function linearTangentPitch(s, p) {
  const up = unit(s.r);
  const vh = sub(s.v, scale(up, dot(s.v, up)));
  const horiz = unit(vh);
  const theta = Math.atan(p.tanPitch0 - p.rate * s.t);
  return add(scale(horiz, Math.cos(theta)), scale(up, Math.sin(theta)));
}

/** Osculating two-body apsis altitudes (m) above a sphere of radius R. */
export function apsides(r, v, mu, R) {
  const rr = norm(r), vv = norm(v);
  const energy = vv * vv / 2 - mu / rr;
  const a = -mu / (2 * energy);
  const h = norm(cross(r, v));
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
  return { a, e, perigee: a * (1 - e) - R, apogee: a * (1 + e) - R };
}

// ---------------------------------------------------------------------------
// Booster return: boostback toward the tower and the landing burn
// ---------------------------------------------------------------------------

/**
 * Horizontal (Earth-relative) miss vector of a predicted impact point from
 * the target, projected on the local horizontal at the target.
 */
export function impactMiss(impactR, targetR) {
  const up = unit(targetR);
  const d = sub(impactR, targetR);
  return sub(d, scale(up, dot(d, up)));
}

/**
 * Boostback thrust direction: horizontal, opposite the impact-point miss
 * (so the impact point walks back to the target).
 */
export function boostbackDirection(r, miss) {
  const up = unit(r);
  const m = sub(miss, scale(up, dot(miss, up)));
  return scale(unit(m), -1);
}

/**
 * Hover-slam deceleration demand (m/s^2 of thrust acceleration) to bring the
 * Earth-relative speed from v to vGate over the remaining path to gate
 * altitude hGate, while descending at flight-path angle gamma (<0).
 */
export function decelDemand(v, h, gamma, vGate, hGate, g) {
  const s = Math.max(0.05, Math.sin(-gamma));
  const path = (h - hGate) / s;
  if (path <= 1) return Infinity;
  return (v * v - vGate * vGate) / (2 * path) + g * s;
}

// ---------------------------------------------------------------------------
// Ship: closed-loop insertion guidance (vertical-channel explicit guidance)
// ---------------------------------------------------------------------------

/**
 * Cutoff (insertion) state on a target orbit at radius rT: inertial speed,
 * horizontal speed and radial rate.
 */
export function insertionTarget(mu, R, perigeeAlt, apogeeAlt, insertionAlt) {
  const rp = R + perigeeAlt, ra = R + apogeeAlt, rT = R + insertionAlt;
  const a = 0.5 * (rp + ra);
  const hAng = Math.sqrt(mu * 2 * rp * ra / (rp + ra));
  const v = Math.sqrt(mu * (2 / rT - 1 / a));
  const vh = hAng / rT;
  return { rT, v, vh, hdot: Math.sqrt(Math.max(0, v * v - vh * vh)) };
}

/**
 * Burn time to gain dv with exhaust velocity ve, mass m, mass flow mdot,
 * current thrust F, with an acceleration cap aMax (throttle-down once the
 * cap is reached).
 */
export function timeToGo(dv, ve, m, mdot, F, aMax) {
  if (!(mdot > 0) || !(F > 0)) return Infinity;
  const m1 = Math.min(m, F / aMax);          // mass at which the cap is reached
  const dv1 = ve * Math.log(m / m1);
  if (dv <= dv1) return (m / mdot) * (1 - Math.exp(-dv / ve));
  return (m - m1) / mdot + (dv - dv1) / aMax;
}

/**
 * Thrust direction for the insertion burn. The radial channel flies a
 * linear-in-time vertical acceleration that meets both the target radius
 * and radial rate at cutoff (t_go from the rocket equation); the remaining
 * thrust goes into the in-plane horizontal direction.
 * @param {object} s  { r, v (inertial), aThrust (m/s^2), g (m/s^2) }
 * @param {object} tgt insertionTarget(...)
 * @param {number} tgo s
 */
export function insertionSteering(s, tgt, tgo) {
  const up = unit(s.r);
  const rr = norm(s.r);
  const hdot = dot(s.v, up);
  const vhVec = sub(s.v, scale(up, hdot));
  const vh = norm(vhVec);
  const T = Math.max(tgo, 8);
  const a0 = (6 * (tgt.rT - rr - hdot * T)) / (T * T) - (2 * (tgt.hdot - hdot)) / T;
  const need = a0 + s.g - (vh * vh) / rr;               // net of centrifugal relief
  const sinT = Math.max(-0.8, Math.min(0.8, need / s.aThrust));
  return add(scale(unit(vhVec), Math.sqrt(1 - sinT * sinT)), scale(up, sinT));
}
