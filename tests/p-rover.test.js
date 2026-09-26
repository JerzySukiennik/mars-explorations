import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/physics/rover.js';
import { runDriveSol, toCsv } from '../tools/export/p-rover.mjs';

const tol = JSON.parse(readFileSync(new URL('../refs/data/p-rover.tolerances.json', import.meta.url)));
const realCsv = readFileSync(new URL('../refs/data/p-rover.real.csv', import.meta.url), 'utf8').trim().split('\n');
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

test('constants table: top speed, MMRTG BOL power, battery capacity', () => {
  near('top_speed_cm_s', table.top_speed_m_per_h / 36);
  assert.ok(Math.abs(table.top_speed_m_per_h - 151.2) < 0.01);
  near('mmrtg_power_W', table.mmrtg_power_bol_W);
  near('battery_capacity_Ah_each', table.battery_capacity_Ah);
});

test('battery SOC within +/-15 points of the reference at every sample', () => {
  const real = realCsv.slice(1).map((l) => l.split(',').map(Number));
  assert.equal(rows.length, real.length);
  for (let i = 0; i < real.length; i++) {
    assert.ok(Math.abs(rows[i].time_h - real[i][0]) < 1e-9);
    const d = rows[i].battery_soc_pct - real[i][1];
    assert.ok(Math.abs(d) <= tol.battery_soc_pct.tol_abs, `t=${real[i][0]} ours ${rows[i].battery_soc_pct.toFixed(2)} ref ${real[i][1]}`);
  }
  assert.ok(table.soc_max <= 100 + 1e-9 && table.soc_min >= 0);
});

test('MMRTG output within tolerance at every step of the sol', () => {
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

test('CSV export matches the reference format', () => {
  const csv = toCsv(rows).trim().split('\n');
  assert.equal(csv[0], realCsv[0]);
  assert.equal(csv.length, realCsv.length);
  const pat = /^\d+\.\d{2},\d+\.\d{2},\d+\.\d{2},\d+\.\d$/;
  for (const l of csv.slice(1)) assert.match(l, pat);
});
