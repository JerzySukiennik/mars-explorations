// Run the Starship Flight 5 launch simulation (src/physics/ascent.js) and
// write work/out/p-ascent.ours.csv in the same format as
// refs/data/p-ascent.real.csv: 1 s cadence T+0..T+512, columns
// t,booster_speed_kmh,booster_alt_km,ship_speed_kmh,ship_alt_km, webcast HUD
// quantisation (whole km/h, whole km, truncated). The booster readout is
// blanked a fixed hold time after the tower catch, as the webcast HUD drops
// the booster panel once the booster is on the tower.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../../src/physics/ascent.js';

export const T_END = 512;               // end of the reference window (s)
export const BOOSTER_HUD_HOLD_S = 11;   // booster readout kept this long after the catch

/** Full flight plus the derived scalar quantities used by the tests. */
export function runAscent(opts = {}) {
  // Integrate past the window so SECO (near its end) is always captured.
  const sim = A.simulateAscent({ tEnd: T_END + 30, ...opts });
  const ev = sim.events;
  const tCatch = ev.catch ? ev.catch.t : Infinity;
  const rows = sim.rows.filter((r) => r.t <= T_END).map((r) => {
    const boosterShown = r.t <= Math.ceil(tCatch) + BOOSTER_HUD_HOLD_S;
    return {
      t: r.t,
      booster_speed_kmh: boosterShown ? A.hudSpeedKmh(r.booster_speed_ms) : null,
      booster_alt_km: boosterShown ? A.hudAltKm(r.booster_alt_m) : null,
      ship_speed_kmh: A.hudSpeedKmh(r.ship_speed_ms),
      ship_alt_km: A.hudAltKm(r.ship_alt_m),
    };
  });
  // Scalars, defined the way they are read off the HUD.
  const hud = sim.rows.map((r) => ({
    t: r.t,
    bv: A.hudSpeedKmh(r.booster_speed_ms), bh: A.hudAltKm(r.booster_alt_m),
    sv: A.hudSpeedKmh(r.ship_speed_ms), sh: r.ship_alt_m / 1000,
  }));
  const win = (a, b) => hud.filter((x) => x.t >= a && x.t <= b);
  const around = win(ev.tMeco - 5, ev.tSep + 5);
  const afterSep = win(ev.tSep, ev.catch ? ev.catch.t : T_END);
  const apogeeRow = afterSep.reduce((m, x) => (x.bh > m.bh ? x : m), afterSep[0]);
  const boostback = win(ev.boostbackStart, apogeeRow.t);
  const table = {
    t_meco_s: ev.tMeco,
    booster_speed_at_meco_kmh: Math.max(...around.map((x) => x.bv)),
    alt_at_meco_km: ev.meco.alt / 1000,
    t_hot_staging_s: ev.tSep,
    booster_apogee_km: apogeeRow.bh,
    booster_min_speed_after_boostback_kmh: Math.min(...boostback.map((x) => x.bv)),
    t_booster_catch_s: ev.catch ? ev.catch.t : null,
    t_seco_s: ev.seco ? ev.seco.t : null,
    ship_speed_at_seco_kmh: ev.seco ? A.hudSpeedKmh(ev.seco.speed) : null,
    ship_alt_at_seco_km: ev.seco ? ev.seco.alt / 1000 : null,
  };
  return { sim, rows, table };
}

export function toCsv(rows) {
  const f = (v) => (v === null || v === undefined ? '' : String(v));
  const lines = ['t,booster_speed_kmh,booster_alt_km,ship_speed_kmh,ship_alt_km'];
  for (const r of rows) {
    lines.push([r.t, f(r.booster_speed_kmh), f(r.booster_alt_km), f(r.ship_speed_kmh), f(r.ship_alt_km)].join(','));
  }
  // The reference file uses CRLF line endings; match it byte-for-byte in form.
  return lines.join('\r\n') + '\r\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const out = resolve(root, 'work/out/p-ascent.ours.csv');
  mkdirSync(dirname(out), { recursive: true });
  const { rows, table } = runAscent();
  writeFileSync(out, toCsv(rows));
  console.log(`wrote ${out} (${rows.length} rows)`);
  console.log(JSON.stringify(table, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v), 2));
}
