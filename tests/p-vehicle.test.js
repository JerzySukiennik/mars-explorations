import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as V from '../src/physics/vehicle.js';
import { computeVehicleTable } from '../tools/export/p-vehicle.mjs';

const tol = JSON.parse(readFileSync(new URL('../refs/data/p-vehicle.tolerances.json', import.meta.url)));
const ours = computeVehicleTable();

for (const [key, t] of Object.entries(tol)) {
  test(`p-vehicle ${key} within tolerance`, () => {
    const v = ours[key];
    assert.ok(Number.isFinite(v), `${key} missing`);
    const band = t.tol_abs ?? Math.abs(t.value) * t.tol_rel;
    assert.ok(Math.abs(v - t.value) <= band, `${key}: ours ${v.toFixed(3)} vs ref ${t.value} (+/-${band.toFixed(3)})`);
  });
}

test('thrust and Isp fall with ambient pressure (back-pressure loss)', () => {
  const e = V.ENGINES.raptor2;
  assert.ok(V.thrust(e, 0) > V.thrust(e, V.P_SL));
  assert.ok(V.isp(e, 0) > V.isp(e, V.P_SL));
  assert.ok(Math.abs(V.thrust(e, 0) - V.thrust(e, V.P_SL) - V.P_SL * e.exitArea) < 1e-6);
  assert.ok(V.isp(e, 0) > 340 && V.isp(e, 0) < 360, 'Raptor SL vacuum Isp ~350 s');
});

test('mass flow consistent with mixture ratio and throttle range', () => {
  const e = V.ENGINES.raptor2;
  assert.ok(Math.abs(e.mdotLox / e.mdotCh4 - V.PROPELLANT.mixtureRatio) < 1e-9);
  assert.equal(V.massFlow(e, 0.1), e.mdot * e.throttleMin);
  assert.equal(V.massFlow(e, 0), 0);
});

test('RVac separates at sea level, SL Raptor does not', () => {
  assert.ok(V.flowSeparates(V.ENGINES.raptor2Vac, V.P_SL));
  assert.ok(!V.flowSeparates(V.ENGINES.raptor2, V.P_SL));
});

test('engine counts and rocket equation', () => {
  assert.equal(V.BOOSTER.engineCount, 33);
  assert.equal(V.SHIP.engineCount, 6);
  assert.ok(Math.abs(V.rocketDv(300, Math.E, 1) - 300 * V.G0) < 1e-9);
});

test('Block 3 alternative is more capable', () => {
  const b3 = computeVehicleTable(V.CONFIGS.block3), b2 = computeVehicleTable(V.CONFIGS.block2);
  assert.ok(b3.liftoff_thrust_MN > b2.liftoff_thrust_MN);
});

test('ship vacuum delta-v uses RVac-only burn and beats a blended 6-engine burn', () => {
  const s = V.SHIP;
  const rvacOnly = V.stageVacuumDeltaV(s, 100e3);
  const blended = V.stageDeltaV(s, { payload: 100e3, pa: 0 });
  assert.ok(rvacOnly > blended);
  const expect = V.ENGINES.raptor2Vac.ispVac * V.G0 * Math.log((s.dryMass + s.propMass + 100e3) / (s.dryMass + 100e3));
  assert.ok(Math.abs(rvacOnly - expect) < 1e-6);
});
