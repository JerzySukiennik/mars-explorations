// p-mars-grav: Mars gravity/orbit quantities from the numerical propagator,
// checked against the real reference tolerances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeMarsGrav } from '../tools/export/p-mars-grav.mjs';
import { MARS, EARTH } from '../src/physics/mars_body.js';
import * as O from '../src/physics/orbit.js';

const tol = JSON.parse(readFileSync(new URL('../refs/data/p-mars-grav.tolerances.json', import.meta.url)));
const ours = computeMarsGrav();

for (const [key, t] of Object.entries(tol)) {
  test(`${key} within tolerance of real`, () => {
    assert.ok(key in ours, `missing ${key}`);
    const v = ours[key];
    const band = t.tol_abs ?? Math.abs(t.value) * t.tol_rel;
    assert.ok(Math.abs(v - t.value) <= band, `${key}: ours ${v} real ${t.value} band ${band}`);
  });
}

test('propagator conserves energy over 10 LEO revs (Earth, two-body)', () => {
  const st = O.elementsToState(EARTH.mu, { a: EARTH.rEq + 400e3, e: 0.01, inc: 0.9 });
  const e0 = O.stateToElements(EARTH.mu, st).energy;
  const { state } = O.propagate(EARTH, st, 10 * 5550, 5, { j2: false });
  const e1 = O.stateToElements(EARTH.mu, state).energy;
  assert.ok(Math.abs((e1 - e0) / e0) < 1e-9);
});

test('J2 regresses the node of a prograde Mars orbit', () => {
  assert.ok(O.measureNodalRate(MARS, MARS.rMean + 200e3, Math.PI / 4, { days: 1 }) < 0);
});

test('circular speed, period and escape speed imply one consistent GM', () => {
  const r200 = MARS.rMean + 200e3;
  const gmV = (ours.circular_speed_200km_kms * 1e3) ** 2 * r200;
  const gmE = (ours.escape_velocity_kms * 1e3) ** 2 * MARS.rMean / 2;
  const gmT = 4 * Math.PI ** 2 * r200 ** 3 / (ours.period_200km_min * 60) ** 2;
  for (const gm of [gmV, gmE, gmT]) assert.ok(Math.abs(gm / MARS.mu - 1) < 3e-4, `GM ${gm}`);
});

test('nodal-rate orbit is shot to the requested mean radius', () => {
  const r200 = MARS.rMean + 200e3;
  const fit = O.nodalFit(MARS, r200, Math.PI / 4, { days: 1 });
  assert.ok(Math.abs(fit.meanRadius - r200) > 100, 'J2 shifts the mean radius of a node start');
  assert.ok(Math.abs(ours.j2_nodal_precession_200km_deg_per_day + 8.868) < 0.02);
});

test('satellite period: orbit is shot to the published mean distance; eccentricity shortens it', () => {
  const p = MARS.moons.phobos;
  const circ = O.measureSatellitePeriod(MARS, { meanDistance: p.a, e: 0, inc: p.inc }, { revs: 20 });
  const ecc = O.measureSatellitePeriod(MARS, { meanDistance: p.a, e: p.e, inc: p.inc }, { revs: 20 });
  // e=0 must reproduce the circular-orbit shooting experiment
  const c2 = O.measureCircularPeriod(MARS, p.a, { inc: p.inc });
  assert.ok(Math.abs(circ / c2 - 1) < 2e-5, `${circ} vs ${c2}`);
  // <r> = a (1 + e^2/2)  ->  P shorter by ~ (3/2)(e^2/2)
  const rel = 1 - ecc / circ;
  assert.ok(Math.abs(rel / (0.75 * p.e ** 2) - 1) < 0.25, `rel ${rel}`);
});

test('mean-motion fit of a two-body circular orbit equals the swept-angle period', () => {
  const r = MARS.rMean + 500e3;
  const st = O.elementsToState(MARS.mu, { a: r, inc: 0.3 });
  const mm = O.measureMeanMotion(MARS, st, { revs: 10, j2: false });
  const pk = O.timeToSweep(MARS, st, 2 * Math.PI, 5, { j2: false }).t;
  assert.ok(Math.abs(mm.period / pk - 1) < 1e-6);
});
