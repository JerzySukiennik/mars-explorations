// Planetary body constants for Mars (and Earth, for the launch/LEO phase).
//
// Pure ES module (no DOM, no three.js): importable from node and the browser.
// All values SI (m, s, rad). These are the INPUT parameters of the gravity
// model; every derived quantity the game reports (surface gravity, escape
// speed, orbital periods, areostationary radius, nodal regression) is obtained
// by numerically propagating orbits with src/physics/orbit.js, not stored here.
//
// Sources:
//  - GM Mars 42828.37 km^3/s^2: Konopliv et al. 2006 (MGS95J), JPL SSD
//    planetary physical parameters, NSSDC Mars fact sheet.
//  - Radii: IAU WGCCRE 2015 (Archinal et al. 2018): equatorial 3396.19 km,
//    polar 3376.20 km, volumetric mean 3389.5 km.
//  - J2 = 1.96045e-3 (unnormalised, reference radius 3396 km), MGS95J/JGMRO
//    fields; NSSDC fact sheet 1960.45e-6.
//  - Rotation: IAU WGCCRE W-dot = 350.891982 deg/day (day = 86400 s).
//  - Phobos / Deimos semi-major axes: JPL SSD satellite mean elements
//    (9376 km, 23458 km).
//  - Earth: WGS-84 / EGM96 (GM 3.986004418e14, R_eq 6378.137 km,
//    J2 1.08262668e-3, sidereal rotation 7.2921150e-5 rad/s).

const DEG = Math.PI / 180;
const DAY = 86400;

export const MARS = Object.freeze({
  name: 'Mars',
  mu: 4.282837e13,                 // m^3/s^2
  rEq: 3396.19e3,                  // m, equatorial radius (also J2 reference radius)
  rPolar: 3376.20e3,               // m
  rMean: 3389.5e3,                 // m, volumetric mean radius (altitude datum)
  j2: 1.96045e-3,                  // unnormalised zonal harmonic
  j2RefRadius: 3396.19e3,          // m
  // Spin rate from the IAU prime-meridian rate W-dot (deg/day of 86400 s).
  spinRate: 350.891982 * DEG / DAY, // rad/s
  moons: Object.freeze({
    phobos: Object.freeze({ name: 'Phobos', a: 9376e3, inc: 1.093 * DEG }),
    deimos: Object.freeze({ name: 'Deimos', a: 23458e3, inc: 0.93 * DEG }),
  }),
});

export const EARTH = Object.freeze({
  name: 'Earth',
  mu: 3.986004418e14,
  rEq: 6378.137e3,
  rPolar: 6356.752e3,
  rMean: 6371.0e3,
  j2: 1.08262668e-3,
  j2RefRadius: 6378.137e3,
  spinRate: 7.2921150e-5,
  moons: Object.freeze({}),
});

export const BODIES = Object.freeze({ mars: MARS, earth: EARTH });
