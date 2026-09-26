// General two-body + J2 orbital propagator (Earth and Mars).
//
// Pure ES module, SI units. Frame: body-centred inertial, +z along the body's
// spin axis (so the J2 term is axisymmetric about z). State = {r:[x,y,z], v:[..]}.
//
//   a = -mu r / |r|^3 + a_J2
//   a_J2 = -(3/2) J2 mu R^2 / r^5 * [ x (1 - 5 z^2/r^2),
//                                     y (1 - 5 z^2/r^2),
//                                     z (3 - 5 z^2/r^2) ]
//
// Integrator: classical RK4 (fixed step) with an optional adaptive wrapper
// (step ~ eta * local dynamical time sqrt(r^3/mu)).
//
// The "measure*" functions below are numerical experiments on the propagator:
// they only ever integrate trajectories and observe them (crossing times,
// fall distances, node angles); no closed-form orbit formula is used.

// ---------------------------------------------------------------- vectors
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.sqrt(dot(a, a));
export const vec = { add, sub, scale, dot, cross, norm };

// ---------------------------------------------------------------- dynamics
/** Gravitational acceleration (m/s^2) of `body` at inertial position r (m). */
export function gravityAccel(body, r, { j2 = true } = {}) {
  const [x, y, z] = r;
  const r2 = x * x + y * y + z * z;
  const rn = Math.sqrt(r2);
  const k = -body.mu / (r2 * rn);
  let ax = k * x, ay = k * y, az = k * z;
  if (j2 && body.j2) {
    const R = body.j2RefRadius ?? body.rEq;
    const f = -1.5 * body.j2 * body.mu * R * R / (r2 * r2 * rn);
    const zz = 5 * z * z / r2;
    ax += f * x * (1 - zz);
    ay += f * y * (1 - zz);
    az += f * z * (3 - zz);
  }
  return [ax, ay, az];
}

/** One RK4 step of the state {r, v} under accelFn(r, t). */
export function rk4Step(state, dt, accelFn, t = 0) {
  const { r, v } = state;
  const a1 = accelFn(r, t);
  const r2 = add(r, scale(v, dt / 2)), v2 = add(v, scale(a1, dt / 2));
  const a2 = accelFn(r2, t + dt / 2);
  const r3 = add(r, scale(v2, dt / 2)), v3 = add(v, scale(a2, dt / 2));
  const a3 = accelFn(r3, t + dt / 2);
  const r4 = add(r, scale(v3, dt)), v4 = add(v, scale(a3, dt));
  const a4 = accelFn(r4, t + dt);
  return {
    r: add(r, scale(add(add(v, scale(v2, 2)), add(scale(v3, 2), v4)), dt / 6)),
    v: add(v, scale(add(add(a1, scale(a2, 2)), add(scale(a3, 2), a4)), dt / 6)),
  };
}

/** Make an accel function for a body (two-body + J2 by default). */
export function makeAccel(body, opts = {}) {
  return (r) => gravityAccel(body, r, opts);
}

/**
 * Propagate `state` for `duration` seconds with fixed step `dt`.
 * onStep(t, state) is called after each step; return true from it to stop.
 */
export function propagate(body, state, duration, dt, { j2 = true, onStep } = {}) {
  const acc = makeAccel(body, { j2 });
  let s = { r: [...state.r], v: [...state.v] };
  let t = 0;
  while (t < duration - 1e-12) {
    const h = Math.min(dt, duration - t);
    s = rk4Step(s, h, acc, t);
    t += h;
    if (onStep && onStep(t, s)) break;
  }
  return { t, state: s };
}

/** Game-loop helper: advance by `dt` using substeps no longer than maxStep. */
export function advance(body, state, dt, maxStep = 10, opts = {}) {
  const n = Math.max(1, Math.ceil(Math.abs(dt) / maxStep));
  const acc = makeAccel(body, opts);
  let s = state;
  for (let i = 0; i < n; i++) s = rk4Step(s, dt / n, acc);
  return s;
}

// ---------------------------------------------------------------- elements
/** Classical elements -> state (inertial, z = spin axis). Angles in rad. */
export function elementsToState(mu, { a, e = 0, inc = 0, raan = 0, argp = 0, nu = 0 }) {
  const p = a * (1 - e * e);
  const rPf = p / (1 + e * Math.cos(nu));
  const rp = [rPf * Math.cos(nu), rPf * Math.sin(nu), 0];
  const vk = Math.sqrt(mu / p);
  const vp = [-vk * Math.sin(nu), vk * (e + Math.cos(nu)), 0];
  const cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(inc), si = Math.sin(inc);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const rot = (q) => {
    const x1 = cw * q[0] - sw * q[1], y1 = sw * q[0] + cw * q[1];
    const y2 = ci * y1, z2 = si * y1;
    return [cO * x1 - sO * y2, sO * x1 + cO * y2, z2];
  };
  return { r: rot(rp), v: rot(vp) };
}

