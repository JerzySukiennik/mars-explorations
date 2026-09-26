// Mars atmosphere model: density, pressure, temperature, speed of sound vs
// altitude (0-130 km above the Mars reference surface / areoid datum).
//
// Pure ES module (node + browser). The profile is DERIVED, not tabulated:
//   1. A temperature structure built from physical regimes:
//      - convective/dusty troposphere: lapse rate = dustFactor * dry adiabat
//        (g/cp of the CO2 mixture); dust absorbs sunlight aloft and makes the
//        daytime lapse rate markedly sub-adiabatic (~0.45 of g/cp).
//      - mesosphere: near-isothermal, set by CO2 15-um radiative cooling
//        (colder than the grey-body skin temperature).
//      - lower thermosphere: Bates-type relaxation toward an exospheric
//        temperature (weak on the Mars nightside/low-EUV; configurable).
//      The regimes are joined with a smooth (softplus) blend.
//   2. Hydrostatic integration dp/dz = -p g(z) M / (R T), with inverse-square
//      gravity, from a surface pressure at the datum.
//   3. Ideal gas density, and sound speed from gamma(T) of the CO2/N2/Ar mix.
// Defaults are for a Jezero-like latitude (~18 N), northern spring, afternoon.

export const GM_MARS = 4.282837e13;      // m^3/s^2
export const R_MARS = 3389.5e3;          // m, mean volumetric radius
export const R_UNIVERSAL = 8.314462618;  // J/(mol K)

// Composition (volume fractions, MSL/SAM): CO2, N2, Ar (+ trace O2/CO lumped into CO2)
export const COMPOSITION = { CO2: 0.951, N2: 0.0259, Ar: 0.0194, O2: 0.0016, CO: 0.0021 };
const MOLAR = { CO2: 44.0095e-3, N2: 28.0134e-3, Ar: 39.948e-3, O2: 31.9988e-3, CO: 28.0101e-3 };

export function meanMolarMass(comp = COMPOSITION) {
  let s = 0, m = 0;
  for (const [k, x] of Object.entries(comp)) { s += x; m += x * MOLAR[k]; }
  return m / s;
}
export const M_AIR = meanMolarMass();            // kg/mol ~0.0434
export const R_SPECIFIC = R_UNIVERSAL / M_AIR;    // J/(kg K) ~191.6

export function gravity(zMeters) {
  const r = R_MARS + zMeters;
  return GM_MARS / (r * r);
}
export const G0 = gravity(0);

// Molar heat capacities cp(T) [J/(mol K)] (NIST Shomate-derived, valid 100-400 K
// to ~1%). CO2 has active bending modes so cp rises strongly with T.
function cpMolarCO2(T) {
  // Linear-in-T fit to NIST CO2 ideal-gas cp: 150 K 30.0, 200 K 32.4, 250 K 34.8, 300 K 37.2
  return 32.36 + 0.0482 * (T - 200);
}
export function cpMass(T, comp = COMPOSITION) {
  let s = 0, cp = 0;
  for (const [k, x] of Object.entries(comp)) {
    s += x;
    cp += x * (k === 'CO2' ? cpMolarCO2(T) : k === 'Ar' ? 20.786 : 29.12); // diatomics ~7/2 R
  }
  return (cp / s) / meanMolarMass(comp); // J/(kg K)
}
export function gammaAt(T) {
  const cp = cpMass(T);
  return cp / (cp - R_SPECIFIC);
}

export const DEFAULTS = {
  surfacePressure: 636,   // Pa at the datum (global-mean, NASA Mars fact sheet)
  surfaceAirTemp: 232,    // K, near-surface air, afternoon at ~18-22 N spring/summer
  dustFactor: 0.45,       // tropospheric lapse rate as fraction of dry adiabat (tau~0.4-0.5)
  mesoTemp: 145,          // K, CO2 15-um cooled mesosphere
  blendWidth: 4,          // km, softness of the tropopause corner
  thermoBase: 120,        // km, base of thermospheric heating
  exoTemp: 160,           // K, exospheric temperature (low solar activity, dayside ~180-200; entry-mean)
  thermoShape: 0.05,      // 1/km, Bates shape parameter
};

