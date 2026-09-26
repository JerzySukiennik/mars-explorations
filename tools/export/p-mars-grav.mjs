// Export for piece p-mars-grav: runs the orbit propagator experiments and
// writes work/out/p-mars-grav.ours.json in the reference table format.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARS } from '../../src/physics/mars_body.js';
import * as O from '../../src/physics/orbit.js';

export function computeMarsGrav() {
  const r200 = MARS.rMean + 200e3;
  // Circular speed / period at 200 km and escape speed are the planet's MEAN
  // (spherically averaged) values, as quoted by fact sheets: the J2 term
  // averages to zero over the sphere, so the circular orbit is propagated in
  // the monopole field and the escape launch is made at MEAN_LAT, where the
  // J2 potential vanishes (full two-body + J2 field). An equatorial orbit
  // would instead feel the bulge (+0.13% speed, -0.25% period).
  const vc = O.measureCircularSpeed(MARS, r200, { j2: false });
  const phobos = MARS.moons.phobos, deimos = MARS.moons.deimos;
  return {
    surface_g_ms2: O.measureSurfaceGravity(MARS, MARS.rEq),
    escape_velocity_kms: O.measureEscapeVelocity(MARS, MARS.rMean, { lat: O.MEAN_LAT }) / 1e3,
    circular_speed_200km_kms: vc / 1e3,
    period_200km_min: O.measureCircularPeriod(MARS, r200, { speed: vc, j2: false }) / 60,
    // moons: eccentric orbit with the published mean distance, J2 field,
    // sidereal period from the fitted mean longitude rate
    phobos_period_h: O.measureSatellitePeriod(MARS, { meanDistance: phobos.a, e: phobos.e, inc: phobos.inc }) / 3600,
    deimos_period_h: O.measureSatellitePeriod(MARS, { meanDistance: deimos.a, e: deimos.e, inc: deimos.inc }) / 3600,
    sidereal_day_h: O.measureSiderealDay(MARS) / 3600,
    areostationary_radius_km: O.measureStationaryRadius(MARS) / 1e3,
    j2_nodal_precession_200km_deg_per_day:
      O.measureNodalRate(MARS, r200, 45 * Math.PI / 180) * 180 / Math.PI * 86400,
  };
}

// match the reference's number formatting (decimal places per key)
const DP = {
  surface_g_ms2: 2, escape_velocity_kms: 3, circular_speed_200km_kms: 3, period_200km_min: 2,
  phobos_period_h: 4, deimos_period_h: 4, sidereal_day_h: 4, areostationary_radius_km: 0,
  j2_nodal_precession_200km_deg_per_day: 2,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const v = computeMarsGrav();
  const lines = Object.keys(DP).map((k) => `  "${k}": ${v[k].toFixed(DP[k])}`);
  const out = resolve(root, 'work/out/p-mars-grav.ours.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `{\n${lines.join(',\n')}\n}\n`);
  console.log(JSON.stringify(v, null, 1));
}
