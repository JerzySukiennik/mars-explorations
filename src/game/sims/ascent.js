// Launch-to-orbit sim for Super Heavy + Starship from Starbase.
//
// Pure ES module (no DOM, no three.js). Vehicle numbers come from
// src/physics/vehicle.js (passed in as `V`, feature-detected); a built-in
// fallback with the same Block 2 figures keeps the game playable if that module
// changes shape.
//
// Dynamics: planar point mass in an Earth-fixed (rotating) polar frame (r, theta)
// with Coriolis and centrifugal terms, the Earth rate projected on the launch
// latitude. The HUD speed is the Earth-relative speed, as on the webcast.
// Drag uses a Mach-dependent Cd on the 9 m cross-section and an exponential
// atmosphere; ambient pressure drives Raptor back-pressure losses.

export const EARTH = { mu: 3.986004418e14, R: 6378137, omega: 7.2921150e-5 };
export const STARBASE_LAT_DEG = 25.997;
const G0 = 9.80665;
const DEG = Math.PI / 180;

/** Built-in stand-in for src/physics/vehicle.js (Block 2 / Raptor 2 figures). */
const FALLBACK = {
  booster: { dry: 275e3, prop: 3400e3, n: 33, fVac: 2.46e6, exitArea: 1.327, mdot: 703 },
  shipSL: { n: 3, fVac: 2.46e6, exitArea: 1.327, mdot: 703 },
  shipVac: { n: 3, fVac: 2.66e6, exitArea: 4.155, mdot: 703 },
  ship: { dry: 100e3, prop: 1500e3 },
  throttleMin: 0.4, mixtureRatio: 3.6,
};

/** Build an engine/stage model from the physics module if present. */
export function vehicleModel(V) {
  const ok = V && V.BOOSTER && V.SHIP && typeof V.thrust === 'function' && typeof V.massFlow === 'function';
  if (!ok) {
    const f = FALLBACK;
    const eng = (e) => ({
      thrust: (pa, thr) => thr <= 0 ? 0 : Math.max(0, e.fVac * Math.max(f.throttleMin, Math.min(1, thr)) - pa * e.exitArea),
      mdot: (thr) => thr <= 0 ? 0 : e.mdot * Math.max(f.throttleMin, Math.min(1, thr)),
    });
    return {
      source: 'fallback',
      booster: { dry: f.booster.dry, prop: f.booster.prop, groups: [{ count: 33, ...eng(f.booster), vac: false }] },
      ship: { dry: f.ship.dry, prop: f.ship.prop, groups: [{ count: 3, ...eng(f.shipSL), vac: false }, { count: 3, ...eng(f.shipVac), vac: true }] },
      throttleMin: f.throttleMin, mixtureRatio: f.mixtureRatio,
    };
  }
  const grp = (g) => ({
    count: g.count,
    vac: /vac/i.test(g.engine.name || '') || (g.engine.expansionRatio || 0) > 60,
    thrust: (pa, thr) => V.thrust(g.engine, pa, thr),
    mdot: (thr) => V.massFlow(g.engine, thr),
    separates: (pa, thr) => typeof V.flowSeparates === 'function' ? V.flowSeparates(g.engine, pa, thr) : false,
  });
  return {
    source: 'physics/vehicle.js',
    booster: { dry: V.BOOSTER.dryMass, prop: V.BOOSTER.propMass, groups: V.BOOSTER.engines.map(grp) },
    ship: { dry: V.SHIP.dryMass, prop: V.SHIP.propMass, groups: V.SHIP.engines.map(grp) },
    throttleMin: V.BOOSTER.engines[0]?.engine?.throttleMin ?? 0.4,
    mixtureRatio: V.PROPELLANT?.mixtureRatio ?? 3.6,
  };
}

// --- atmosphere (Earth, exponential; adequate for a point-mass ascent) -------
export function earthAtmosphere(h) {
  const hh = Math.max(0, h);
  const rho = 1.225 * Math.exp(-hh / 8500);
  const p = 101325 * Math.exp(-hh / 8000);
  const a = hh < 11000 ? 340.3 - 0.0041 * hh : hh < 20000 ? 295.1 : 295.1 + 0.001 * (hh - 20000);
  return { rho, p, a };
}

