// Starship / Super Heavy / Raptor vehicle model.
//
// Single source of truth for all vehicle constants. Pure ES module (no DOM,
// no three.js) so it can be imported from node tests and from the browser.
//
// Engine performance is NOT stored as thrust/Isp numbers. Each engine is
// described by its combustion chamber and nozzle geometry (chamber pressure,
// throat and exit diameters, effective ratio of specific heats of the
// methalox products, theoretical characteristic velocity c* at the mixture
// ratio, and efficiencies). Thrust, Isp and mass flow at any ambient
// pressure and throttle are derived from 1-D isentropic nozzle theory:
//
//   mdot      = Pc * At / c*_real
//   F_vac     = eta_F * CF_vac_ideal(gamma, eps) * Pc * At
//   F(pa)     = F_vac - pa * Ae                (nozzle back-pressure loss)
//   Isp(pa)   = F(pa) / (mdot * g0)
//
// Sources for the geometry and specs: SpaceX Starship/Raptor pages
// (Raptor 2 ~300 bar chamber, 230 tf SL / 258 tf RVac; this model gives
// ~230 tf / 327 s SL and ~266 tf / 379 s RVac from shared throat), Wikipedia
// "SpaceX Raptor", "SpaceX Starship", "SpaceX Super Heavy". Block 2 /
// Raptor 2 is the default (current flying) configuration; Block 3 /
// Raptor 3 is provided as an alternative.

export const G0 = 9.80665;          // m/s^2, standard gravity (Isp definition)
export const P_SL = 101325;         // Pa, sea-level standard pressure

// ---------------------------------------------------------------------------
// Propellant
// ---------------------------------------------------------------------------
export const PROPELLANT = {
  name: 'LOX/CH4 (subcooled)',
  mixtureRatio: 3.6,               // O/F by mass (Raptor nominal)
  rhoLox: 1200,                    // kg/m^3, subcooled LOX (~66 K)
  rhoCh4: 440,                     // kg/m^3, subcooled liquid methane (~95 K)
  // Combustion products, effective ratio of specific heats for the nozzle
  // expansion (shifting-equilibrium methalox products at O/F 3.6 behave like
  // gamma ~1.14 across the expansion).
  gamma: 1.14,
  // Theoretical characteristic velocity c* for CH4/LOX at O/F 3.6, ~300 bar
  // (NASA CEA-type equilibrium value, m/s).
  cStarTheory: 1870,
};

// ---------------------------------------------------------------------------
// Isentropic nozzle helpers
// ---------------------------------------------------------------------------

/** Area ratio A/A* for Mach M (isentropic, gamma g). */
export function areaRatioFromMach(M, g) {
  return (1 / M) * Math.pow((2 / (g + 1)) * (1 + ((g - 1) / 2) * M * M), (g + 1) / (2 * (g - 1)));
}

/** Supersonic exit Mach for an expansion ratio eps (bisection). */
export function exitMach(eps, g) {
  let lo = 1.000001, hi = 50;
  for (let i = 0; i < 200; i++) {
    const M = 0.5 * (lo + hi);
    if (areaRatioFromMach(M, g) < eps) lo = M; else hi = M;
  }
  return 0.5 * (lo + hi);
}

/** Exit-to-chamber static pressure ratio pe/pc for expansion ratio eps. */
export function exitPressureRatio(eps, g) {
  const M = exitMach(eps, g);
  return Math.pow(1 + ((g - 1) / 2) * M * M, -g / (g - 1));
}

/** Ideal vacuum thrust coefficient CF_vac (momentum + exit-pressure terms). */
export function idealCFvac(eps, g) {
  const pr = exitPressureRatio(eps, g);
  const mom = Math.sqrt(
    ((2 * g * g) / (g - 1)) * Math.pow(2 / (g + 1), (g + 1) / (g - 1)) * (1 - Math.pow(pr, (g - 1) / g)),
  );
  return mom + pr * eps;
}

