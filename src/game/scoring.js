// Scoring for each phase. Pure functions of the phase result; each returns
// { score 0..1000, grade, parts: [[label, points]] }.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lin = (x, x0, x1) => clamp((x - x0) / (x1 - x0), 0, 1); // 0 at x0 .. 1 at x1

export function grade(score) {
  return score >= 900 ? 'A' : score >= 750 ? 'B' : score >= 550 ? 'C' : score >= 300 ? 'D' : 'F';
}

function pack(parts) {
  const score = Math.round(clamp(parts.reduce((a, p) => a + p[1], 0), 0, 1000));
  return { score, grade: grade(score), parts: parts.map(([l, v]) => [l, Math.round(v)]) };
}

/** Launch: orbit reached, propellant margin, max-Q discipline, booster return. */
export function scoreLaunch(r) {
  if (!r?.success) return pack([['Orbit not reached', 0]]);
  const circ = r.apoKm - r.periKm;
  return pack([
    ['Orbit achieved', 400],
    ['Propellant in orbit', 300 * lin(r.shipPropKg, 0, 80e3)],
    ['Orbit circularity', 100 * (1 - lin(circ, 5, 80))],
    ['Max-Q below 35 kPa', r.maxQkPa <= 35 ? 100 : 100 * (1 - lin(r.maxQkPa, 35, 50))],
    [`Booster: ${r.boosterOutcome}`, r.boosterOutcome === 'CAUGHT' ? 100 : r.boosterOutcome === 'SOFT SPLASHDOWN' ? 40 : 0],
  ]);
}

/** Refill: propellant loaded vs requirement, boil-off discipline, docking skill. */
export function scoreRefill(r, requiredKg = 800e3) {
  if (!r?.success) return pack([['Refilling incomplete', 0]]);
  const fill = r.shipPropKg / requiredKg;
  return pack([
    ['Propellant for TMI + landing', 550 * clamp(fill, 0, 1)],
    ['Boil-off kept low', 150 * (1 - lin(r.boiloffKg, 5e3, 60e3))],
    ['Manual dockings', 50 * clamp(r.manualDockings, 0, 4)],
    ['Soft captures', r.tankers ? 100 * (1 - lin(r.meanDockSpeed, 0.08, 0.3)) : 0],
  ]);
}

/** Transfer: C3 efficiency vs the window minimum, burn accuracy, reserve kept. */
export function scoreTransfer(r, minC3 = r?.c3) {
  if (!r?.success) return pack([['No Mars encounter', 0]]);
  return pack([
    ['Mars encounter', 350],
    ['Departure energy (C3)', 250 * (1 - lin(r.c3 - minC3, 0, 15))],
    ['Burn accuracy', r.tcm ? 120 : 200 * (1 - lin(Math.abs(r.residual), 1, 40))],
    ['Landing reserve kept', 200 * lin(r.shipPropKg, 40e3, 100e3)],
  ]);
}

/** Entry: survived, g and heat margins, handoff near the target. */
export function scoreEntry(r) {
  if (!r?.success) return pack([['Entry failed', 0]]);
  return pack([
    ['Survived entry', 400],
    ['Peak g margin', 200 * (1 - lin(r.peakG, 3, 6))],
    ['Peak heating margin', 200 * (1 - lin(r.peakHeatKW, 300, 900))],
    ['On target', 200 * (1 - lin(Math.abs(r.missKm), 5, 150))],
  ]);
}

/**
 * Landing: touchdown speed is the headline (Mars g = 3.71 m/s^2 makes a
 * hoverslam mandatory), then lateral speed, tilt, pad accuracy, propellant.
 */
export function scoreLanding(r) {
  if (!r?.success || !r.touchdown) return pack([['Vehicle lost', 0]]);
  const t = r.touchdown;
  return pack([
    ['Touchdown', 250],
    ['Vertical speed', 300 * (1 - lin(t.vy, 1, 6))],
    ['Lateral speed', 100 * (1 - lin(t.vx, 0.2, 3))],
    ['Upright', 50 * (1 - lin(t.tilt, 1, 12))],
    ['On the pad', 200 * (1 - lin(t.dist, 10, 500))],
    ['Propellant left', 100 * lin(t.prop, 0, 30e3)],
  ]);
}

/** Surface: base objectives and how quickly (sols) they were met. */
export function scoreSurface(r) {
  const built = r?.built || [];
  const has = (k) => built.includes(k);
  return pack([
    ['Landing pad printed', has('pad') ? 250 : 0],
    ['Habitat shell printed', has('habitat') ? 300 : 0],
    ['Wall segments', 50 * Math.min(3, built.filter((b) => b === 'wall').length)],
    ['Spare wheel', has('wheel') ? 50 : 0],
    ['Speed (sols)', has('pad') && has('habitat') ? 250 * (1 - lin(r.sols, 3, 20)) : 0],
  ]);
}

/** Touchdown classification used on the HUD. */
export function touchdownRating(vy) {
  return vy <= 2 ? 'NOMINAL' : vy <= 4 ? 'FIRM' : vy <= 6 ? 'HARD' : 'IMPACT';
}

export const SCORERS = { launch: scoreLaunch, refill: scoreRefill, transfer: scoreTransfer, entry: scoreEntry, landing: scoreLanding, surface: scoreSurface };
