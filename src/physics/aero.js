// Starship aerodynamics for atmospheric entry (belly-first, high angle of
// attack). Pure ES module, node + browser.
//
// The ship is modelled as what it is geometrically: a 9 m circular cylinder
// (~47 m of body in crossflow) with four flat flaps sticking out sideways in
// the body plane. At the 60-90 deg angles of attack Starship flies, the
// dominant aerodynamics is *crossflow* over the cylinder and normal pressure
// on the flaps, so we use the classic slender-body + viscous-crossflow method
// (Allen & Perkins 1951; Jorgensen, NASA TR R-474, 1977):
//
//   CN = sin(2a) cos(a/2) * Ab/Aref                      (potential term)
//      + eta * Cdc(Mc, Rec) * sin^2(a) * Ap/Aref          (crossflow cylinder)
//      + Cnf(Mc) * sin^2(a) * Af/Aref                     (flaps, flat plates)
//   CA = skin friction + nose pressure (small)
//   CL = CN cos a - CA sin a,  CD = CN sin a + CA cos a
//
// Mc = M sin(a) is the crossflow Mach number. The crossflow drag coefficient
// Cdc is built from gas dynamics rather than a table:
//   - windward (fore) pressure: modified Newtonian, Cp = Cp0 cos^2(phi), whose
//     integral over a cylinder half gives (2/3) Cp0; Cp0 is the stagnation
//     pressure coefficient behind a normal shock (Rayleigh pitot formula) for
//     supersonic crossflow, isentropic for subsonic.
//   - leeward (base) pressure: a fixed fraction of vacuum, Cpb = -k 2/(g M^2),
//     the usual supersonic base-pressure correlation (-> 0 at hypersonic speed).
//   - subsonic crossflow: Reynolds-number dependent (drag crisis): 1.2
//     subcritical, falling to ~0.7 transcritical (Roshko 1961). Compressibility
//     removes the drag crisis near Mc ~ 0.6-1, where we blend to the
//     supersonic branch.
// eta is the finite-length (end-effect) factor for the subsonic crossflow;
// supersonic crossflow has no end relief (eta -> 1, Jorgensen).

export const STARSHIP_GEOM = Object.freeze({
  diameter: 9.0,          // m
  bodyLength: 50.3,       // m, overall length
  noseLength: 18.0,       // m, ogive nosecone (planform ~2/3 of a D x L rectangle)
  flapArea: 70.0,         // m^2, 2 forward + 2 aft flaps (approx. 2x12 + 2x23 m^2)
  noseRadius: 4.5,        // m, windward effective radius used for stagnation heating
  wettedArea: 1450,       // m^2, for skin friction
  roughness: 0.01,        // m, equivalent sand-grain height of the tiled belly (tile gaps/steps, chines, raceway)
});

/** Reference area (m^2): belly planform, cylinder barrel + tangent-ogive nose (2/3 D Ln). */
export function refArea(geom = STARSHIP_GEOM) {
  const Ln = geom.noseLength ?? 0;
  return geom.diameter * (geom.bodyLength - Ln + (2 / 3) * Ln);
}

/** Stagnation-point pressure coefficient Cp0 at freestream Mach M, ratio of specific heats g. */
export function stagnationCp(M, g = 1.4) {
  if (M <= 1e-6) return 1.0;
  let p0p;
  if (M < 1) {
    p0p = Math.pow(1 + 0.5 * (g - 1) * M * M, g / (g - 1));
  } else {
    // Rayleigh pitot formula: total pressure behind a normal shock over static.
    const a = Math.pow(((g + 1) * (g + 1) * M * M) / (4 * g * M * M - 2 * (g - 1)), g / (g - 1));
    p0p = a * ((1 - g + 2 * g * M * M) / (g + 1));
  }
  return (p0p - 1) / (0.5 * g * M * M);
}

/** Leeward/base pressure coefficient (negative) for supersonic flow. */
export function basePressureCp(M, g = 1.4, k = 0.57) {
  if (M <= 1) return -k * 2 / g; // continuous at M = 1
  return -k * 2 / (g * M * M);
}

/**
 * Subsonic cylinder drag coefficient vs Reynolds number (drag crisis), with
 * surface roughness k/D. Smooth: subcritical 1.2 up to 2e5, crisis minimum
 * ~0.3 at 5e5, transcritical recovery to ~0.7. Rough cylinders (Achenbach
 * 1971; Achenbach & Heinecke 1981) have an earlier, shallower crisis and a
 * higher transcritical plateau: ~0.9 at k/D 5e-4, ~1.0 at 1e-3, ~1.1 at 3e-3.
 */
