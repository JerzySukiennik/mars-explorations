// Run the rover sol simulation (src/physics/rover.js) and write
// work/out/p-rover.ours.csv in the same columns, units, cadence, time range
// and quantisation as refs/data/p-rover.real.csv.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../../src/physics/rover.js';

/** Full drive-sol simulation plus derived quantities used by the tests. */
export function runDriveSol(opts = {}) {
  const climate = R.makeClimate();
  const sim = R.simulateSol({ climate, ...opts });
  const rows = R.sampleSol(sim, 0.25, 24.5);
  const socAt = (t) => {
    const i = Math.min(sim.t_h.length - 1, Math.round(t * 3600 / sim.dt));
    return sim.soc[i];
  };
  const byMode = (m) => sim.load.filter((_, i) => sim.mode[i] === m);
  const awake = sim.load.filter((_, i) => sim.mode[i] !== 'sleep');
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const table = {
    top_speed_cm_s: R.ROVER.topSpeed_m_s * 100,
    top_speed_m_per_h: R.TOP_SPEED_M_PER_H,
    mmrtg_power_bol_W: R.mmrtgMeanPower(0, climate),
    mmrtg_decay_W_per_sol: R.mmrtgDecayPerSol(0, climate),
    battery_capacity_Ah: R.BATTERY.capacityAh,
    battery_capacity_Ah_each: R.BATTERY.capacityAh,
    battery_energy_Wh_total: R.batteryEnergyWh(),
    autonav_avg_rate_m_per_h: R.autonavRate(),
    max_drive_m_per_sol: R.driveDistanceInTime(4.4),
    soc_drop_during_drive_pct: socAt(sim.drive.start) - socAt(sim.drive.end),
    sol_net_soc_change_pct: socAt(R.SOL_H) - socAt(0),
    load_W_sleep: mean(byMode('sleep')),
    load_W_awake_min: Math.min(...awake),
    load_W_drive: mean(byMode('drive')),
    load_W_peak: R.peakLoad(),
    load_W_max_in_sol: Math.max(...sim.load),
    mmrtg_power_W_min: Math.min(...sim.mmrtg),
    mmrtg_power_W_max: Math.max(...sim.mmrtg),
    soc_min: Math.min(...sim.soc),
    soc_max: Math.max(...sim.soc),
    drive_distance_m: sim.drive.dist,
    drive_duration_h: sim.drive.end - sim.drive.start,
  };
  return { sim, rows, table };
}

export function toCsv(rows) {
  const lines = ['time_h,battery_soc_pct,mmrtg_power_W,load_W'];
  for (const r of rows) {
    lines.push([r.time_h.toFixed(2), r.battery_soc_pct.toFixed(2), r.mmrtg_power_W.toFixed(2), r.load_W.toFixed(1)].join(','));
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const out = resolve(root, 'work/out/p-rover.ours.csv');
  mkdirSync(dirname(out), { recursive: true });
  const { rows } = runDriveSol();
  writeFileSync(out, toCsv(rows));
  console.log(out);
}