/** Osculating elements from a state. */
export function stateToElements(mu, { r, v }) {
  const h = cross(r, v);
  const rn = norm(r), hn = norm(h);
  const n = [-h[1], h[0], 0];
  const nn = norm(n);
  const eVec = sub(scale(cross(v, h), 1 / mu), scale(r, 1 / rn));
  const e = norm(eVec);
  const energy = dot(v, v) / 2 - mu / rn;
  const a = -mu / (2 * energy);
  const inc = Math.acos(h[2] / hn);
  const raan = nn > 0 ? Math.atan2(h[0], -h[1]) : 0;
  return { a, e, inc, raan, h: hn, energy };
}

/** Right ascension of the ascending node of the osculating orbit (rad). */
export const nodeLongitude = (s) => { const h = cross(s.r, s.v); return Math.atan2(h[0], -h[1]); };

// ---------------------------------------------------------------- experiments
// Angle swept in the orbit plane from r0 to r, in [0, 2pi).
function sweptAngle(r0, hHat, r) {
  const ang = Math.atan2(dot(hHat, cross(r0, r)), dot(r0, r));
  return ang < 0 ? ang + 2 * Math.PI : ang;
}

/**
 * Propagate until the trajectory has swept `target` radians (0 < target <= 2pi)
 * in its plane, as seen from the initial position. The crossing time is refined
 * by bisecting the length of the final RK4 step. Returns {t, state}.
 */
export function timeToSweep(body, state, target, dt, { j2 = true, maxTime = 1e9 } = {}) {
  const acc = makeAccel(body, { j2 });
  const r0 = state.r;
  const h0 = cross(state.r, state.v);
  const hHat = scale(h0, 1 / norm(h0));
  const unwrap = (s, prevUnwrapped) => {
    let a = sweptAngle(r0, hHat, s.r);
    const turns = Math.floor(prevUnwrapped / (2 * Math.PI));
    a += turns * 2 * Math.PI;
    if (a < prevUnwrapped - Math.PI) a += 2 * Math.PI;
    return a;
  };
  let s = state, t = 0, ang = 0;
  while (t < maxTime) {
    const next = rk4Step(s, dt, acc, t);
    const angNext = unwrap(next, ang);
    if (angNext >= target) {
      let lo = 0, hi = dt;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const trial = rk4Step(s, mid, acc, t);
        if (unwrap(trial, ang) >= target) hi = mid; else lo = mid;
      }
      return { t: t + hi, state: rk4Step(s, hi, acc, t) };
    }
    s = next; t += dt; ang = angNext;
  }
  throw new Error('timeToSweep: target not reached');
}

/** Sidereal orbital period (s): time to sweep 2pi, circular start at radius r. */
export function measureCircularPeriod(body, radius, { inc = 0, dt, j2 = true, speed } = {}) {
  const v0 = speed ?? measureCircularSpeed(body, radius, { inc, j2 });
  const st = { r: [radius, 0, 0], v: [0, v0 * Math.cos(inc), v0 * Math.sin(inc)] };
  const step = dt ?? orbitStep(body, radius);
  return timeToSweep(body, st, 2 * Math.PI, step, { j2 }).t;
}

function orbitStep(body, radius) {
  // ~2000 RK4 steps per revolution (local dynamical time / 320).
  return Math.sqrt(radius ** 3 / body.mu) * 2 * Math.PI / 2000;
}

/**
 * Circular orbit speed (m/s) at `radius`, found by shooting: launch
 * horizontally at speed v, propagate half a revolution, and adjust v (secant)
 * until the radius on the far side equals the starting radius.
 */
export function measureCircularSpeed(body, radius, { inc = 0, j2 = true } = {}) {
  const step = orbitStep(body, radius);
  const miss = (v) => {
    const st = { r: [radius, 0, 0], v: [0, v * Math.cos(inc), v * Math.sin(inc)] };
    const { state } = timeToSweep(body, st, Math.PI, step, { j2 });
    return norm(state.r) - radius;
  };
  // initial guesses from the local acceleration (v^2/r = g), then secant
  const g = norm(gravityAccel(body, [radius, 0, 0], { j2 }));
  let v0 = Math.sqrt(g * radius) * 0.99, v1 = Math.sqrt(g * radius) * 1.01;
  let f0 = miss(v0), f1 = miss(v1);
  for (let i = 0; i < 30 && Math.abs(f1) > 1e-6 * radius * 1e-3; i++) {
    const v2 = v1 - f1 * (v1 - v0) / (f1 - f0);
    v0 = v1; f0 = f1; v1 = v2; f1 = miss(v1);
  }
  return v1;
}

