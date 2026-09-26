import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as A from '../src/physics/mars_atmosphere.js';
import { computeProfile, toCsv } from '../tools/export/p-mars-atmo.mjs';

const tol = JSON.parse(readFileSync(new URL('../refs/data/p-mars-atmo.tolerances.json', import.meta.url)));
const real = readFileSync(new URL('../refs/data/p-mars-atmo.real.csv', import.meta.url), 'utf8')
  .trim().split('\n').slice(1).map((l) => l.split(',').map(Number))
  .map(([alt_km, density_kgm3, temperature_K, pressure_Pa]) => ({ alt_km, density_kgm3, temperature_K, pressure_Pa }));
const ours = new Map(computeProfile().map((r) => [r.alt_km, r]));

const bandFor = (bands, z) => bands.find((b, i) => z >= b.alt_km[0] && (z < b.alt_km[1] || (i === bands.length - 1 && z <= b.alt_km[1])));

for (const key of ['density_kgm3', 'pressure_Pa']) {
  test(`p-mars-atmo ${key} within relative tolerance bands at every km`, () => {
    for (const r of real) {
      const b = bandFor(tol[key].bands, r.alt_km) ?? tol[key];
      const s = ours.get(r.alt_km)[key];
      const rel = Math.abs(s / r[key] - 1);
      const lg = Math.abs(Math.log10(s / r[key]));
      const ok = rel <= b.tol_rel || (b.tol_log10 != null && lg <= b.tol_log10);
      assert.ok(ok, `${key} @${r.alt_km} km: ours ${s.toExponential(3)} vs real ${r[key]} (rel ${rel.toFixed(2)} > ${b.tol_rel})`);
    }
  });
}

test('p-mars-atmo temperature_K within absolute tolerance bands', () => {
  for (const r of real) {
    const b = bandFor(tol.temperature_K.bands, r.alt_km) ?? tol.temperature_K;
    const s = ours.get(r.alt_km).temperature_K;
    assert.ok(Math.abs(s - r.temperature_K) <= b.tol_abs, `T @${r.alt_km} km: ours ${s.toFixed(1)} vs ${r.temperature_K} (+/-${b.tol_abs})`);
  }
});

test('p-mars-atmo surface density / pressure / scale height scalars', () => {
  const s0 = A.atmosphereState(0);
  const chk = (name, v) => {
    const t = tol[name];
    const band = t.tol_abs ?? Math.abs(t.value) * t.tol_rel;
    assert.ok(Math.abs(v - t.value) <= band, `${name}: ours ${v} vs ${t.value} (+/-${band})`);
  };
  chk('surface_density_kgm3_at_0km', s0.rho);
  chk('surface_pressure_Pa_at_0km', s0.p);
  // near-surface pressure scale height H0 = R T0 / g0 (Seiff & Kirk definition)
  chk('scale_height_km_0_20km', s0.H / 1000);
  // and the effective e-folding of pressure across 0-20 km
  chk('scale_height_km_0_20km', 20 / Math.log(A.pressure(0) / A.pressure(20e3)));
});

test('structure is not a single exponential: scale height varies with altitude', () => {
  const atm = A.DEFAULT_ATMOSPHERE;
  // mean (wave-free) structure
  const Hm = (z) => A.R_SPECIFIC * atm.meanTemperature(z * 1000) / A.gravity(z * 1000) / 1000;
  assert.ok(Hm(0) > 11 && Hm(0) < 13, `H(0)=${Hm(0)}`);
  assert.ok(Hm(70) < 9 && Hm(70) > 6.5, `H(70)=${Hm(70)}`);
  assert.ok(Hm(0) - Hm(70) > 3);
  assert.ok(atm.meanTemperature(0) - atm.meanTemperature(40e3) > 50);
  assert.ok(Math.abs(atm.meanTemperature(60e3) - atm.meanTemperature(100e3)) < 15);
});

test('upper atmosphere carries wave structure (tides + gravity waves), not one straight exponential', () => {
  // local scale height from the actual (wavy) temperature drifts by several km above 50 km
  const H = (z) => A.DEFAULT_ATMOSPHERE.scaleHeight(z * 1000) / 1000;
  const hs = []; for (let z = 50; z <= 125; z++) hs.push(H(z));
  assert.ok(Math.max(...hs) - Math.min(...hs) > 1.5, `H range ${Math.min(...hs)}..${Math.max(...hs)}`);
  // residual of log density about a straight line over 50-120 km: 5-40 % swings
  const zs = [], ys = [];
  for (let z = 50; z <= 120; z++) { zs.push(z); ys.push(Math.log(A.density(z * 1000))); }
  const n = zs.length, mz = zs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  const b = zs.reduce((a, z, i) => a + (z - mz) * (ys[i] - my), 0) / zs.reduce((a, z) => a + (z - mz) ** 2, 0);
  const res = ys.map((y, i) => y - (my + b * (zs[i] - mz)));
  const amp = Math.max(...res.map(Math.abs));
  assert.ok(amp > 0.05 && amp < 0.4, `max |residual| ${amp}`);
  // waves are switchable, and the smooth model is the mean
  const smooth = A.createAtmosphere({ waves: false });
  assert.equal(smooth.temperature(80e3), smooth.meanTemperature(80e3));
  // temperature perturbation stays below the convective (breaking) limit of a few tens of K
  for (let z = 0; z <= 130; z++) assert.ok(Math.abs(A.temperature(z * 1000) - A.DEFAULT_ATMOSPHERE.meanTemperature(z * 1000)) < 30);
});

test('hydrostatic balance and ideal gas hold', () => {
  for (const z of [1e3, 20e3, 50e3, 90e3, 125e3]) {
    const dz = 10;
    const dpdz = (A.pressure(z + dz) - A.pressure(z - dz)) / (2 * dz);
    const rhs = -A.density(z) * A.gravity(z);
    assert.ok(Math.abs(dpdz / rhs - 1) < 2e-3, `hydrostatic @${z}: ${dpdz} vs ${rhs}`);
    assert.ok(Math.abs(A.pressure(z) / (A.density(z) * A.R_SPECIFIC * A.temperature(z)) - 1) < 1e-12);
  }
});

test('speed of sound and dynamic pressure', () => {
  const a0 = A.speedOfSound(0);
  assert.ok(a0 > 230 && a0 < 250, `a0=${a0}`); // CO2 at ~230 K, gamma ~1.33
  assert.ok(A.speedOfSound(80e3) < a0);
  assert.ok(A.gammaAt(230) > 1.28 && A.gammaAt(230) < 1.36);
  const rho = A.density(10e3);
  assert.equal(A.dynamicPressure(10e3, 400), 0.5 * rho * 400 * 400);
  assert.equal(A.dynamicPressure(10e3, [300, 0, 400]), 0.5 * rho * 250000);
  assert.equal(A.dynamicPressure(10e3, { x: 0, y: 300, z: 400 }), 0.5 * rho * 250000);
  assert.ok(Math.abs(A.machNumber(0, a0) - 1) < 1e-12);
});

test('export CSV matches reference layout', () => {
  const csv = toCsv(computeProfile()).trim().split('\n');
  const ref = readFileSync(new URL('../refs/data/p-mars-atmo.real.csv', import.meta.url), 'utf8').trim().split('\n');
  assert.equal(csv[0], ref[0]);
  assert.equal(csv.length, ref.length);
  const pat = /^\d+,\d\.\d{4}e[-+]\d\d,\d+\.\d,\d\.\d{4}e[-+]\d\d$/;
  for (const l of csv.slice(1)) assert.match(l, pat);
  for (const l of ref.slice(1)) assert.match(l, pat);
});
