// Mars atmosphere model: density, pressure, temperature, speed of sound vs
// altitude (0-130 km above the Mars reference surface / areoid datum).
//
// Pure ES module (node + browser). The profile is DERIVED, not tabulated:
//   1. A temperature structure built from physical regimes:
//      - afternoon convective boundary layer: dry adiabat (g/cp of the CO2 mix)
//        up to the PBL top (~5 km).
//      - dusty free troposphere: lapse rate = dustFactor * dry adiabat; dust
//        absorbs sunlight aloft and makes it markedly sub-adiabatic.
//      - mesosphere: set by CO2 15-um radiative cooling, slowly cooling aloft.
//      - lower thermosphere: Bates-type relaxation toward an exospheric
//        temperature (weak on the Mars nightside/low-EUV; configurable).
//      The regimes are joined with a smooth (softplus) blend.
//      On top of that mean state, vertically propagating waves: the migrating
//      diurnal tide (lambda_z ~32 km, phase set by local time) and a small
//      gravity-wave spectrum (lambda_z 9-18 km, seeded phases). Amplitudes grow
//      as exp(z/2H) and saturate at the convective-instability limit, so the
//      density profile shows the measured 10-30 % swings above ~50 km.
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
  pblTop: 5,              // km, afternoon convective boundary layer depth (dry-adiabatic mixed layer)
  dustFactor: 0.32,       // free-troposphere lapse rate as fraction of dry adiabat (dust absorbs sunlight aloft: ~1.5 K/km)
  mesoTemp: 150,          // K, CO2 15-um cooled mesosphere at its base (~50 km)
  mesoLapse: 0.12,        // K/km, slow cooling with height (non-LTE CO2 cooling strengthens aloft)
  blendWidth: 4,          // km, softness of the tropopause corner
  thermoBase: 128,        // km, base of thermospheric EUV heating (low solar activity)
  exoTemp: 170,           // K, exospheric temperature (low solar activity)
  thermoShape: 0.05,      // 1/km, Bates shape parameter
  // --- vertically propagating waves (the measured profiles are never smooth above ~40 km) ---
  waves: true,
  localTime: 15.5,        // h local solar time (afternoon entry/landing)
  tideLambda: 32,         // km, vertical wavelength of the migrating diurnal tide (classical tidal theory, Mars)
  tideAmpRef: 2.5,        // K, tide temperature amplitude at 20 km (MCS / radio occultation order)
  tidePhaseLT: 15,        // h, local time of the tide temperature maximum at 20 km
  tideMaxAmp: 12,         // K, damping ceiling (radiative + eddy damping of the tide above ~60 km)
  gwLambdas: [9, 13, 18], // km, gravity-wave vertical wavelengths (observed 5-20 km on Mars)
  gwAmpRef: 0.8,          // K, each gravity-wave amplitude at 20 km (near source level)
  waveSeed: 1,            // seed for gravity-wave phases (unknown; a "weather" realisation)
  waveGrowthH: 8,         // km, density scale height controlling exp(z/2H) amplitude growth
};

function softMax(a, b, w) {
  // smooth max: w * ln(exp(a/w)+exp(b/w)), numerically stable
  const m = Math.max(a, b);
  return m + w * Math.log(Math.exp((a - m) / w) + Math.exp((b - m) / w));
}
// smooth |a| ceiling: grows like a, saturates at c
const softCap = (a, c) => a / Math.sqrt(1 + (a / c) ** 2);

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Mean (wave-free) temperature [K] at altitude zKm: radiative-convective structure.
export function meanTemperature(zKm, p = DEFAULTS) {
  const lapseDry = G0 / cpMass(p.surfaceAirTemp) * 1000; // K/km (~4.5-5)
  const lapseFree = p.dustFactor * lapseDry;
  // convective mixed layer (dry adiabat) up to the PBL top, dust-heated sub-adiabatic above
  const w = 1.5;
  const zb = w * Math.log(1 + Math.exp((zKm - p.pblTop) / w)); // softplus(z - pblTop): 0 in PBL
  const zIn = zKm - zb;                                         // ~min(z, pblTop)
  const tTropo = p.surfaceAirTemp - lapseDry * zIn - lapseFree * zb;
  const tMeso = p.mesoTemp - p.mesoLapse * Math.max(0, zKm - 50);
  let T = softMax(tTropo, tMeso, p.blendWidth);
  if (zKm > p.thermoBase) {
    const dz = zKm - p.thermoBase;
    T = p.exoTemp - (p.exoTemp - T) * Math.exp(-p.thermoShape * dz);
  }
  return T;
}

