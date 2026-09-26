// Liftoff ascent for the launch scene: 1-D vertical point-mass integration of
// the full stack using the Raptor/Starship model in src/physics/vehicle.js.
//
// Timeline (webcast clock, T = 0 at the "liftoff" call):
//   engine start sequence  T-3.0 s ... T-0.5 s (33 Raptors ramp, staggered)
//   hold-down release      when thrust > weight (clamps open)
// After release the throttle keeps ramping to 100 % over RAMP s (engine spool
// plus the flight computer's gradual throttle-up while close to the pad),
// which is why the vehicle crawls off the mount in the first seconds.
import { CONFIGS, DEFAULT_CONFIG, stageThrust, stageMassFlow, G0, P_SL } from '../physics/vehicle.js';

export const OLM_DECK = 21;       // m, height of booster engine plane on the mount (approx.)

export function simulateAscent(tEnd = 10, {
  config = CONFIGS[DEFAULT_CONFIG],
  tStart = -3.0,                   // engine start
  thrStart = 0.40, thrRelease = 0.78, // throttle at start, at nominal release
  tRelease = 0.0, ramp = 7.0,      // s after release to reach 100 %
  dt = 0.01,
} = {}) {
  const { booster, ship } = config;
  let m = booster.dryMass + booster.propMass + ship.dryMass + ship.propMass;
  let h = 0, v = 0, released = false, t = tStart;
  const thr = (t) => {
    if (t < tRelease) return thrStart + (thrRelease - thrStart) * (t - tStart) / (tRelease - tStart);
    return Math.min(1, thrRelease + (1 - thrRelease) * (t - tRelease) / ramp);
  };
  const out = [];
  while (t < tEnd - 1e-9) {
    const th = thr(t);
    const F = stageThrust(booster, P_SL, th);
    m -= stageMassFlow(booster, th) * dt;
    const W = m * G0;
    if (!released && t >= tRelease && F > W * 1.02) released = true;
    if (released) {
      // quadratic drag, Cd~0.6 on the 9 m disc (negligible this early)
      const D = 0.5 * 1.2 * v * Math.abs(v) * 0.6 * Math.PI * 4.5 * 4.5;
      const a = (F - W - D) / m;
      v += a * dt; h += v * dt;
    }
    t += dt;
    out.push({ t, h, v, m, thrust: F, throttle: th });
  }
  return { h, v, m, released, trace: out };
}
