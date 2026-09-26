// p-transfer: Earth-Mars transfer quantities (ephemeris + Lambert porkchop +
// patched conics) checked against the real reference tolerances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeTransfer } from '../tools/export/p-transfer.mjs';
import { lambert, vec } from '../src/physics/lambert.js';
import { planetState, julianDate, MU_SUN, AU_KM } from '../src/physics/ephemeris.js';
import { evalTransfer } from '../src/physics/transfer.js';

const tol = JSON.parse(readFileSync(new URL('../refs/data/p-transfer.tolerances.json', import.meta.url)));
const ours = computeTransfer();

for (const [key, t] of Object.entries(tol)) {
  test(`${key} within tolerance of real`, () => {
    assert.ok(key in ours, `missing ${key}`);
    const v = ours[key];
    const band = t.tol_abs ?? Math.abs(t.value) * t.tol_rel;
    assert.ok(Math.abs(v - t.value) <= band, `${key}: ours ${v} real ${t.value} band ${band}`);
  });
}

test('Lambert reproduces a propagated Kepler arc (Curtis Ex. 5.2 style round trip)', () => {
  // circular 1 AU orbit: 90 deg in a quarter period
  const r = AU_KM, v = Math.sqrt(MU_SUN / r), P = 2 * Math.PI * Math.sqrt(r ** 3 / MU_SUN);
  const s = lambert([r, 0, 0], [0, r, 0], P / 4, MU_SUN);
  assert.ok(Math.abs(s.v1[1] - v) < 1e-6 && Math.abs(s.v1[0]) < 1e-6);
  // 270 deg (type II) in three quarters of a period
  const s2 = lambert([r, 0, 0], [0, -r, 0], 3 * P / 4, MU_SUN);
  assert.ok(s2.theta > Math.PI && Math.abs(vec.norm(s2.v1) - v) < 1e-6);
});

test('ephemeris: Earth ~1 AU, Mars 1.38-1.67 AU', () => {
  const j = julianDate(2026, 11, 1);
  assert.ok(Math.abs(vec.norm(planetState('earth', j).r) / AU_KM - 1) < 0.02);
  const rm = vec.norm(planetState('mars', j).r) / AU_KM;
  assert.ok(rm > 1.38 && rm < 1.67);
});

test('InSight 2018 launch C3 ~8.19 km2/s2 (validation)', () => {
  const j = julianDate(2018, 5, 5);
  const r = evalTransfer(j, julianDate(2018, 11, 26) - j);
  assert.ok(Math.abs(r.c3 - 8.19) < 0.4, `C3 ${r.c3}`);
});