/** Drag coefficient vs Mach for a slender cylinder stack (transonic peak). */
export function cdMach(M) {
  if (M < 0.8) return 0.30;
  if (M < 1.2) return 0.30 + (M - 0.8) * 0.75;
  if (M < 3) return 0.60 - (M - 1.2) * 0.12;
  return Math.max(0.25, 0.384 - (M - 3) * 0.02);
}

// Booster engine layout, as on the webcast diagram: 3 centre, 10 inner ring, 20 outer ring.
export const BOOSTER_RINGS = [3, 10, 20];
/** Which booster engines are lit for a count (centre first, then inner, then outer). */
export function boosterLitMask(nLit) {
  const m = new Array(33).fill(false);
  for (let i = 0; i < Math.min(33, nLit); i++) m[i] = true;
  return m;
}

/** Piecewise-linear Cd(M) from a [[M, Cd], ...] table. */
export function tableCd(tab) {
  return (M) => {
    if (M <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) if (M <= tab[i][0]) { const [m0, c0] = tab[i - 1], [m1, c1] = tab[i]; return c0 + (c1 - c0) * (M - m0) / (m1 - m0); }
    return tab[tab.length - 1][1];
  };
}
const isTable = (t) => Array.isArray(t) && t.length > 1 && t.every((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]));

export function createAscent(opts = {}) {
  const veh = vehicleModel(opts.V);
  // Drag tables from src/physics/ascent.js (AS) when present.
  const AS = opts.AS;
  const cdStack = isTable(AS?.CD_SLENDER) ? tableCd(AS.CD_SLENDER) : cdMach;
  const cdBooster = isTable(AS?.CD_TAIL_FIRST) ? tableCd(AS.CD_TAIL_FIRST) : (M) => cdMach(M) * 3.2;
  const lat = (opts.latDeg ?? STARBASE_LAT_DEG) * DEG;
  const payload = opts.payload ?? 100e3;
  const s = {
    veh, payload,
    omega: EARTH.omega * Math.cos(lat),
    phase: 'prelaunch',          // prelaunch | countdown | booster | ship | orbit | failed
    t: -10,                      // mission clock (s), negative = countdown
    r: EARTH.R, th: 0, vr: 0, vt: 0,
    boosterProp: opts.boosterProp ?? veh.booster.prop,
    shipProp: opts.shipProp ?? veh.ship.prop,
    boosterLit: 0, shipLitSL: 0, shipLitVac: 0,
    throttle: 1, pitchDeg: 0, q: 0, maxQ: 0, maxQt: 0, mach: 0, accelG: 0,
    events: [], staged: false, stageTime: null, seco: false,
    boosterReserve: opts.boosterReserve ?? 0.10,     // fraction kept for boostback + catch
    targetAltKm: opts.targetAltKm ?? 160,
    cdStack, cdBooster, dragSource: cdStack === cdMach ? 'built-in' : 'physics/ascent.js',
    kickDeg: opts.kickDeg ?? 5.5,
    booster: null,               // separated booster sub-state
    failReason: null,
  };
  return s;
}

export function altitude(s) { return s.r - EARTH.R; }
export function speedRel(s) { return Math.hypot(s.vr, s.vt); }
export function downrange(s) { return s.th * EARTH.R; }

/** Inertial orbit apsides (km altitude) from the rotating-frame state. */
export function orbitOf(o, omega) {
  const vti = o.vt + omega * o.r;
  const v2 = o.vr * o.vr + vti * vti;
  const eps = v2 / 2 - EARTH.mu / o.r;
  const h = o.r * vti;
  const e = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (EARTH.mu * EARTH.mu)));
  if (eps >= 0) return { periKm: (h * h / EARTH.mu / (1 + e) - EARTH.R) / 1e3, apoKm: Infinity, e, vInertial: Math.sqrt(v2) };
  const a = -EARTH.mu / (2 * eps);
  return { periKm: (a * (1 - e) - EARTH.R) / 1e3, apoKm: (a * (1 + e) - EARTH.R) / 1e3, e, vInertial: Math.sqrt(v2) };
}

function log(s, name) { s.events.push({ t: s.t, name }); }