// ---------------------------------------------------------------------------
// Engine definitions (geometry + efficiencies)
// ---------------------------------------------------------------------------
// throatDia: all Raptor variants share the same powerhead / throat; the SL
// and RVac differ in nozzle extension. etaCStar is combustion efficiency
// (full-flow staged combustion is very efficient). etaF lumps nozzle losses
// (divergence, boundary layer, kinetics) - the short, regeneratively cooled
// SL bell loses more than the long radiatively-cooled RVac bell.
function makeEngine(def) {
  const g = def.gamma ?? PROPELLANT.gamma;
  const At = Math.PI * def.throatDia ** 2 / 4;
  const Ae = Math.PI * def.exitDia ** 2 / 4;
  const eps = Ae / At;
  const cStar = PROPELLANT.cStarTheory * def.etaCStar;
  const mdot = (def.chamberPressure * At) / cStar;         // kg/s at 100 %
  const pe = exitPressureRatio(eps, g) * def.chamberPressure;
  const thrustVac = def.etaF * idealCFvac(eps, g) * def.chamberPressure * At; // N
  const e = {
    ...def,
    gamma: g,
    throatArea: At,
    exitArea: Ae,
    expansionRatio: eps,
    cStar,
    mdot,
    exitPressure: pe,
    thrustVac,
    ispVac: thrustVac / (mdot * G0),
    thrustSL: thrustVac - P_SL * Ae,
  };
  e.ispSL = e.thrustSL / (mdot * G0);
  e.mdotLox = mdot * PROPELLANT.mixtureRatio / (1 + PROPELLANT.mixtureRatio);
  e.mdotCh4 = mdot / (1 + PROPELLANT.mixtureRatio);
  return Object.freeze(e);
}

export const ENGINES = {
  // Raptor 2 (Block 2, currently flying)
  raptor2: makeEngine({
    name: 'Raptor 2 (sea level)', chamberPressure: 300e5,
    throatDia: 0.235, exitDia: 1.30, etaCStar: 0.99, etaF: 0.955,
    throttleMin: 0.40, throttleMax: 1.0, dryMass: 1630,
  }),
  raptor2Vac: makeEngine({
    name: 'Raptor 2 Vacuum (RVac)', chamberPressure: 300e5,
    throatDia: 0.235, exitDia: 2.30, etaCStar: 0.99, etaF: 0.985,
    throttleMin: 0.40, throttleMax: 1.0, dryMass: 2080,
  }),
  // Raptor 3 (Block 3 alternative): same geometry, ~350 bar chamber.
  raptor3: makeEngine({
    name: 'Raptor 3 (sea level)', chamberPressure: 350e5,
    throatDia: 0.235, exitDia: 1.30, etaCStar: 0.99, etaF: 0.955,
    throttleMin: 0.40, throttleMax: 1.0, dryMass: 1525,
  }),
  raptor3Vac: makeEngine({
    name: 'Raptor 3 Vacuum', chamberPressure: 350e5,
    throatDia: 0.235, exitDia: 2.30, etaCStar: 0.99, etaF: 0.985,
    throttleMin: 0.40, throttleMax: 1.0, dryMass: 1950,
  }),
};

// ---------------------------------------------------------------------------
// Stages (masses in kg)
// ---------------------------------------------------------------------------
function makeStage(def) {
  const mr = PROPELLANT.mixtureRatio;
  const s = { ...def };
  s.loxMass = def.propMass * mr / (1 + mr);
  s.ch4Mass = def.propMass / (1 + mr);
  s.loxVolume = s.loxMass / PROPELLANT.rhoLox;
  s.ch4Volume = s.ch4Mass / PROPELLANT.rhoCh4;
  s.engineCount = def.engines.reduce((n, g) => n + g.count, 0);
  return Object.freeze(s);
}

export const CONFIGS = {
  block2: {
    name: 'Starship Block 2 / Super Heavy Block 2 (Raptor 2)',
    booster: makeStage({
      name: 'Super Heavy (Block 2)', dryMass: 275e3, propMass: 3400e3,
      length: 71, diameter: 9,
      engines: [{ engine: ENGINES.raptor2, count: 33 }], // 13 gimballed + 20 fixed
    }),
    ship: makeStage({
      name: 'Starship (Block 2)', dryMass: 100e3, propMass: 1500e3,
      length: 52.1, diameter: 9,
      engines: [
        { engine: ENGINES.raptor2, count: 3 },
        { engine: ENGINES.raptor2Vac, count: 3 },
      ],
    }),
  },
  block3: {
    name: 'Starship Block 3 / Super Heavy Block 3 (Raptor 3)',
    booster: makeStage({
      name: 'Super Heavy (Block 3)', dryMass: 280e3, propMass: 4050e3,
      length: 72.3, diameter: 9,
      engines: [{ engine: ENGINES.raptor3, count: 33 }],
    }),
    ship: makeStage({
      name: 'Starship (Block 3)', dryMass: 110e3, propMass: 2300e3,
      length: 52.1, diameter: 9,
      engines: [
        { engine: ENGINES.raptor3, count: 3 },
        { engine: ENGINES.raptor3Vac, count: 3 },
      ],
    }),
  },
};

export const DEFAULT_CONFIG = 'block2';
export const BOOSTER = CONFIGS.block2.booster;
export const SHIP = CONFIGS.block2.ship;

