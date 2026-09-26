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
  assert.ok(fit.meanRadius < r200 - 3e3, 'starting at r200 sags below it under J2');
});