/** Integrate one body (state object with r, th, vr, vt) for dt under thrust accel (ar, at). */
function integrate(o, dt, ar, at, omega) {
  const g = EARTH.mu / (o.r * o.r);
  const aR = ar - g + o.vt * o.vt / o.r + 2 * omega * o.vt + omega * omega * o.r;
  const aT = at - o.vr * o.vt / o.r - 2 * omega * o.vr;
  o.vr += aR * dt; o.vt += aT * dt;
  o.r += o.vr * dt; o.th += o.vt / o.r * dt;
}

function dragAccel(o, mass, cdScale = 1, cdFn = cdMach) {
  const h = o.r - EARTH.R;
  const atm = earthAtmosphere(h);
  const v = Math.hypot(o.vr, o.vt);
  const M = v / atm.a;
  const q = 0.5 * atm.rho * v * v;
  const A = Math.PI * 4.5 * 4.5;
  const D = q * cdFn(M) * A * cdScale;
  const k = v > 1e-6 ? D / mass / v : 0;
  return { ar: -k * o.vr, at: -k * o.vt, q, M, p: atm.p };
}

function groupThrust(groups, sel, pa, thr, counts) {
  let F = 0, md = 0;
  groups.forEach((g, i) => {
    const n = counts[i] ?? 0;
    if (!n || !sel(g)) return;
    F += n * g.thrust(pa, thr); md += n * g.mdot(thr);
  });
  return { F, md };
}

/**
 * Advance the ascent. controls: { throttle 0.4..1, stage bool, cutoff bool,
 * pitchBias deg, autoThrottle bool, start bool }.
 */
export function stepAscent(s, dt, c = {}) {
  if (s.phase === 'prelaunch') {
    if (c.start) { s.phase = 'countdown'; s.t = -10; log(s, 'COUNTDOWN'); }
    return s;
  }
  if (s.phase === 'failed') return s;
  const sub = Math.max(1, Math.ceil(dt / 0.05));
  const h = dt / sub;
  for (let i = 0; i < sub; i++) step1(s, h, c);
  return s;
}

