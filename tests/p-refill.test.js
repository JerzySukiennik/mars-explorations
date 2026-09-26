import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/physics/refill.js';
import * as V from '../src/physics/vehicle.js';
import { computeRefillTable, formattedTable } from '../tools/export/p-refill.mjs';

const tol = JSON.parse(readFileSync(new URL('../refs/data/p-refill.tolerances.json', import.meta.url)));
const real = JSON.parse(readFileSync(new URL('../refs/data/p-refill.real.json', import.meta.url)));
const ours = computeRefillTable();

// Pass rule from the tolerance file: inside [min,max] when a range is given,
// otherwise |sim-value| <= tol_abs or |sim/value-1| <= tol_rel.
for (const [key, t] of Object.entries(tol)) {
  if (key.startsWith('_')) continue;
  test(`p-refill ${key} within tolerance`, () => {
    let v = ours[key];
    assert.ok(Number.isFinite(v), `${key} missing`);
    if (key === 'tankers_for_full_fill') v = Math.round(v);
    if (t.range) {
      assert.ok(v >= t.range[0] && v <= t.range[1], `${key}: ours ${v} outside [${t.range}]`);
    } else if (t.tol_abs != null) {
      assert.ok(Math.abs(v - t.value) <= t.tol_abs, `${key}: ours ${v} vs ${t.value} +/-${t.tol_abs}`);
    } else {
      assert.ok(Math.abs(v / t.value - 1) <= t.tol_rel, `${key}: ours ${v} vs ${t.value} rel ${t.tol_rel}`);
    }
  });
}

test('export has exactly the reference keys in the reference order', () => {
  assert.deepEqual(Object.keys(formattedTable()), Object.keys(real));
});

test('ascent: booster stages supersonic in the upper stratosphere, ship reaches LEO', () => {
  const a = R.simulateAscent();
  assert.ok(a.staging.h > 50e3 && a.staging.h < 90e3, `staging alt ${a.staging.h}`);
  assert.ok(a.staging.v > 1200 && a.staging.v < 2200, `staging speed ${a.staging.v}`);
  assert.ok(a.insertion.rp - 6378137 > 150e3, 'perigee above 150 km');
  assert.ok(a.shipPropLeft > 0 && a.shipPropLeft < V.SHIP.propMass * 0.2);
});

test('payload to orbit costs propellant: a loaded ship arrives with less', () => {
  const a0 = R.simulateAscent({ payloadT: 0 }), a1 = R.simulateAscent({ payloadT: 100 });
  assert.ok(a1.shipPropLeft < a0.shipPropLeft);
});

test('transfer holds the engine mixture ratio', () => {
  const tr = R.transferRate();
  const mr = V.PROPELLANT.mixtureRatio;
  const lox = Math.min(tr.lox.mdot, tr.ch4.mdot * mr);
  assert.ok(Math.abs(tr.total - lox * (1 + mr) / mr) < 1e-9);
  // higher drive pressure -> faster flow (~sqrt)
  const hi = R.lineFlow(R.FLUIDS.lox, R.PARAMS, 4 * R.PARAMS.drivePressure);
  assert.ok(Math.abs(hi.mdot / R.lineFlow(R.FLUIDS.lox).mdot - 2) < 0.15);
});

test('settling acceleration dominates gravity gradient and drag', () => {
  const s = R.settlingAccel();
  assert.ok(s.accel >= 10 * s.aGG - 1e-12 && s.accel > 10 * s.aDrag);
});

test('boil-off scales with wetted fill; more heat -> more tankers', () => {
  const full = R.boiloff(R.PARAMS, 1, false), half = R.boiloff(R.PARAMS, 0.5, false);
  assert.ok(half.mdot < full.mdot && half.mdot > 0.4 * full.mdot);
  const hot = R.campaign({ ...R.PARAMS, receiverMli: false });
  assert.ok(hot.tankers > R.campaign().tankers);
});

test('MLI-blanketed receiver boils off several times less than a bare ship', () => {
  const bare = R.boiloff(R.PARAMS, 1, false).pctPerDay, mli = R.boiloff(R.PARAMS, 1, true).pctPerDay;
  assert.ok(bare > 3 * mli, `bare ${bare} vs mli ${mli}`);
  // Modified Lockheed: more layers -> less heat flux
  assert.ok(R.mliFlux(250, 90, { ...R.PARAMS, mliLayers: 60 }) < R.mliFlux(250, 90));
});

test('gravity-gradient lever arm is the liquid, not the nose', () => {
  const top = R.tankStackTop();
  assert.ok(top > 20 && top < V.SHIP.length);
});

test('campaign log is monotonic and ends full', () => {
  const c = R.campaign();
  for (let i = 1; i < c.log.length; i++) assert.ok(c.log[i] > c.log[i - 1]);
  assert.equal(c.log.at(-1), V.SHIP.propMass);
});
