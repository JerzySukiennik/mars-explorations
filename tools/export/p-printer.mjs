// Export derived 3D-printing numbers from src/physics/printer.js in the same
// key/unit format as refs/data/p-printer.real.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printerTable } from '../../src/physics/printer.js';

export function computePrinterTable() {
  return printerTable();
}

// Same quantisation as the reference table.
const DP = {
  regolith_bulk_density_kgm3: 0, extrusion_rate_kg_per_h: 0, energy_per_kg_kWh: 4,
  printer_power_kW: 0, landing_pad_10m_diam_20cm_mass_t: 2, landing_pad_print_time_h: 1,
  sintering_energy_per_kg_kWh: 1, polymer_part_rate_g_per_h: 0,
};
const round = (v, d) => Number(v.toFixed(d));

export function formattedTable() {
  const t = computePrinterTable();
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round(v, DP[k])]));
}

// Reference writes one key per line with fixed decimals (e.g. "17.0").
function serialise(t) {
  const lines = Object.entries(t).map(([k, v]) => `  "${k}": ${DP[k] > 0 ? v.toFixed(DP[k]) : String(v)}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const out = resolve(root, 'work/out/p-printer.ours.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, serialise(formattedTable()));
  console.log(out);
}