function step1(s, dt, c) {
  const { veh } = s;
  s.t += dt;
  const alt = s.r - EARTH.R;
  const thrCmd = Math.max(veh.throttleMin, Math.min(1, c.throttle ?? s.throttle));

  if (s.phase === 'countdown') {
    // Engine startup sequence: centre, inner, outer rings light from T-3 s.
    if (s.t >= -3) s.boosterLit = Math.min(33, Math.round((s.t + 3) / 2.2 * 33));
    if (s.t >= 0) {
      const W = (veh.booster.dry + s.boosterProp + veh.ship.dry + s.shipProp + s.payload) * 9.81;
      const F = groupThrust(veh.booster.groups, () => true, 101325, thrCmd, [33]).F;
      if (F > W) { s.phase = 'booster'; s.boosterLit = 33; log(s, 'LIFTOFF'); }
      else if (s.t > 3) { s.phase = 'failed'; s.failReason = 'Thrust below weight: hold-down abort'; log(s, 'ABORT'); }
    }
    return;
  }

  if (s.phase === 'booster' || s.phase === 'ship') {
    const onBooster = s.phase === 'booster';
    const mass = (onBooster ? veh.booster.dry + s.boosterProp : 0) + veh.ship.dry + s.shipProp + s.payload;
    const d = dragAccel(s, mass, onBooster ? 1 : 0.7, s.cdStack);
    s.q = d.q; s.mach = d.M;
    if (d.q > s.maxQ) { s.maxQ = d.q; s.maxQt = s.t; }
    else if (!s.events.some((e) => e.name === 'MAX-Q') && s.maxQ > 20e3 && d.q < 0.97 * s.maxQ) log(s, 'MAX-Q');

    let thr = thrCmd;
    let F = 0, md = 0;
    if (onBooster) {
      // Auto-throttle: bucket through max-Q, and limit to ~3.5 g near MECO.
      if (c.autoThrottle !== false) {
        if (d.q > 28e3) thr = Math.min(thr, Math.max(0.7, 1 - (d.q - 28e3) / 40e3));
        const Ffull = groupThrust(veh.booster.groups, () => true, d.p, 1, [33]).F;
        const gLim = 3.4 * G0 * mass / Ffull;
        thr = Math.min(thr, Math.max(veh.throttleMin, gLim));
      }
      const r = groupThrust(veh.booster.groups, () => true, d.p, thr, [s.boosterLit]);
      F = r.F; md = r.md;
      s.boosterProp -= md * dt;
      const reserve = s.boosterReserve * veh.booster.prop;
      if (c.stage || s.boosterProp <= 0 || (c.autoStage && s.boosterProp <= reserve)) {
        stage(s);
        return;
      }
    } else if (!s.seco) {
      if (s.t - s.stageTime < 1.5) { F = 0; md = 0; }
      else {
        s.shipLitSL = 3; s.shipLitVac = 3;
        if (c.autoThrottle !== false) {
          const Ffull = groupThrust(veh.ship.groups, () => true, d.p, 1, [3, 3]).F;
          thr = Math.min(thr, Math.max(veh.throttleMin, 3.2 * G0 * mass / Ffull));
        }
        const r = groupThrust(veh.ship.groups, () => true, d.p, thr, [s.shipLitSL, s.shipLitVac]);
        F = r.F; md = r.md;
        s.shipProp -= md * dt;
      }
      const orb = orbitOf(s, s.omega);
      if (c.cutoff || s.shipProp <= 0 || (c.autoCutoff !== false && orb.periKm >= s.targetAltKm - 10)) {
        s.seco = true; s.shipLitSL = 0; s.shipLitVac = 0; F = 0; md = 0;
        s.shipProp = Math.max(0, s.shipProp);
        log(s, 'SECO');
        s.phase = orb.periKm > 120 ? 'orbit' : 'failed';
        if (s.phase === 'failed') s.failReason = `Suborbital: perigee ${orb.periKm.toFixed(0)} km`;
      }
    }
    s.throttle = thr;

    // Guidance -> thrust direction (angle from local vertical, toward downrange).
    let chi;
    if (onBooster) {
      const v = Math.hypot(s.vr, s.vt);
      if (alt < 400 || v < 60) chi = 0;
      else if (v < 120) chi = (v - 60) / 60 * s.kickDeg;               // pitch kick
      else chi = Math.atan2(s.vt, s.vr) / DEG;                  // gravity turn
      chi += c.pitchBias ?? 0;
    } else {
      // Ship: steer the vertical acceleration to settle at the target altitude.
      const acc = F / mass;
      const hT = s.targetAltKm * 1e3;
      const vti = s.vt + s.omega * s.r;
      const gEff = Math.max(0.3, EARTH.mu / (s.r * s.r) - vti * vti / s.r);
      const dh = hT - alt;
      const vrDes = Math.sign(dh) * Math.sqrt(2 * gEff * Math.abs(dh)) * 0.95;
      const need = (vrDes - s.vr) / 12 + EARTH.mu / (s.r * s.r) - vti * vti / s.r;
      const sinE = acc > 0 ? Math.max(-0.35, Math.min(0.95, need / acc)) : 0;
      chi = 90 - Math.asin(sinE) / DEG + (c.pitchBias ?? 0);
    }
    if (!onBooster && s.t - s.stageTime > 1.5) {
      const maxRate = 4 * dt;                       // deg per step: attitude rate limit
      chi = s.pitchDeg + Math.max(-maxRate, Math.min(maxRate, chi - s.pitchDeg));
    }
    s.pitchDeg = chi;
    const ar = F / mass * Math.cos(chi * DEG), at = F / mass * Math.sin(chi * DEG);
    s.accelG = Math.hypot(ar + d.ar, at + d.at) / G0;
    integrate(s, dt, ar + d.ar, at + d.at, s.omega);
    if (s.r < EARTH.R && s.t > 5) { s.phase = 'failed'; s.failReason = 'Vehicle impacted the ground'; }
  }
  if (s.booster) stepBooster(s, dt);
}

function stage(s) {
  s.staged = true; s.stageTime = s.t; s.phase = 'ship';
  log(s, 'MECO'); log(s, 'STAGE SEP');
  s.booster = { r: s.r, th: s.th, vr: s.vr, vt: s.vt, prop: Math.max(0, s.boosterProp), mode: 'hotstage', lit: 3, t0: s.t, outcome: null };
  s.boosterLit = 3;
}