export function subsonicCylinderCd(Re, kD = 0) {
  if (!(Re > 0)) return 1.2;
  const lr = Math.log10(Re);
  const rough = kD > 1e-5 ? Math.min(1, Math.max(0, (Math.log10(kD) + 5) / 2.5)) : 0; // 0 smooth .. 1 at k/D ~3e-3
  const tc = kD > 1e-5 ? Math.min(1.15, Math.max(0.7, 1.0 + 0.25 * Math.log10(kD / 1e-3))) : 0.7;
  const cmin = 0.3 + (tc - 0.05 - 0.3) * rough;       // crisis minimum fills in with roughness
  const l1 = 5.3 - 0.5 * rough, l2 = 5.7 - 0.5 * rough, l3 = 6.5 - 0.7 * rough;
  if (lr <= l1) return 1.2;
  if (lr <= l2) return 1.2 + (cmin - 1.2) * (lr - l1) / (l2 - l1);
  if (lr <= l3) return cmin + (tc - cmin) * (lr - l2) / (l3 - l2);
  return tc;
}

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Crossflow drag coefficient of a circular cylinder per unit projected area,
 * at crossflow Mach Mc and crossflow Reynolds number Re (based on diameter).
 */
export function crossflowCd(Mc, Re, g = 1.4, kD = 0) {
  const sup = (M) => (2 / 3) * stagnationCp(M, g) - basePressureCp(M, g);
  const sub = subsonicCylinderCd(Re, kD);
  if (Mc >= 1) return sup(Mc);
  if (Mc <= 0.5) return sub;
  const f = smooth((Mc - 0.5) / 0.5);
  return sub + (sup(1) - sub) * f;
}

/** Normal-force coefficient of a flat plate normal to the crossflow (per plate area). */
export function plateCn(Mc, g = 1.4) {
  const sup = (M) => stagnationCp(M, g) - basePressureCp(M, g);
  const sub = 1.17;
  if (Mc >= 1) return sup(Mc);
  if (Mc <= 0.5) return sub;
  return sub + (sup(1) - sub) * smooth((Mc - 0.5) / 0.5);
}

/** Jorgensen finite-length crossflow factor eta for a body of fineness L/D, blended to 1 for supersonic crossflow. */
export function crossflowEta(fineness, Mc) {
  // Subsonic: ~0.55 at L/D 2, ~0.68 at L/D 5-6, ~0.8 at L/D 20 (Jorgensen fig. 2 / Hoerner)
  const e0 = Math.min(1, 0.52 + 0.1 * Math.log(Math.max(1, fineness)));
  return e0 + (1 - e0) * smooth((Mc - 0.5) / 0.7);
}

/**
 * Aerodynamic coefficients of the ship at angle of attack alpha (rad),
 * freestream Mach M, Reynolds number per metre Re1 (1/m), gas gamma g.
 * Flap deflection `flap` (rad, + = more flap area into the flow) changes the
 * effective flap incidence (trim / pitch control; symmetric deflection here).
 * Returns { CN, CA, CL, CD, LD, Aref }.
 */
export function coefficients(alpha, M, Re1 = 1e6, { geom = STARSHIP_GEOM, g = 1.4, flap = 0 } = {}) {
  const D = geom.diameter, L = geom.bodyLength;
  const Aref = refArea(geom);            // planform area Ap; all coefficients are referenced to it
  const sa = Math.sin(alpha), ca = Math.cos(alpha);
  const Mc = M * Math.abs(sa);
  const ReD = Re1 * D * Math.abs(sa);
  const Ab = Math.PI * D * D / 4;
  const eta = crossflowEta(L / D, Mc);
  const cdc = crossflowCd(Mc, ReD, g, (geom.roughness ?? 0) / D);
  const af = alpha + flap;
  const Mcf = M * Math.abs(Math.sin(af));
  const CNpot = Math.sin(2 * alpha) * Math.cos(alpha / 2) * Ab / Aref;
  const CNbody = eta * cdc * sa * Math.abs(sa);
  const CNflap = plateCn(Mcf, g) * Math.sin(af) * Math.abs(Math.sin(af)) * (geom.flapArea / Aref) * Math.cos(flap);
  const CN = CNpot + CNbody + CNflap;
  // Axial: turbulent skin friction on the wetted area (Cf ~ 0.0015 hypersonic -> 0.003 subsonic)
  // plus modified-Newtonian pressure on the ogive nose projected along the axis.
  const cf = 0.0015 + 0.0015 / (1 + 0.2 * M * M);
  const CA = cf * geom.wettedArea / Aref + 0.3 * stagnationCp(M, g) * ca * ca * Ab / Aref;
  const CL = CN * ca - CA * sa;
  const CD = CN * sa + CA * ca;
  return { CN, CA, CL, CD, LD: CL / CD, Aref, Mc, cdc };
}

/** Sutherland viscosity (Pa s) for air or CO2. */
export function viscosity(T, gas = 'air') {
  const c = gas === 'co2' ? { mu0: 1.370e-5, T0: 273.15, S: 222 } : { mu0: 1.716e-5, T0: 273.15, S: 110.4 };
  return c.mu0 * Math.pow(T / c.T0, 1.5) * (c.T0 + c.S) / (T + c.S);
}
