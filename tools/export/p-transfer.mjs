// Export for piece p-transfer: Earth-Mars transfer quantities from the Standish
// ephemeris + Lambert porkchop search + patched-conic burns. Writes
// work/out/p-transfer.ours.json in the reference table format.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../../src/physics/transfer.js';

export function computeTransfer() {
  const h = T.hohmann('earth', 'mars', T.LEO_ALT_KM);
  const t26 = T.transferSummary(T.minC3Transfer(2026));
  return {
    hohmann_dv_leo_tmi_kms: h.leoDv,
    hohmann_tof_days: h.tofDays,
    c3_min_2026_km2s2: t26.c3,
    tof_2026_days: t26.tofDays,
    leo_tmi_dv_2026_kms: t26.leoTmiDv,
    vinf_arrival_2026_kms: t26.vinfArr,
    mars_entry_speed_2026_kms: t26.marsEntrySpeed,
    c3_min_2028_km2s2: T.minC3Transfer(2028).c3,
    c3_min_2031_km2s2: T.minC3Transfer(2031).c3,
    synodic_period_days: T.synodicPeriodDays('earth', 'mars'),
  };
}

// match the reference's number formatting (decimal places per key)
const DP = {
  hohmann_dv_leo_tmi_kms: 2, hohmann_tof_days: 1, c3_min_2026_km2s2: 2, tof_2026_days: 1,
  leo_tmi_dv_2026_kms: 2, vinf_arrival_2026_kms: 2, mars_entry_speed_2026_kms: 2,
  c3_min_2028_km2s2: 2, c3_min_2031_km2s2: 2, synodic_period_days: 1,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const v = computeTransfer();
  const lines = Object.keys(DP).map((k) => `  "${k}": ${v[k].toFixed(DP[k])}`);
  const out = resolve(root, 'work/out/p-transfer.ours.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `{\n${lines.join(',\n')}\n}\n`);
  console.log(JSON.stringify(v, null, 1));
}