// Booster return: hot-stage throttle-down, boostback toward the launch site,
// coast, landing burn (13 then 3 engines), tower catch if slow and near the pad.
function stepBooster(s, dt) {
  const b = s.booster;
  if (b.outcome) return;
  const { veh } = s;
  const mass = veh.booster.dry + b.prop;
  const d = dragAccel(b, mass, 1, s.cdBooster); // engine-first fall with grid fins: blunt
  const alt = b.r - EARTH.R;
  let lit = 0, dirR = 0, dirT = 0;
  const g = EARTH.mu / (b.r * b.r);
  if (b.mode === 'hotstage') { lit = 3; dirR = b.vr; dirT = b.vt; if (s.t - b.t0 > 4) b.mode = 'flip'; }
  else if (b.mode === 'flip') { lit = 0; if (s.t - b.t0 > 14) { b.mode = 'boostback'; log(s, 'BOOSTBACK'); } }
  if (b.mode === 'boostback') {
    // ballistic ground range estimate (flat, no drag) for the landing point
    const tf = (b.vr + Math.sqrt(b.vr * b.vr + 2 * g * Math.max(0, alt))) / g;
    const xLand = b.th * EARTH.R + b.vt * tf;
    if (xLand <= 1500 || b.prop < 0.3 * veh.booster.prop * s.boosterReserve) { b.mode = 'coast'; log(s, 'BOOSTBACK SHUTDOWN'); }
    else { lit = 13; dirR = -0.2; dirT = -1; }
  }
  if (b.mode === 'coast') {
    const aMax = groupThrust(veh.booster.groups, () => true, d.p, 1, [13]).F / mass - g;
    const v = Math.hypot(b.vr, b.vt);
    if (b.vr < 0 && aMax > 0 && alt < 4000 && alt <= v * v / (2 * aMax) * 1.1 + 300) { b.mode = 'landing'; log(s, 'LANDING BURN'); }
  }
  if (b.mode === 'landing') {
    const v = Math.hypot(b.vr, b.vt);
    lit = v > 60 ? 13 : 3;
    dirR = -b.vr; dirT = -b.vt;
  }
  if (b.prop <= 0) lit = 0;
  let F = 0, md = 0;
  if (lit) {
    let thr = 1;
    if (b.mode === 'landing' && lit === 3) {
      const need = (b.vr * b.vr) / (2 * Math.max(5, alt)) + g;
      const Fmax = groupThrust(veh.booster.groups, () => true, d.p, 1, [3]).F;
      thr = Math.max(0.4, Math.min(1, need * mass / Fmax));
    }
    const r = groupThrust(veh.booster.groups, () => true, d.p, thr, [lit]);
    F = r.F; md = r.md;
    b.prop = Math.max(0, b.prop - md * dt);
  }
  const n = Math.hypot(dirR, dirT) || 1;
  b.lit = lit;
  integrate(b, dt, F / mass * dirR / n + d.ar, F / mass * dirT / n + d.at, s.omega);
  if (b.r <= EARTH.R) {
    const v = Math.hypot(b.vr, b.vt), x = b.th * EARTH.R;
    b.outcome = v < 12 && Math.abs(x) < 3000 ? 'CAUGHT' : v < 12 ? 'SOFT SPLASHDOWN' : 'LOST';
    b.r = EARTH.R; b.vr = b.vt = 0; b.lit = 0;
    log(s, `BOOSTER ${b.outcome}`);
  }
  s.boosterLit = b.lit;
}

/** Loaded propellant split into LOX/CH4 fractions for the webcast bars. */
export function tankFractions(s) {
  return {
    booster: Math.max(0, (s.booster ? s.booster.prop : s.boosterProp) / s.veh.booster.prop),
    ship: Math.max(0, s.shipProp / s.veh.ship.prop),
  };
}

/** Summary handed to the next phase / scorer. */
export function ascentResult(s) {
  const orb = orbitOf(s, s.omega);
  return {
    success: s.phase === 'orbit',
    periKm: orb.periKm, apoKm: orb.apoKm, vInertial: orb.vInertial,
    shipPropKg: Math.max(0, s.shipProp), maxQkPa: s.maxQ / 1e3, t: s.t,
    boosterOutcome: s.booster?.outcome ?? (s.staged ? 'IN FLIGHT' : 'NOT STAGED'),
    failReason: s.failReason,
  };
}
