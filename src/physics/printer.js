// In-situ 3D printing model for a Mars base.
//
// Pure ES module (no DOM, no three.js) so it can be imported from node tests
// and from the browser.
//
// Two machines are modelled:
//   (a) a gantry extrusion printer for structures (landing pads, walls,
//       habitat shells) fed with regolith + binder (geopolymer mortar for
//       load-bearing walls, low-binder regolith-polymer for pads), with an
//       optional laser sintering head for fusing regolith directly;
//   (b) a small part printer for rover spares: polymer FDM (melt-limited
//       hotend) and metal directed-energy deposition.
//
// Everything is derived from material properties and machine geometry:
//   - regolith bulk density = grain density x (1 - porosity)
//   - mix density           = mass-weighted inverse of component densities
//   - deposition rate       = bead cross-section x nozzle speed x mix density
//   - printer power         = mixer shear dissipation + Bingham hose pumping
//                             + gantry motion + actuator/hose heating on Mars
//                             + controls
//   - sintering energy      = integral cp(T) dT + partial-melt latent heat +
//                             radiative/conductive loss during the sinter hold,
//                             divided by source wall-plug and coupling efficiency
//   - FDM rate              = heat-conduction limited melt rate in the hotend
//                             (Fourier number criterion) x printing duty cycle

import { G0 as G_MARS } from './mars_atmosphere.js';

const SIGMA = 5.670374419e-8; // W/m^2/K^4
const KWH = 3.6e6;            // J per kWh

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export const REGOLITH = Object.freeze({
  // Basaltic mineral assemblage (plagioclase/pyroxene/olivine + amorphous);
  // Mars soil grain (particle) density ~2.6-3.0 g/cm^3.
  grainDensity: 2900,     // kg/m^3
  // Loose aeolian drift / freshly excavated soil. Viking drift porosity ~0.6.
  porosity: 0.58,
  // Thermal conductivity of loose fine regolith under ~6 mbar CO2 (W/m/K).
  conductivity: 0.039,
  emissivity: 0.9,
  // Heat capacity of basaltic solids cp(T) = A + B*T - C/T^2  [J/kg/K]
  cpA: 950, cpB: 0.15, cpC: 2.5e7,
  sinterT: 1373,          // K, liquid-phase-assisted sintering of basaltic fines
  meltFractionAtSinter: 0.2,
  latentHeatFusion: 4.0e5, // J/kg, basaltic melt
});

export const BINDERS = Object.freeze({
  // Alkali-silicate activator solution for regolith geopolymer
  geopolymer: { density: 1450, name: 'alkali-silicate activator' },
  // Thermoplastic (recycled PLA/HDPE-like) coating the grains
  polymer: { density: 1240, name: 'thermoplastic binder' },
  // Molten sulfur (sulfur concrete)
  sulfur: { density: 1800, name: 'molten sulfur' },
});

export const FDM_POLYMERS = Object.freeze({
  PLA:  { density: 1240, conductivity: 0.13, cp: 1800, name: 'PLA' },
  PETG: { density: 1270, conductivity: 0.20, cp: 1200, name: 'PETG' },
  PEEK: { density: 1300, conductivity: 0.25, cp: 1700, name: 'PEEK' },
});

/** Bulk density of loose regolith: grain density x solid fraction. */
export function regolithBulkDensity(reg = REGOLITH) {
  return reg.grainDensity * (1 - reg.porosity);
}

/**
 * Density of a dense (paste) mix: regolith grains + liquid binder with all
 * pore space filled, minus entrained air.
 */
export function pasteMixDensity(binderMassFraction, binder = BINDERS.geopolymer,
  reg = REGOLITH, airVoids = 0.03) {
  const specVol = (1 - binderMassFraction) / reg.grainDensity + binderMassFraction / binder.density;
  return (1 / specVol) * (1 - airVoids);
}

/**
 * Density of a low-binder granular mix: the grain skeleton stays at its loose
 * packing and the binder only coats/bridges grains (binder volume < pore
 * volume), so density = bulk density x (1 + binder/regolith mass ratio).
 */
export function granularMixDensity(binderMassFraction, binder = BINDERS.polymer, reg = REGOLITH) {
  const rhoB = regolithBulkDensity(reg);
  const ratio = binderMassFraction / (1 - binderMassFraction);
  const binderVol = rhoB * ratio / binder.density;
  if (binderVol >= reg.porosity) {
    throw new Error('binder fills pores; use pasteMixDensity');
  }
  return rhoB * (1 + ratio);
}

