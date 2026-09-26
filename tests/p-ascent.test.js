// p-ascent: Starship Flight 5 launch simulation vs the webcast HUD telemetry
// (refs/data/p-ascent.real.csv) and the scalar milestones in
// refs/data/p-ascent.tolerances.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { earthAtmosphere } from '../src/physics/earth_atmosphere.js';
import { runAscent, toCsv } from '../tools/export/p-ascent.mjs';

const tol = JSON.parse(readFileSync(new URL('../refs/data/p-ascent.tolerances.json', import.meta.url)));
const realLines = readFileSync(new URL('../refs/data/p-ascent.real.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
const header = realLines[0].split(',');
const real = realLines.slice(1).map((l) => {
  const c = l.split(',');
  return Object.fromEntries(header.map((h, i) => [h, c[i] === '' ? null : Number(c[i])]));
});

const { rows, table } = runAscent();

const band = (t, ref) => {
  const b = t.tol_abs_or_rel;
  return Math.max(b.abs ?? 0, (b.rel ?? 0) * Math.abs(ref));
};

test('US-1976 atmosphere anchor values', () => {
  const sl = earthAtmosphere(0);
  assert.ok(Math.abs(sl.p - 101325) < 1 && Math.abs(sl.rho - 1.225) < 1e-3 && Math.abs(sl.a - 340.29) < 0.1);
  const z11 = earthAtmosphere(11000);
  assert.ok(Math.abs(z11.T - 216.77) < 0.1 && Math.abs(z11.p - 22700) < 100);
  const z50 = earthAtmosphere(50000);
  assert.ok(Math.abs(z50.p - 79.78) < 0.5 && Math.abs(z50.rho - 1.027e-3) < 2e-5);
  assert.ok(Math.abs(earthAtmosphere(100000).rho - 5.604e-7) / 5.604e-7 < 0.02);
});

test('export matches the reference format (cadence, range, columns)', () => {
  assert.equal(rows.length, real.length);
  rows.forEach((r, i) => assert.equal(r.t, real[i].t));
  const csv = toCsv(rows).trim().split(/\r?\n/);
  assert.equal(csv[0], realLines[0]);
  for (const r of rows) {
    for (const k of ['ship_speed_kmh', 'ship_alt_km']) assert.ok(Number.isInteger(r[k]), `${k} at t=${r.t} not an integer`);
  }
});

for (const col of ['booster_speed_kmh', 'booster_alt_km', 'ship_speed_kmh', 'ship_alt_km']) {
  test(`series ${col} within tolerance at every reference second`, () => {
    const bad = [];
    real.forEach((ref, i) => {
      if (ref[col] === null) return;
      const ours = rows[i][col];
      if (ours === null || Math.abs(ours - ref[col]) > band(tol[col], ref[col])) bad.push(`t=${ref.t} ours ${ours} ref ${ref[col]}`);
    });
    assert.equal(bad.length, 0, `${bad.length} samples out of band: ${bad.slice(0, 8).join('; ')}`);
  });
}

for (const [key, t] of Object.entries(tol)) {
  if (key.startsWith('_') || t.value_or_null === null) continue;
  test(`milestone ${key} within tolerance`, () => {
    const v = table[key];
    assert.ok(Number.isFinite(v), `${key} missing`);
    const b = band(t, t.value_or_null);
    assert.ok(Math.abs(v - t.value_or_null) <= b, `${key}: ours ${v.toFixed(2)} vs ref ${t.value_or_null} (+/-${b.toFixed(1)})`);
  });
}

test('stacked flight: booster and ship readouts identical before separation', () => {
  for (const r of rows.filter((x) => x.t < table.t_hot_staging_s)) {
    assert.equal(r.booster_speed_kmh, r.ship_speed_kmh);
    assert.equal(r.booster_alt_km, r.ship_alt_km);
  }
});
