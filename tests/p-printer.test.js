import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as P from '../src/physics/printer.js';
import { computePrinterTable } from '../tools/export/p-printer.mjs';

const tol = JSON.parse(readFileSync(new URL('../refs/data/p-printer.tolerances.json', import.meta.url)));
const ours = computePrinterTable();

for (const [key, t] of Object.entries(tol)) {
  test(`p-printer ${key} within tolerance`, () => {
    const v = ours[key];
    assert.ok(Number.isFinite(v), `${key} missing`);
    const band = t.tol_abs ?? Math.abs(t.value) * t.tol_rel;
    assert.ok(Math.abs(v - t.value) <= band, `${key}: ours ${v} vs ref ${t.value} (+/-${band})`);
  });
}

test('mass balance closes and excavated volume follows bulk density', () => {
  const b = P.massBalance(1000, 0.2);
  assert.ok(Math.abs(b.regolithMass + b.binderMass - 1000) < 1e-9);
  assert.ok(Math.abs(b.excavatedVolume * P.regolithBulkDensity() - b.regolithMass) < 1e-9);
});

test('paste mix is denser than loose regolith, below grain density', () => {
  const rho = P.pasteMixDensity(0.2);
  assert.ok(rho > P.regolithBulkDensity() && rho < P.REGOLITH.grainDensity);
  assert.throws(() => P.granularMixDensity(0.5)); // binder would overfill pores
});

test('print time scales linearly with structure volume', () => {
  const a = P.planStructure(P.STRUCTURES.landingPad(10, 0.2));
  const b = P.planStructure(P.STRUCTURES.landingPad(10, 0.4));
  assert.ok(Math.abs(b.printTime / a.printTime - 2) < 1e-9);
});

test('power budget: 4x10 kWe fission supports the printer, an MMRTG does not', () => {
  const p = P.printerPower();
  assert.ok(P.powerBudget(p, P.POWER_SOURCES.fission4x10).supported);
  assert.ok(!P.powerBudget(p, P.POWER_SOURCES.mmrtg, 0).supported);
});

test('sintering energy exceeds the thermodynamic floor', () => {
  const floor = P.sensibleHeat(210, P.REGOLITH.sinterT) / 3.6e6;
  assert.ok(floor > 0.2 && floor < 0.5);
  assert.ok(P.sinteringEnergyPerKg() / 3.6e6 > floor * 5);
});

test('FDM melt rate rises with polymer thermal diffusivity', () => {
  assert.ok(P.fdmMaxVolumetricFlow(P.FDM_PRINTER, P.FDM_POLYMERS.PEEK) > P.fdmMaxVolumetricFlow());
});