// ---------------------------------------------------------------------------
// Engine performance functions
// ---------------------------------------------------------------------------

function clampThrottle(engine, throttle) {
  if (throttle <= 0) return 0;
  return Math.min(engine.throttleMax, Math.max(engine.throttleMin, throttle));
}

/** Mass flow (kg/s) at a throttle setting (chamber pressure ~ throttle). */
export function massFlow(engine, throttle = 1) {
  return engine.mdot * clampThrottle(engine, throttle);
}

/**
 * Thrust (N) at ambient pressure pa (Pa) and throttle. Throttling lowers the
 * chamber pressure and hence the momentum thrust, but the back-pressure
 * term pa*Ae is fixed by geometry. Never negative.
 */
export function thrust(engine, pa = 0, throttle = 1) {
  const t = clampThrottle(engine, throttle);
  if (t === 0) return 0;
  return Math.max(0, engine.thrustVac * t - pa * engine.exitArea);
}

/** Specific impulse (s) at ambient pressure pa (Pa) and throttle. */
export function isp(engine, pa = 0, throttle = 1) {
  const md = massFlow(engine, throttle);
  return md > 0 ? thrust(engine, pa, throttle) / (md * G0) : 0;
}

/**
 * Summerfield criterion: the nozzle flow separates when the exit pressure
 * falls below ~0.35-0.4 of ambient. RVac must not be fired at sea level.
 */
export function flowSeparates(engine, pa, throttle = 1) {
  const pe = engine.exitPressure * clampThrottle(engine, throttle);
  return pe < 0.37 * pa;
}

/** Totals over a stage's engine groups. `active` optionally filters groups. */
export function stageThrust(stage, pa = 0, throttle = 1, active = () => true) {
  return stage.engines.filter(active).reduce((F, g) => F + g.count * thrust(g.engine, pa, throttle), 0);
}
export function stageMassFlow(stage, throttle = 1, active = () => true) {
  return stage.engines.filter(active).reduce((m, g) => m + g.count * massFlow(g.engine, throttle), 0);
}
/** Effective (thrust-weighted) Isp of a cluster: sum F / (sum mdot * g0). */
export function stageIsp(stage, pa = 0, throttle = 1, active = () => true) {
  const md = stageMassFlow(stage, throttle, active);
  return md > 0 ? stageThrust(stage, pa, throttle, active) / (md * G0) : 0;
}

// ---------------------------------------------------------------------------
// Rocket equation / stage performance
// ---------------------------------------------------------------------------

/** Tsiolkovsky: dv = Isp * g0 * ln(m0 / mf). */
export function rocketDv(ispS, m0, mf) {
  return ispS * G0 * Math.log(m0 / mf);
}

/** Stage delta-v (m/s) in vacuum (or at pa) with a given payload on top. */
export function stageDeltaV(stage, { payload = 0, pa = 0, throttle = 1, propMass = stage.propMass, active } = {}) {
  const m0 = stage.dryMass + propMass + payload;
  const mf = stage.dryMass + payload;
  return rocketDv(stageIsp(stage, pa, throttle, active), m0, mf);
}

/** Time (s) to burn a stage's propellant at constant throttle. */
export function burnTime(stage, throttle = 1, propMass = stage.propMass, active) {
  return propMass / stageMassFlow(stage, throttle, active);
}

/** Full-stack liftoff numbers for a configuration. */
export function stackLiftoff(config = CONFIGS[DEFAULT_CONFIG], payload = 0, pa = P_SL) {
  const { booster, ship } = config;
  const mass = booster.dryMass + booster.propMass + ship.dryMass + ship.propMass + payload;
  const F = stageThrust(booster, pa, 1);
  return { mass, thrust: F, tw: F / (mass * G0) };
}

/**
 * Engine-group filter for an optimal vacuum burn: only the groups with the
 * highest vacuum Isp fire (for Starship: the 3 RVacs; the short-nozzle SL
 * Raptors, ~350 s in vacuum, are shut down since they would drag the
 * cluster Isp down and are reserved for landing).
 */
export function bestVacuumGroups(stage) {
  const best = Math.max(...stage.engines.map((g) => g.engine.ispVac));
  return (g) => g.engine.ispVac >= best - 1e-9;
}

/**
 * Stage vacuum delta-v capability (m/s) with a given payload, burning all
 * propellant on the highest-Isp engines only (e.g. RVac-only ship burn).
 */
export function stageVacuumDeltaV(stage, payload = 0, propMass = stage.propMass) {
  return stageDeltaV(stage, { payload, pa: 0, propMass, active: bestVacuumGroups(stage) });
}
