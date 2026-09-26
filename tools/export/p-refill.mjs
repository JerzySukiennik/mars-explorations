// Export the orbital-refilling model (src/physics/refill.js) in the same
// key order / units / quantisation as refs/data/p-refill.real.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refillSummary } from '../../src/physics/refill.js';

export function computeRefillTable(params) {
  return refillSummary(params);
}

// Reference quantisation: whole numbers except the sub-unit rates.
const DP = {
  ship_prop_capacity_t: 0, prop_per_tanker_t: 0, tankers_for_full_fill: 0,
  flight3_transfer_demo_t: 0, transfer_rate_t_per_min: 0, full_transfer_time_h: 0,
  boiloff_pct_per_day: 1, settling_accel_mms2: 2,
};
const round = (v, d) => Number(v.toFixed(d));

export function formattedTable(params) {
  const t = computeRefillTable(params);
  return Object.fromEntries(Object.keys(DP).map((k) => [k, round(t[k], DP[k])]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const out = resolve(root, 'work/out/p-refill.ours.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(formattedTable(), null, 2) + '\n');
  console.log(out);
}