/** Split a printed mass into regolith and binder feedstock (mass balance). */
export function massBalance(printedMass, binderMassFraction, reg = REGOLITH) {
  const regolithMass = printedMass * (1 - binderMassFraction);
  return {
    regolithMass,
    binderMass: printedMass * binderMassFraction,
    excavatedVolume: regolithMass / regolithBulkDensity(reg),
  };
}

// ---------------------------------------------------------------------------
// (a) Structure extrusion printer
// ---------------------------------------------------------------------------

export const STRUCTURE_PRINTER = Object.freeze({
  bead: { width: 0.05, height: 0.025 }, // m (5 cm x 2.5 cm bead)
  nozzleSpeed: 0.155,                   // m/s travel while depositing
  // Wall-grade geopolymer mortar
  wallBinder: BINDERS.geopolymer,
  wallBinderFraction: 0.20,
  // Pad-grade regolith-polymer (binder is imported/recycled, keep it lean)
  padBinder: BINDERS.polymer,
  padBinderFraction: 0.06,
  // Fresh paste rheology (Bingham) - printable mortar
  yieldStress: 600,       // Pa
  plasticViscosity: 20,   // Pa s
  // Continuous mixer: sheared working volume, shear rate, motor efficiency
  mixerVolume: 0.1,       // m^3
  mixerShearRate: 50,     // 1/s
  mixerMotorEff: 0.85,
  // Delivery hose + nozzle, progressive-cavity (rotor-stator) pump
  hoseLength: 15,         // m
  hoseRadius: 0.0254,     // m (2" bore)
  nozzleDeltaP: 3.0e5,    // Pa, nozzle contraction/shaping
  pumpEff: 0.25,
  // Gantry
  gantryMovingMass: 1500, // kg (bridge + printhead)
  rollingFriction: 0.02,
  axes: 3,
  drivePowerPerAxis: 400, // W, servo drive/brake/hold losses
  cornerSpacing: 2.0,     // m between direction reversals on average
  accel: 0.5,             // m/s^2
  driveEff: 0.8,
  // Thermal management on Mars
  ambientT: 210,          // K
  processT: 288,          // K, keep paste above freezing
  hoseInsulationK: 0.03,  // W/m/K
  hoseInsulationOuterR: 0.08,
  actuatorHeaterW: 300,   // W per axis (lubricant/electronics survival heat)
  // Controls, sensors, accelerator dosing, compressor
  auxPower: 2000,         // W
});

/** Volumetric deposition rate, m^3/s. */
export function volumetricRate(pr = STRUCTURE_PRINTER) {
  return pr.bead.width * pr.bead.height * pr.nozzleSpeed;
}

/** Wall-mortar mass deposition rate, kg/s. */
export function extrusionRate(pr = STRUCTURE_PRINTER, reg = REGOLITH) {
  return volumetricRate(pr) * pasteMixDensity(pr.wallBinderFraction, pr.wallBinder, reg);
}

/**
 * Buckingham-Reiner pressure drop for a Bingham paste in a pipe (plug-flow
 * approximation: yield term 16/3 L tau0 / D + Poiseuille term).
 */
export function hosePressureDrop(Q, pr = STRUCTURE_PRINTER) {
  const { hoseLength: L, hoseRadius: R, yieldStress: t0, plasticViscosity: mu } = pr;
  const yieldTerm = (8 / 3) * L * t0 / R;
  const viscousTerm = (8 * mu * L * Q) / (Math.PI * R ** 4);
  return yieldTerm + viscousTerm;
}

/** Electrical power breakdown of the structure printer while printing, W. */
export function printerPowerBreakdown(pr = STRUCTURE_PRINTER, g = G_MARS) {
  const Q = volumetricRate(pr);
  // Mixer: viscous + plastic dissipation of a Bingham paste in the shear zone
  const gd = pr.mixerShearRate;
  const mixer = pr.mixerVolume * (pr.yieldStress * gd + pr.plasticViscosity * gd * gd) / pr.mixerMotorEff;
  // Pump: hydraulic power over pump efficiency
  const dp = hosePressureDrop(Q, pr) + pr.nozzleDeltaP;
  const pump = dp * Q / pr.pumpEff;
  // Gantry: rolling friction + accelerating the moving mass at each corner
  const v = pr.nozzleSpeed;
  const friction = pr.rollingFriction * pr.gantryMovingMass * g * v;
  const accelPower = (pr.gantryMovingMass * v * v) * (v / pr.cornerSpacing); // KE per corner x corner rate
  const gantry = (friction + accelPower) / pr.driveEff + pr.axes * pr.drivePowerPerAxis;
  // Thermal: radial conduction through hose insulation + actuator heaters
  const dT = pr.processT - pr.ambientT;
  const hoseLoss = 2 * Math.PI * pr.hoseInsulationK * dT / Math.log(pr.hoseInsulationOuterR / pr.hoseRadius) * pr.hoseLength;
  const thermal = hoseLoss + pr.axes * pr.actuatorHeaterW;
  const aux = pr.auxPower;
  const total = mixer + pump + gantry + thermal + aux;
  return { mixer, pump, gantry, thermal, aux, total, pumpDeltaP: dp };
}

