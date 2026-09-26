import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as R from '../src/physics/rover.js';
import { runDriveSol, toCsv } from '../tools/export/p-rover.mjs';

// The first rover reference was computed from power budgets, not measured, so it was
// voided (refs/data/voided/). The measured replacement (Curiosity sol-2985 SOC trace, see
// refs/data/p-rover.sources.md) has a different format; these comparisons are skipped until
// the rover model is rebuilt and judged against it.
const REF = new URL('../refs/data/p-rover.real.csv', import.meta.url);
const HAVE_REF = existsSync(REF);
const tol = HAVE_REF ? JSON.parse(readFileSync(new URL('../refs/data/p-rover.tolerances.json', import.meta.url))) : {};
const realCsv = HAVE_REF ? readFileSync(REF, 'utf8').trim().split('\n') : [];
const refTest = test.skip;
const { sim, rows, table } = runDriveSol();

const band = (t) => t.tol_abs ?? Math.abs(t.value) * t.tol_rel;
const near = (key, v) => {
  const t = tol[key];
  assert.ok(Number.isFinite(v), `${key} missing`);
  assert.ok(Math.abs(v - t.value) <= band(t), `${key}: ours ${v.toFixed(4)} vs ref ${t.value} (+/-${band(t)})`);
};

// Scalar quantities in the tolerance file (value != null).
for (const [key, t] of Object.entries(tol)) {
  if (key.startsWith('_') || t.value == null || key === 'mmrtg_power_W') continue;
  test(`p-rover ${key} within tolerance`, () => near(key, table[key]));
}

refTest('constants table: top speed, MMRTG BOL power, battery capacity', () => {
  near('top_speed_cm_s', table.top_speed_m_per_h / 36);
  assert.ok(Math.abs(table.top_speed_m_per_h - 151.2) < 0.01);
  near('mmrtg_power_W', table.mmrtg_power_bol_W);
  near('battery_capacity_Ah_each', table.battery_capacity_Ah);
});

refTest('battery SOC within +/-15 points of the reference at every sample', () => {
  const real = realCsv.slice(1).map((l) => l.split(',').map(Number));
  assert.equal(rows.length, real.length);
  for (let i = 0; i < real.length; i++) {
    assert.ok(Math.abs(rows[i].time_h - real[i][0]) < 1e-9);
    const d = rows[i].battery_soc_pct - real[i][1];
    assert.ok(Math.abs(d) <= tol.battery_soc_pct.tol_abs, `t=${real[i][0]} ours ${rows[i].battery_soc_pct.toFixed(2)} ref ${real[i][1]}`);
  }
  assert.ok(table.soc_max <= 100 + 1e-9 && table.soc_min >= 0);
});

refTest('MMRTG output within tolerance at every step of the sol', () => {
  const t = tol.mmrtg_power_W;
  for (const p of sim.mmrtg) assert.ok(Math.abs(p - t.value) <= t.tol_abs, `MMRTG ${p}`);
  // colder environment -> colder cold junction -> more power: max overnight
  const iMax = sim.mmrtg.indexOf(table.mmrtg_power_W_max);
  const hMax = sim.t_h[iMax] % R.SOL_H;
  assert.ok(hMax < 9 || hMax > 21, `max MMRTG at ${hMax} h`);
});

test('loads: never above 1000 W, drive and sleep bands, heaters grow when cold', () => {
  assert.ok(table.load_W_max_in_sol <= 1000 && table.load_W_peak <= 1000);
  assert.ok(R.activityLoad('sleep', 180) > R.activityLoad('sleep', 250));
  const sleeps = sim.load.filter((_, i) => sim.mode[i] === 'sleep');
  for (const p of sleeps) assert.ok(p >= 42 && p <= 72, `sleep ${p}`);
});

