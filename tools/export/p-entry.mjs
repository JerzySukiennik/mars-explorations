// Fly the Starship IFT-5 (Flight 5, Ship 30) reentry with src/physics/entry.js
// and write work/out/p-entry.ours.csv in the same columns, units, cadence,
// time range and quantisation as refs/data/p-entry.real.csv:
//   t (s, webcast mission clock, 1 Hz), ship_speed_kmh (integer, Earth-relative),
//   ship_alt_km (integer km, as on the HUD).
//
// Initial condition: the vacuum coast state at the suborbital apogee
// (T+1440 s, 212 km, 26 223 km/h Earth-relative, horizontal) as shown on the
// webcast HUD long before the reference window. From there everything -
// entry-interface time and speed, peak speed, plateau, deceleration and
// terminal velocity - is integrated by the entry model (US-1976 atmosphere,
// crossflow/Newtonian aero, altitude-rate bank guidance).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../../src/physics/entry.js';

export const IFT5 = Object.freeze({
  inclinationDeg: 26.5,                     // Starbase due-east launch, ~26.5 deg orbit plane
  apogee: { t: 1440, h: 212e3, v: 26223 / 3.6, gammaDeg: 0 },
  flipAltitude: 500,                        // m: belly-flop -> flip / landing-burn start
  window: [2599, 3923],                     // reference series window (s)
});

export function runEarthReentry(opts = {}) {
  const res = E.simulateEntry({
    planet: E.EARTH, inclinationDeg: IFT5.inclinationDeg, dt: 0.25,
    init: IFT5.apogee, hMin: 0, tMax: 4200,
    vehicle: opts.vehicle, guidance: E.altitudeRateGuidance(),
  });
  const s = res.samples;
  const at = (t, k) => E.sampleAt(s, t, k);
  const cross = (pred) => { const x = s.find(pred); return x ? x.t : NaN; };
  const tEI = cross((x) => x.h < 120.5e3);
  const desc = s.filter((x) => x.t >= tEI);
  const peak = desc.reduce((a, b) => (b.v > a.v ? b : a));
  const tFlip = cross((x) => x.t > tEI && x.h <= IFT5.flipAltitude);
  // Altitude plateau: the altitude at which the pull-out levels off (first hdot >= 0 after EI).
  const level = desc.find((x) => x.gamma >= 0 && x.t > peak.t);
  const table = {
    entry_interface_t_s: tEI,
    entry_interface_speed_kmh: at(tEI, 'v') * 3.6,
    peak_speed_kmh: peak.v * 3.6,
    peak_speed_alt_km: peak.h / 1e3,
    altitude_plateau_km: level ? level.h / 1e3 : NaN,
    t_speed_below_10000_kmh_s: cross((x) => x.t > peak.t && x.v * 3.6 < 10000),
    t_speed_below_1000_kmh_s: cross((x) => x.t > peak.t && x.v * 3.6 < 1000),
    max_deceleration_g: Math.max(...desc.map((x) => x.decel)) / 9.80665,
    terminal_speed_before_flip_kmh: at(tFlip, 'v') * 3.6,
    t_flip_start_s: tFlip,
    peak_heat_flux_kW_m2: Math.max(...desc.map((x) => x.heat)) / 1e3,
  };
  const rows = [];
  for (let t = IFT5.window[0]; t <= IFT5.window[1]; t++) {
    rows.push({ t, ship_speed_kmh: Math.round(at(t, 'v') * 3.6), ship_alt_km: Math.max(0, Math.round(at(t, 'h') / 1e3)) });
  }
  return { res, samples: s, rows, table };
}

export function toCsv(rows) {
  return 't,ship_speed_kmh,ship_alt_km\n' + rows.map((r) => `${r.t},${r.ship_speed_kmh},${r.ship_alt_km}`).join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const out = resolve(root, 'work/out/p-entry.ours.csv');
  const { rows, table } = runEarthReentry();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toCsv(rows));
  console.log(out, rows.length, 'rows');
  console.log(JSON.stringify(table, null, 1));
}