function softMax(a, b, w) {
  // smooth max: w * ln(exp(a/w)+exp(b/w)), numerically stable
  const m = Math.max(a, b);
  return m + w * Math.log(Math.exp((a - m) / w) + Math.exp((b - m) / w));
}

// Temperature [K] at altitude zKm.
export function temperatureProfile(zKm, p = DEFAULTS) {
  const lapseDry = G0 / cpMass(p.surfaceAirTemp) * 1000; // K/km
  const lapse = p.dustFactor * lapseDry;
  const tTropo = p.surfaceAirTemp - lapse * zKm;
  let T = softMax(tTropo, p.mesoTemp, p.blendWidth);
  if (zKm > p.thermoBase) {
    const s = p.thermoShape;
    const dz = zKm - p.thermoBase;
    T = p.exoTemp - (p.exoTemp - T) * Math.exp(-s * dz);
  }
  return T;
}

// Build a hydrostatic column (Simpson/RK4 in ln p; rhs depends on z only) on a fine grid. Returns a model object.
export function createAtmosphere(opts = {}) {
  const p = { ...DEFAULTS, ...opts };
  const dz = 50;                 // m
  const zTop = 200e3;
  const n = Math.round(zTop / dz) + 1;
  const lnP = new Float64Array(n);
  lnP[0] = Math.log(p.surfacePressure);
  const f = (z) => -gravity(z) / (R_SPECIFIC * temperatureProfile(z / 1000, p)); // d lnp / dz
  for (let i = 1; i < n; i++) {
    const z = (i - 1) * dz;
    const k1 = f(z), k2 = f(z + dz / 2), k4 = f(z + dz);
    lnP[i] = lnP[i - 1] + dz * (k1 + 4 * k2 + k4) / 6;
  }
  function pressure(zM) {
    if (zM <= 0) return Math.exp(lnP[0] + f(0) * zM); // below datum: local scale height
    const x = Math.min(zM, zTop) / dz;
    const i = Math.min(Math.floor(x), n - 2);
    const t = x - i;
    let lp = lnP[i] + (lnP[i + 1] - lnP[i]) * t;
    if (zM > zTop) lp += f(zTop) * (zM - zTop);
    return Math.exp(lp);
  }
  function temperature(zM) { return temperatureProfile(zM / 1000, p); }
  function density(zM) { return pressure(zM) / (R_SPECIFIC * temperature(zM)); }
  function speedOfSound(zM) { const T = temperature(zM); return Math.sqrt(gammaAt(T) * R_SPECIFIC * T); }
  function scaleHeight(zM) { return R_SPECIFIC * temperature(zM) / gravity(zM); }
  function state(zM) {
    const T = temperature(zM), P = pressure(zM);
    return { T, p: P, rho: P / (R_SPECIFIC * T), a: Math.sqrt(gammaAt(T) * R_SPECIFIC * T), H: R_SPECIFIC * T / gravity(zM) };
  }
  return { params: p, pressure, temperature, density, speedOfSound, scaleHeight, state };
}

export const DEFAULT_ATMOSPHERE = createAtmosphere();
export const density = (zM) => DEFAULT_ATMOSPHERE.density(zM);
export const pressure = (zM) => DEFAULT_ATMOSPHERE.pressure(zM);
export const temperature = (zM) => DEFAULT_ATMOSPHERE.temperature(zM);
export const speedOfSound = (zM) => DEFAULT_ATMOSPHERE.speedOfSound(zM);
export const atmosphereState = (zM) => DEFAULT_ATMOSPHERE.state(zM);

// Wind-free dynamic pressure q = 0.5 rho v^2 [Pa]. v is the atmosphere-relative
// speed (m/s) or a velocity vector {x,y,z} / [x,y,z]; no wind is added here.
export function dynamicPressure(zM, v, atm = DEFAULT_ATMOSPHERE) {
  let s2;
  if (typeof v === 'number') s2 = v * v;
  else if (Array.isArray(v)) s2 = v.reduce((a, c) => a + c * c, 0);
  else s2 = (v.x ?? 0) ** 2 + (v.y ?? 0) ** 2 + (v.z ?? 0) ** 2;
  return 0.5 * atm.density(zM) * s2;
}
export function machNumber(zM, speed, atm = DEFAULT_ATMOSPHERE) {
  return speed / atm.speedOfSound(zM);
}