export function printerPower(pr = STRUCTURE_PRINTER) {
  return printerPowerBreakdown(pr).total;
}

/** Printer electrical energy per kg of wall mortar extruded, J/kg. */
export function energyPerKg(pr = STRUCTURE_PRINTER) {
  return printerPower(pr) / extrusionRate(pr);
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

export const STRUCTURES = Object.freeze({
  landingPad: (diameter = 10, thickness = 0.2) => ({
    kind: 'landingPad', volume: Math.PI * (diameter / 2) ** 2 * thickness, grade: 'pad',
  }),
  // Straight wall
  wall: (length = 10, height = 2.5, thickness = 0.3) => ({
    kind: 'wall', volume: length * height * thickness, grade: 'wall',
  }),
  // Hemispherical habitat shell
  domeShell: (innerRadius = 4, thickness = 0.5) => ({
    kind: 'domeShell',
    volume: (2 / 3) * Math.PI * ((innerRadius + thickness) ** 3 - innerRadius ** 3),
    grade: 'wall',
  }),
});

/** Density of the printed material for a structure grade. */
export function gradeDensity(grade, pr = STRUCTURE_PRINTER, reg = REGOLITH) {
  return grade === 'pad'
    ? granularMixDensity(pr.padBinderFraction, pr.padBinder, reg)
    : pasteMixDensity(pr.wallBinderFraction, pr.wallBinder, reg);
}

/**
 * Plan a print: mass, feedstock mass balance, print time (the printer is a
 * volumetric machine: time = volume / bead volumetric rate / duty), energy,
 * and whether the available power supports it.
 */
export function planStructure(structure, {
  printer = STRUCTURE_PRINTER, regolith = REGOLITH, duty = 1, availablePowerW = Infinity,
} = {}) {
  const rho = gradeDensity(structure.grade, printer, regolith);
  const mass = structure.volume * rho;
  const binderFraction = structure.grade === 'pad' ? printer.padBinderFraction : printer.wallBinderFraction;
  const balance = massBalance(mass, binderFraction, regolith);
  const printTime = structure.volume / volumetricRate(printer) / duty; // s
  const power = printerPower(printer);
  const energy = power * printTime * duty; // J (idle time not billed)
  return {
    ...structure, density: rho, mass, ...balance,
    printTime, power, energy, powerSupported: power <= availablePowerW,
  };
}

// ---------------------------------------------------------------------------
// Laser sintering head
// ---------------------------------------------------------------------------

export const SINTER_HEAD = Object.freeze({
  wallPlugEff: 0.12,      // CO2 laser electrical -> optical
  absorptance: 0.85,      // silicate absorptance at 10.6 um
  layerThickness: 0.02,   // m sintered per pass
  holdTime: 60,           // s at sinter temperature for neck growth
  sinteredDensity: 2000,  // kg/m^3 after densification
});

/** Sensible heat of regolith solids from T1 to T2, J/kg. */
export function sensibleHeat(T1, T2, reg = REGOLITH) {
  const F = (T) => reg.cpA * T + 0.5 * reg.cpB * T * T + reg.cpC / T;
  return F(T2) - F(T1);
}

/** Electrical energy per kg for laser sintering loose regolith, J/kg. */
export function sinteringEnergyPerKg(head = SINTER_HEAD, reg = REGOLITH, ambientT = STRUCTURE_PRINTER.ambientT) {
  const Ts = reg.sinterT;
  const heat = sensibleHeat(ambientT, Ts, reg) + reg.meltFractionAtSinter * reg.latentHeatFusion;
  const arealMass = head.sinteredDensity * head.layerThickness; // kg/m^2
  // Radiative loss from the exposed hot surface during the hold
  const rad = reg.emissivity * SIGMA * (Ts ** 4 - ambientT ** 4) * head.holdTime / arealMass;
  // Conduction into the cold loose bed below (semi-infinite, fixed-T face)
  const rhoB = regolithBulkDensity(reg);
  const cpMean = sensibleHeat(ambientT, 0.5 * (ambientT + Ts), reg) / (0.5 * (Ts - ambientT));
  const alpha = reg.conductivity / (rhoB * cpMean);
  const cond = 2 * reg.conductivity * (Ts - ambientT) * Math.sqrt(head.holdTime / (Math.PI * alpha)) / arealMass;
  const thermal = heat + rad + cond;
  return thermal / (head.wallPlugEff * head.absorptance);
}

// ---------------------------------------------------------------------------
// (b) Part printers for rover spares
// ---------------------------------------------------------------------------

export const FDM_PRINTER = Object.freeze({
  filamentDiameter: 1.75e-3, // m
  meltZoneLength: 0.020,     // m heated length of hotend
  // Core must reach extrusion temperature: Fourier number alpha t / r^2
  fourierRequired: 0.25,
  // Fraction of print time actually extruding at the melt limit
  // (travel, slow outer perimeters, layer cooling pauses)
  dutyCycle: 0.7,
  heaterPower: 60,           // W, hotend heater
  bedPower: 150,             // W, heated bed (average)
  electronicsPower: 50,      // W
});

/** Melt-limited volumetric flow of an FDM hotend, m^3/s. */
export function fdmMaxVolumetricFlow(pr = FDM_PRINTER, mat = FDM_POLYMERS.PLA) {
  const r = pr.filamentDiameter / 2;
  const alpha = mat.conductivity / (mat.density * mat.cp);
  const residence = pr.fourierRequired * r * r / alpha;
  return Math.PI * r * r * pr.meltZoneLength / residence;
}

/** Average part build rate, kg/s. */
export function polymerPartRate(pr = FDM_PRINTER, mat = FDM_POLYMERS.PLA) {
  return fdmMaxVolumetricFlow(pr, mat) * pr.dutyCycle * mat.density;
}

export const METAL_DED = Object.freeze({
  laserPower: 1000,     // W optical
  wallPlugEff: 0.35,    // fibre laser
  absorptance: 0.35,    // steel/Ti at 1 um with powder/wire
  processEff: 0.5,      // fraction of absorbed heat kept in the deposit
  material: { density: 7900, cp: 600, meltT: 1700, latent: 2.7e5 }, // steel-like
  ambientT: 293,        // inside the pressurised workshop
});

/** Metal DED deposition rate (kg/s) and electrical energy per kg (J/kg). */
export function metalDeposition(ded = METAL_DED) {
  const m = ded.material;
  const hPerKg = m.cp * (m.meltT - ded.ambientT) + m.latent;
  const rate = ded.laserPower * ded.absorptance * ded.processEff / hPerKg;
  return { rate, energyPerKg: ded.laserPower / ded.wallPlugEff / rate };
}

// ---------------------------------------------------------------------------
// Power budget
// ---------------------------------------------------------------------------

export const POWER_SOURCES = Object.freeze({
  // Kilopower/KRUSTY-class fission: 4 x 10 kWe for an early base
  fission4x10: { name: '4 x 10 kWe fission', continuousW: 40e3 },
  // Rover RTG (MMRTG ~110 We at BOL)
  mmrtg: { name: 'MMRTG', continuousW: 110 },
  // 1000 m^2 solar field, 590 W/m^2 at Mars, 25% cells, ~0.25 diurnal/dust factor
  solar1000: { name: '1000 m^2 solar', continuousW: 1000 * 590 * 0.25 * 0.25 },
});

/** Check a power demand against a source with an existing base load. */
export function powerBudget(demandW, source = POWER_SOURCES.fission4x10, baseLoadW = 15e3) {
  const available = source.continuousW - baseLoadW;
  return { available, demandW, supported: demandW <= available, margin: available - demandW };
}

// ---------------------------------------------------------------------------
// Summary table (SI -> reporting units)
// ---------------------------------------------------------------------------

export function printerTable() {
  const pad = planStructure(STRUCTURES.landingPad(10, 0.2));
  return {
    regolith_bulk_density_kgm3: regolithBulkDensity(),
    extrusion_rate_kg_per_h: extrusionRate() * 3600,
    energy_per_kg_kWh: energyPerKg() / KWH,
    printer_power_kW: printerPower() / 1000,
    landing_pad_10m_diam_20cm_mass_t: pad.mass / 1000,
    landing_pad_print_time_h: pad.printTime / 3600,
    sintering_energy_per_kg_kWh: sinteringEnergyPerKg() / KWH,
    polymer_part_rate_g_per_h: polymerPartRate() * 3600 * 1000,
  };
}