// Wave temperature perturbation [K]. Linear waves grow as exp(z/2H) (energy
// conservation in a density-stratified gas) until they break: a wave of vertical
// wavelength L becomes convectively unstable when its lapse rate perturbation
// (2 pi / L) T' exceeds the static stability (Gamma_ad + dTbar/dz). Each
// gravity wave saturates there (shared over the spectrum, 1/sqrt(N)); the tide
// is limited by radiative/eddy damping.
export function makeWaveField(p = DEFAULTS) {
  if (!p.waves) return () => 0;
  const rnd = mulberry32(p.waveSeed);
  const gw = p.gwLambdas.map((L) => ({ k: 2 * Math.PI / L, L, phi: 2 * Math.PI * rnd() }));
  const lapseDry = G0 / cpMass(200) * 1000;
  const nGW = gw.length;
  const grow = (z) => Math.exp((z - 20) / (2 * p.waveGrowthH));
  const kT = 2 * Math.PI / p.tideLambda;
  const tidePhase0 = 2 * Math.PI * (p.localTime - p.tidePhaseLT) / 24;
  return (zKm) => {
    if (zKm <= 0) return 0;
    // waves are launched above the boundary layer: taper smoothly to zero at the ground
    const taper = 1 - Math.exp(-((zKm / 10) ** 2));
    const dTdz = (meanTemperature(zKm + 0.5, p) - meanTemperature(zKm - 0.5, p));
    const stab = Math.max(0.5, lapseDry + dTdz); // K/km, static stability
    const g = grow(zKm);
    // diurnal tide: phase descends with time (upward energy propagation)
    let dT = softCap(p.tideAmpRef * g, p.tideMaxAmp) * Math.cos(tidePhase0 + kT * (zKm - 20));
    for (const w of gw) {
      const sat = stab * w.L / (2 * Math.PI) / Math.sqrt(nGW);
      dT += softCap(p.gwAmpRef * g, sat) * Math.cos(w.k * zKm + w.phi);
    }
    return taper * dT;
  };
}

// Temperature [K] at altitude zKm (mean structure + waves).
export function temperatureProfile(zKm, p = DEFAULTS, wave = null) {
  const wf = wave ?? (p === DEFAULTS ? DEFAULT_WAVES() : makeWaveField(p));
  return meanTemperature(zKm, p) + wf(zKm);
}
let _dw = null;
const DEFAULT_WAVES = () => (_dw ??= makeWaveField(DEFAULTS));

// Build a hydrostatic column (Simpson/RK4 in ln p; rhs depends on z only) on a fine grid. Returns a model object.
export function createAtmosphere(opts = {}) {
  const p = { ...DEFAULTS, ...opts };
  const dz = 50;                 // m
  const zTop = 200e3;
  const n = Math.round(zTop / dz) + 1;
  const lnP = new Float64Array(n);
  lnP[0] = Math.log(p.surfacePressure);
  const wave = makeWaveField(p);
  const T_of = (zM) => temperatureProfile(zM / 1000, p, wave);
  const f = (z) => -gravity(z) / (R_SPECIFIC * T_of(z)); // d lnp / dz
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
  function temperature(zM) { return T_of(zM); }
  function meanTemp(zM) { return meanTemperature(zM / 1000, p); }
  function density(zM) { return pressure(zM) / (R_SPECIFIC * temperature(zM)); }
  function speedOfSound(zM) { const T = temperature(zM); return Math.sqrt(gammaAt(T) * R_SPECIFIC * T); }
  function scaleHeight(zM) { return R_SPECIFIC * temperature(zM) / gravity(zM); }
  function state(zM) {
    const T = temperature(zM), P = pressure(zM);
    return { T, p: P, rho: P / (R_SPECIFIC * T), a: Math.sqrt(gammaAt(T) * R_SPECIFIC * T), H: R_SPECIFIC * T / gravity(zM) };
  }
  return { params: p, pressure, temperature, meanTemperature: meanTemp, density, speedOfSound, scaleHeight, state };
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
