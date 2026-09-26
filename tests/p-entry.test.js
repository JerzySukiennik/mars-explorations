import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../src/physics/entry.js';
import * as A from '../src/physics/aero.js';
import { runEarthReentry, toCsv } from '../tools/export/p-entry.mjs';

const tol = JSON.parse(readFileSync(new URL('../refs/data/p-entry.tolerances.json', import.meta.url)));
const realLines = readFileSync(new URL('../refs/data/p-entry.real.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
const header = realLines[0];
const real = realLines.slice(1).map((l) => l.split(',').map(Number));
const { rows, table, samples } = runEarthReentry();

const band = (t, ref) => Math.max(t.abs ?? 0, (t.rel ?? 0) * Math.abs(ref));

// Scalar checkpoints
for (const [key, t] of Object.entries(tol)) {
  if (key.startsWith('_') || t.value_or_null == null) continue;
  test(`p-entry ${key} within tolerance`, () => {
    const v = table[key], ref = t.value_or_null, b = band(t.tol_abs_or_rel, ref);
    assert.ok(Number.isFinite(v), `${key} missing`);
    assert.ok(Math.abs(v - ref) <= b, `${key}: ours ${v.toFixed(3)} vs ref ${ref} (+/-${b.toFixed(3)})`);
  });
}

// Series: every second of the reference window
for (const [ci, col] of [[1, 'ship_speed_kmh'], [2, 'ship_alt_km']]) {
  test(`p-entry series ${col} within tolerance at every t`, () => {
    const t = tol[col].tol_abs_or_rel;
    assert.equal(rows.length, real.length);
    let worst = { r: 0 };
    real.forEach((ref, i) => {
      assert.equal(rows[i].t, ref[0]);
      const d = Math.abs(rows[i][col] - ref[ci]), b = band(t, ref[ci]);
      if (d / b > worst.r) worst = { r: d / b, t: ref[0], ours: rows[i][col], ref: ref[ci] };
    });
    assert.ok(worst.r <= 1, `${col} worst at t=${worst.t}: ours ${worst.ours} vs ref ${worst.ref} (${worst.r.toFixed(2)} of band)`);
  });
}

test('export format matches the reference (header, cadence, integer quantisation)', () => {
  const raw = toCsv(rows); assert.ok(raw.endsWith('\r\n'));
  const csv = raw.trim().split(/\r?\n/);
  assert.equal(csv[0], header);
  assert.equal(csv.length, realLines.length);
  for (const l of csv.slice(1)) assert.match(l, /^\d+,\d+,\d+$/);
});

test('aero: hypersonic belly-first L/D and Newtonian limits', () => {
  const c = A.coefficients(62 * E.DEG, 25, 1e5, { g: 1.4 });
  assert.ok(c.LD > 0.3 && c.LD < 0.6, `L/D ${c.LD}`);
  assert.ok(Math.abs(A.stagnationCp(50, 1.4) - 1.839) < 0.01);
  assert.ok(A.crossflowCd(0.2, 1e7) < A.crossflowCd(0.2, 1e5)); // drag crisis
  assert.ok(A.crossflowCd(1.2, 1e7) > A.crossflowCd(20, 1e7)); // transonic peak above Newtonian
});

test('Sutton-Graves heating: Earth peak heat flux in a plausible range for Starship', () => {
  assert.ok(table.peak_heat_flux_kW_m2 > 80 && table.peak_heat_flux_kW_m2 < 600, `${table.peak_heat_flux_kW_m2}`);
  const q = E.stagnationHeatFlux(1e-4, 5000, 4.5, 'mars');
  assert.ok(Math.abs(q - 1.9027e-4 * Math.sqrt(1e-4 / 4.5) * 125e9) < 1e-6 * q);
  assert.ok(samples.every((s) => Number.isFinite(s.v) && Number.isFinite(s.h)));
});

test('same model flies a Mars entry to subsonic speed', () => {
  const r = E.simulateEntry({ planet: E.MARS, dt: 0.5, init: { t: 0, h: 125e3, v: 5600, gammaDeg: -11 },
    guidance: E.altitudeRateGuidance(), hMin: 0, tMax: 1500 });
  const last = r.samples.at(-1);
  const peakG = Math.max(...r.samples.map((s) => s.aeroAccel)) / 9.80665;
  assert.ok(last.v < 700, `end speed ${last.v}`);
  assert.ok(peakG > 1 && peakG < 8, `peak g ${peakG}`);
});

test('Mars aerocapture predictor-corrector hits the target apoapsis', () => {
  const target = 2000e3;
  const g = E.aerocaptureGuidance({ targetApoapsis: target, cycle: 20 });
  const p = E.atmosphericPass({ planet: E.MARS, init: { t: 0, h: 130e3, v: 7000, gammaDeg: -13 }, guidance: g, dt: 0.5 });
  assert.ok(p.exit, 'must exit the atmosphere');
  assert.ok(Math.abs(p.apoapsis - target) < 300e3, `apoapsis ${(p.apoapsis / 1e3).toFixed(0)} km`);
});

test('Mars aerobraking pass removes a little velocity and exits', () => {
  const p = E.atmosphericPass({ planet: E.MARS, init: { t: 0, h: 130e3, v: 4600, gammaDeg: -3 }, bankDeg: 90 });
  assert.ok(p.exit);
  assert.ok(p.dv > 0 && p.dv < 1500, `dv ${p.dv}`);
});
