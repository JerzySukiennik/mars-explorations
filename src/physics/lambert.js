// Robust single-revolution Lambert solver (universal variables, Bate-Mueller-White /
// Curtis Alg. 5.2 formulation) using a bracketed Newton/bisection on z, so it
// never diverges. Pure ES module. Units are whatever mu/r/dt are consistent in.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.sqrt(dot(a, a));

export function stumpffS(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120 + z * z / 5040;
}
export function stumpffC(z) {
  if (z > 1e-6) { const h = Math.sin(Math.sqrt(z) / 2); return 2 * h * h / z; }
  if (z < -1e-6) { const h = Math.sinh(Math.sqrt(-z) / 2); return 2 * h * h / (-z); }
  return 0.5 - z / 24 + z * z / 720;
}

/**
 * Solve Lambert's problem: find v1, v2 of the conic from r1 to r2 in time dt.
 * @param {number[]} r1, r2 position vectors
 * @param {number} dt time of flight (>0)
 * @param {number} mu gravitational parameter
 * @param {object} [opt] { prograde=true, pole=[0,0,1] } prograde = angular momentum along pole
 * @returns {{v1:number[], v2:number[], theta:number, z:number}|null}
 */
export function lambert(r1, r2, dt, mu, opt = {}) {
  const prograde = opt.prograde ?? true;
  const pole = opt.pole ?? [0, 0, 1];
  const R1 = norm(r1), R2 = norm(r2);
  const cth = Math.max(-1, Math.min(1, dot(r1, r2) / (R1 * R2)));
  let theta = Math.acos(cth);
  const cz = dot(cross(r1, r2), pole);
  if ((prograde && cz < 0) || (!prograde && cz >= 0)) theta = 2 * Math.PI - theta;
  if (1 - Math.cos(theta) < 1e-12) return null;           // 0 deg: degenerate
  const A = Math.sin(theta) * Math.sqrt(R1 * R2 / (1 - Math.cos(theta)));
  if (Math.abs(A) < 1e-12 * Math.sqrt(R1 * R2)) return null; // 180 deg: plane undefined
  const sqmu = Math.sqrt(mu);
  const y = (z) => R1 + R2 + A * (z * stumpffS(z) - 1) / Math.sqrt(stumpffC(z));
  // time of flight as a function of z (monotonically increasing where y>0)
  const tof = (z) => {
    const yy = y(z);
    if (yy < 0) return -Infinity;
    return ((yy / stumpffC(z)) ** 1.5 * stumpffS(z) + A * Math.sqrt(yy)) / sqmu;
  };
  // bracket: upper bound just below 4 pi^2 (single rev), lower bound decreasing
  let hi = 4 * Math.PI * Math.PI * (1 - 1e-7);
  const tHi = tof(hi);
  if (!(tHi >= dt)) return null;
  let lo = -4;
  while (tof(lo) > dt) { lo *= 2; if (lo < -1e6) return null; }
  // if A>0, y(lo) may be negative at lo: tof=-inf < dt, fine for bisection
  let z = 0.5 * (lo + hi);
  for (let k = 0; k < 200; k++) {
    z = 0.5 * (lo + hi);
    const t = tof(z);
    if (t < dt) lo = z; else hi = z;
    if (Math.abs(t - dt) < 1e-11 * dt || hi - lo < 1e-14) break;
  }
  const yy = y(z);
  const f = 1 - yy / R1, g = A * Math.sqrt(yy / mu), gd = 1 - yy / R2;
  const v1 = [0, 1, 2].map((i) => (r2[i] - f * r1[i]) / g);
  const v2 = [0, 1, 2].map((i) => (gd * r2[i] - r1[i]) / g);
  return { v1, v2, theta, z };
}

export const vec = { sub, dot, cross, norm };