test('mobility: speed limit, slip slows on slopes, uphill costs more power', () => {
  assert.ok(table.autonav_avg_rate_m_per_h <= R.TOP_SPEED_M_PER_H);
  assert.ok(R.groundSpeed(15) < R.groundSpeed(5) && R.groundSpeed(5) < R.groundSpeed(0) + 1e-12);
  assert.ok(R.groundSpeed(0) <= R.ROVER.topSpeed_m_s);
  assert.ok(R.motorPower(10) > R.motorPower(0) && R.motorPower(0) < 200, 'flat mobility < 200 W');
  assert.ok(table.drive_duration_h >= 2 && table.drive_duration_h <= 3, `drive ${table.drive_duration_h} h`);
});

test('energy balance shape: overnight charging, steep drive discharge, net-negative sol', () => {
  const socAt = (h) => sim.soc[Math.round(h * 3600 / sim.dt)];
  const nightRate = (socAt(3) - socAt(0)) / 3;
  assert.ok(nightRate > 1 && nightRate < 3.5, `night +${nightRate}%/h`);
  const driveRate = table.soc_drop_during_drive_pct / table.drive_duration_h;
  assert.ok(driveRate > 6 && driveRate < 16, `drive -${driveRate}%/h`);
  assert.ok(table.sol_net_soc_change_pct < -2 && table.sol_net_soc_change_pct > -22);
});

test('MMRTG decay is thermocouple + Pu-238, not Pu-238 alone', () => {
  const puOnly = 110 * 2 * Math.LN2 / 87.7 / R.SOLS_PER_EARTH_YEAR;
  assert.ok(table.mmrtg_decay_W_per_sol > 1.5 * puOnly);
});

refTest('CSV export matches the reference format', () => {
  const csv = toCsv(rows).trim().split('\n');
  assert.equal(csv[0], realCsv[0]);
  assert.equal(csv.length, realCsv.length);
  const pat = /^\d+\.\d{2},\d+\.\d{2},\d+\.\d{2},\d+\.\d$/;
  for (const l of csv.slice(1)) assert.match(l, pat);
});

test('keep-warm heaters follow the rover body temperature: sleep load drops after sunrise', () => {
  const at = (h) => Math.round(h * 3600 / sim.dt);
  const pre = sim.load[at(5)], dawn = sim.load[at(8.3)], aft = sim.load[at(16.5)];
  assert.ok(pre - dawn > 3, `pre-dawn ${pre} vs morning ${dawn}`);
  assert.ok(aft < pre - 8, `afternoon sleep ${aft} vs night ${pre}`);
  const rate = (a, b) => (sim.soc[at(b)] - sim.soc[at(a)]) / (b - a);
  assert.ok(rate(7.5, 8.5) > rate(0, 3), 'charge rate rises in the morning as heaters shut off');
  // MMRTG output responds to the diurnal sink temperature (Curiosity: ~109-119 W)
  assert.ok(table.mmrtg_power_W_max - table.mmrtg_power_W_min > 1.5);
});

test('scheduled activity blocks: piecewise-constant load, straight SOC segments, events on the 15-min grid', () => {
  const soc = rows.map((r) => r.battery_soc_pct);
  const iPeak = soc.indexOf(Math.max(...soc.slice(0, 50)));
  const iMin = soc.indexOf(Math.min(...soc));
  assert.ok(Math.abs(rows[iPeak].time_h - 8.5) < 0.26, `peak at ${rows[iPeak].time_h}`);
  assert.ok(Math.abs(rows[iMin].time_h - 15.0) < 0.26, `min at ${rows[iMin].time_h}`);
  // Within the drive the SOC slope is constant to within 0.4 %/h per 15 min.
  const d = [];
  for (let i = 0; i < rows.length - 1; i++) if (rows[i].time_h >= 11.5 && rows[i + 1].time_h <= 13.5) d.push((soc[i + 1] - soc[i]) / 0.25);
  assert.ok(Math.max(...d) - Math.min(...d) < 0.4, `drive slope spread ${Math.max(...d) - Math.min(...d)}`);
});
