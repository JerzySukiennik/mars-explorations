// U.S. Standard Atmosphere 1976 (Earth), pure ES module.
//
// 0-86 km: the seven hydrostatic layers of the standard in geopotential
// altitude (molecular-scale temperature linear in H, pressure from the
// barometric equations), density from the ideal-gas law. Above 86 km the
// standard is not a simple layered model (diffusive separation, variable
// molecular weight), so density/pressure/temperature are log-interpolated
// from the tabulated USSA-1976 values up to 1000 km.
//
// Reference: NOAA/NASA/USAF, "U.S. Standard Atmosphere, 1976",
// NOAA-S/T 76-1562, Tables I and IV.

export const R_EARTH_NOMINAL = 6356766;   // m, radius used by USSA-1976 for H <-> z
export const G0 = 9.80665;
export const R_AIR = 287.05287;           // J/(kg K), = R*/M0 (M0 = 28.9644 g/mol)
export const GAMMA_AIR = 1.4;

// Base geopotential altitude (m'), base temperature (K), lapse rate (K/m'),
// base pressure (Pa).
const LAYERS = [
  { H: 0, T: 288.15, L: -0.0065, p: 101325.0 },
  { H: 11000, T: 216.65, L: 0.0, p: 22632.06 },
  { H: 20000, T: 216.65, L: 0.001, p: 5474.889 },
  { H: 32000, T: 228.65, L: 0.0028, p: 868.0187 },
  { H: 47000, T: 270.65, L: 0.0, p: 110.9063 },
  { H: 51000, T: 270.65, L: -0.0028, p: 66.93887 },
  { H: 71000, T: 214.65, L: -0.002, p: 3.956420 },
  { H: 84852, T: 186.946, L: 0.0, p: 0.3733836 },
];

// Upper atmosphere (geometric km, kinetic T K, p Pa, rho kg/m^3), USSA-1976.
const UPPER = [
  [86, 186.87, 3.7338e-1, 6.958e-6],
  [90, 186.87, 1.8359e-1, 3.416e-6],
  [95, 188.42, 7.5966e-2, 1.393e-6],
  [100, 195.08, 3.2011e-2, 5.604e-7],
  [105, 208.84, 1.4521e-2, 2.325e-7],
  [110, 240.00, 7.1042e-3, 9.708e-8],
  [115, 300.00, 4.0079e-3, 4.289e-8],
  [120, 360.00, 2.5382e-3, 2.222e-8],
  [130, 469.27, 1.2505e-3, 8.152e-9],
  [140, 559.63, 7.2028e-4, 3.831e-9],
  [150, 634.39, 4.5422e-4, 2.076e-9],
  [160, 696.29, 3.0395e-4, 1.233e-9],
  [180, 790.07, 1.5271e-4, 5.194e-10],
  [200, 854.56, 8.4736e-5, 2.541e-10],
  [250, 941.33, 2.4767e-5, 6.073e-11],
  [300, 976.01, 8.7704e-6, 1.916e-11],
  [400, 995.83, 1.4518e-6, 2.803e-12],
  [500, 999.24, 3.0236e-7, 5.215e-13],
  [600, 999.85, 8.2130e-8, 1.137e-13],
  [800, 999.99, 1.7036e-8, 1.136e-14],
  [1000, 1000.0, 7.5138e-9, 3.561e-15],
];

/** Geometric altitude z (m) -> geopotential altitude H (m'). */
export function geopotential(z) {
  return (R_EARTH_NOMINAL * z) / (R_EARTH_NOMINAL + z);
}

function lowerAtmosphere(z) {
  const H = geopotential(Math.max(z, -5000));
  let i = LAYERS.length - 1;
  while (i > 0 && H < LAYERS[i].H) i--;
  const b = LAYERS[i];
  const dH = H - b.H;
  const T = b.T + b.L * dH;
  const p = b.L === 0
    ? b.p * Math.exp((-G0 * dH) / (R_AIR * b.T))
    : b.p * Math.pow(b.T / T, G0 / (R_AIR * b.L));
  return { T, p, rho: p / (R_AIR * T) };
}

function upperAtmosphere(z) {
  const km = z / 1000;
  if (km >= UPPER[UPPER.length - 1][0]) {
    const [, T, p, rho] = UPPER[UPPER.length - 1];
    const f = Math.exp(-(km - 1000) / 250);
    return { T, p: p * f, rho: rho * f };
  }
  let i = 0;
  while (i < UPPER.length - 2 && km > UPPER[i + 1][0]) i++;
  const [z0, T0, p0, r0] = UPPER[i];
  const [z1, T1, p1, r1] = UPPER[i + 1];
  const f = (km - z0) / (z1 - z0);
  return {
    T: T0 + f * (T1 - T0),
    p: Math.exp(Math.log(p0) + f * (Math.log(p1) - Math.log(p0))),
    rho: Math.exp(Math.log(r0) + f * (Math.log(r1) - Math.log(r0))),
  };
}

/**
 * Atmospheric state at geometric altitude z (m).
 * Returns { T (K), p (Pa), rho (kg/m^3), a (speed of sound, m/s) }.
 * Speed of sound above 86 km uses the kinetic temperature with gamma 1.4
 * (only used for Mach where drag is negligible anyway).
 */
export function earthAtmosphere(z) {
  const s = z <= 86000 ? lowerAtmosphere(z) : upperAtmosphere(z);
  return { ...s, a: Math.sqrt(GAMMA_AIR * R_AIR * s.T) };
}

export function density(z) { return earthAtmosphere(z).rho; }
export function pressure(z) { return earthAtmosphere(z).p; }
