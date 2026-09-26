// Planetary ephemeris from JPL "Keplerian Elements for Approximate Positions of
// the Major Planets" (E. M. Standish, JPL/Caltech), Table 1: elements and
// rates referred to the mean ecliptic and equinox of J2000, valid 1800-2050 AD.
// Pure ES module (node + browser). Units: km, km/s, days; time is Julian Date
// (TDB ~ TT; the ~69 s UTC offset is irrelevant at this accuracy).

export const AU_KM = 149597870.7;            // IAU 2012
export const MU_SUN = 1.32712440018e11;      // km^3/s^2 (DE405/DE421 GM_sun)
export const DAY_S = 86400;
export const JD_J2000 = 2451545.0;
const D2R = Math.PI / 180;

// [a (AU), e, I (deg), L (deg), long.peri (deg), long.node (deg)] and rates per Julian century
export const STANDISH = Object.freeze({
  mercury: { el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
    rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  venus: { el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
    rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418] },
  earth: { // Earth-Moon barycentre
    el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
  mars: { el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  jupiter: { el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
});

/** Calendar date (UTC-ish, Gregorian) -> Julian Date. Fractional day allowed. */
export function julianDate(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

/** Julian Date -> {y, m, d} (d fractional). */
export function calendarDate(jd) {
  const Z = Math.floor(jd + 0.5), F = jd + 0.5 - Z;
  const al = Math.floor((Z - 1867216.25) / 36524.25);
  const A = Z + 1 + al - Math.floor(al / 4);
  const B = A + 1524, C = Math.floor((B - 122.1) / 365.25);
  const D = Math.floor(365.25 * C), E = Math.floor((B - D) / 30.6001);
  const d = B - D - Math.floor(30.6001 * E) + F;
  const m = E < 14 ? E - 1 : E - 13;
  return { y: m > 2 ? C - 4716 : C - 4715, m, d };
}

export function isoDate(jd) {
  const { y, m, d } = calendarDate(jd);
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.floor(d)).padStart(2, '0')}`;
}

/** Osculating-ish mean elements of a planet at JD (angles in rad, a in km). */
export function elements(planet, jd) {
  const p = STANDISH[planet];
  if (!p) throw new Error(`unknown planet ${planet}`);
  const T = (jd - JD_J2000) / 36525;
  const [a, e, I, L, wbar, node] = p.el.map((v, i) => v + p.rate[i] * T);
  return { a: a * AU_KM, e, inc: I * D2R, L: L * D2R, lonPeri: wbar * D2R, node: node * D2R,
    argPeri: (wbar - node) * D2R, M: (L - wbar) * D2R };
}

/** Solve Kepler's equation E - e sin E = M (elliptic). */
export function solveKepler(M, e) {
  M = Math.atan2(Math.sin(M), Math.cos(M));
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let k = 0; k < 50; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-14) break;
  }
  return E;
}

/** Heliocentric state {r:[x,y,z] km, v:[..] km/s} in the J2000 ecliptic frame. */
export function planetState(planet, jd, mu = MU_SUN) {
  const el = elements(planet, jd);
  const { a, e } = el;
  const E = solveKepler(el.M, e);
  const cE = Math.cos(E), sE = Math.sin(E), s1e = Math.sqrt(1 - e * e);
  const xp = a * (cE - e), yp = a * s1e * sE;
  const n = Math.sqrt(mu / (a * a * a));
  const vxp = -a * n * sE / (1 - e * cE), vyp = a * n * s1e * cE / (1 - e * cE);
  const cw = Math.cos(el.argPeri), sw = Math.sin(el.argPeri);
  const cO = Math.cos(el.node), sO = Math.sin(el.node);
  const ci = Math.cos(el.inc), si = Math.sin(el.inc);
  const R = [
    [cw * cO - sw * sO * ci, -sw * cO - cw * sO * ci],
    [cw * sO + sw * cO * ci, -sw * sO + cw * cO * ci],
    [sw * si, cw * si],
  ];
  return {
    r: R.map((row) => row[0] * xp + row[1] * yp),
    v: R.map((row) => row[0] * vxp + row[1] * vyp),
  };
}

/** Sidereal orbital period of a planet (days) from its Standish mean-longitude rate. */
export function siderealPeriodDays(planet) {
  return 36525 * 360 / STANDISH[planet].rate[3];
}
