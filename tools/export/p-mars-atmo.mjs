// Export the Mars atmosphere profile from src/physics/mars_atmosphere.js in the
// same columns/units/cadence/number format as refs/data/p-mars-atmo.real.csv:
// alt_km (0-130, 1 km), density_kgm3, temperature_K, pressure_Pa.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAtmosphere } from '../../src/physics/mars_atmosphere.js';

export function computeProfile(atm = createAtmosphere(), zMax = 130) {
  const rows = [];
  for (let z = 0; z <= zMax; z++) {
    const s = atm.state(z * 1000);
    rows.push({ alt_km: z, density_kgm3: s.rho, temperature_K: s.T, pressure_Pa: s.p, speed_of_sound_ms: s.a });
  }
  return rows;
}

// C-style %.4e (two-digit exponent), matching the reference file.
export function fmtE(v, d = 4) {
  const [m, e] = v.toExponential(d).split('e');
  const n = Number(e);
  return `${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
}

export function toCsv(rows) {
  const lines = ['alt_km,density_kgm3,temperature_K,pressure_Pa'];
  for (const r of rows) lines.push(`${r.alt_km},${fmtE(r.density_kgm3)},${r.temperature_K.toFixed(1)},${fmtE(r.pressure_Pa)}`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const out = resolve(root, 'work/out/p-mars-atmo.ours.csv');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toCsv(computeProfile()));
  console.log(`wrote ${out}`);
}