/**
 * Effective surface gravity (m/s^2) at the equator on `radius`, by a drop
 * test: a particle released at rest relative to the rotating surface is
 * propagated inertially for tDrop seconds; g = 2 d / t^2 where d is its
 * separation from the co-rotating release point.
 */
export function measureSurfaceGravity(body, radius = body.rEq, { tDrop = 2, dt = 0.01, j2 = true } = {}) {
  const w = body.spinRate;
  const st = { r: [radius, 0, 0], v: [0, w * radius, 0] };
  const { state } = propagate(body, st, tDrop, dt, { j2 });
  const surf = [radius * Math.cos(w * tDrop), radius * Math.sin(w * tDrop), 0];
  return 2 * norm(sub(state.r, surf)) / (tDrop * tDrop);
}

/**
 * Does a radial launch at speed v from `radius` escape? The trajectory is
 * propagated (adaptive RK4) for `horizon` seconds; it has escaped if it has
 * not fallen back to the launch radius by then.
 */
export function escapes(body, radius, v, { horizon = 20000 * 86400, eta = 0.004, j2 = true } = {}) {
  const acc = makeAccel(body, { j2 });
  let s = { r: [radius, 0, 0], v: [v, 0, 0] }, t = 0;
  while (t < horizon) {
    const rn = norm(s.r);
    const dt = Math.min(eta * Math.sqrt(rn ** 3 / body.mu), horizon - t);
    s = rk4Step(s, dt, acc, t);
    t += dt;
    if (norm(s.r) < radius && dot(s.r, s.v) < 0) return false;
  }
  return true;
}

/** Escape velocity (m/s) from `radius` by bisection on escapes(). */
export function measureEscapeVelocity(body, radius = body.rMean, opts = {}) {
  const g = norm(gravityAccel(body, [radius, 0, 0], opts));
  let lo = Math.sqrt(g * radius), hi = 2 * lo;   // circular < escape < 2x circular
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (escapes(body, radius, mid, opts)) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Body sidereal rotation period (s): integrate the spin angle
 * d(theta)/dt = spinRate (torque-free principal-axis rotation) with RK4
 * until it completes one turn.
 */
export function measureSiderealDay(body, dt = 1) {
  const f = () => body.spinRate;
  let th = 0, t = 0;
  for (;;) {
    const k1 = f(), k2 = f(), k3 = f(), k4 = f();
    const next = th + dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
    if (next >= 2 * Math.PI) return t + dt * (2 * Math.PI - th) / (next - th);
    th = next; t += dt;
  }
}

/** Synchronous (stationary) orbit radius (m): secant on radius until the
 *  propagated circular period equals the propagated sidereal day. */
export function measureStationaryRadius(body, { j2 = true } = {}) {
  const day = measureSiderealDay(body);
  const err = (r) => measureCircularPeriod(body, r, { j2 }) - day;
  // bracket from the surface gravity scale: start at 5 and 7 body radii
  let r0 = 5 * body.rEq, r1 = 7 * body.rEq, f0 = err(r0), f1 = err(r1);
  for (let i = 0; i < 40 && Math.abs(f1) > 1e-4; i++) {
    const r2 = r1 - f1 * (r1 - r0) / (f1 - f0);
    r0 = r1; f0 = f1; r1 = r2; f1 = err(r1);
  }
  return r1;
}

/**
 * Secular nodal regression rate (rad/s) of a circular orbit of radius
 * `radius` and inclination `inc`: propagate `days` days and least-squares fit
 * the unwrapped osculating node longitude against time.
 */
export function measureNodalRate(body, radius, inc, { days = 5, dt = 5 } = {}) {
  const v0 = Math.sqrt(norm(gravityAccel(body, [radius, 0, 0], { j2: false })) * radius);
  const st = { r: [radius, 0, 0], v: [0, v0 * Math.cos(inc), v0 * Math.sin(inc)] };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0, prev = nodeLongitude(st), off = 0;
  propagate(body, st, days * 86400, dt, {
    onStep(t, s) {
      let om = nodeLongitude(s) + off;
      if (om - prev > Math.PI) { off -= 2 * Math.PI; om -= 2 * Math.PI; }
      if (om - prev < -Math.PI) { off += 2 * Math.PI; om += 2 * Math.PI; }
      prev = om;
      sx += t; sy += om; sxx += t * t; sxy += t * om; n++;
    },
  });
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
