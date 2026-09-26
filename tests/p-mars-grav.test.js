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
