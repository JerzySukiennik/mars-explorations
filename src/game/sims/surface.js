// Surface operations: rover driving, rover power (MMRTG + Li-ion), base power
// (solar field + battery bank), regolith logistics and 3D printing.
//
// Pure ES module. Rover physics from src/physics/rover.js (`RV`) and printer
// physics from src/physics/printer.js (`PR`), both feature-detected with
// built-in fallbacks carrying the same published figures.
//
// Game abstractions (documented in README): the rover tows a regolith cart
// (capacity CART_KG) that a scoop fills at the dig site; the base has a
// fixed-site excavator feed hopper at the printer.

const DEG = Math.PI / 180;
export const SOL_H = 24.6597;
export const CART_KG = 3000;
export const DIG_RATE_KGS = 2.0;          // scoop + cart fill
export const UNLOAD_RATE_KGS = 5.0;
export const CHARGER_W = 900;             // base charging station into the rover bus
export const SITE_RADIUS = 7;             // m, interaction radius

// ---------------------------------------------------------------- recipes --
/** Build menu. Sizes are the game's standard items. */
export const RECIPES = Object.freeze({
  pad: { name: 'Landing pad', desc: '8 m dia x 0.12 m regolith-polymer', kind: 'landingPad', args: [8, 0.12], machine: 'structure', footprint: 5 },
  wall: { name: 'Wall segment', desc: '4 m x 1.2 m x 0.3 m geopolymer', kind: 'wall', args: [4, 1.2, 0.3], machine: 'structure', footprint: 3 },
  habitat: { name: 'Habitat shell', desc: 'Dome r 2.0 m, 0.25 m shell', kind: 'domeShell', args: [2.0, 0.25], machine: 'structure', footprint: 3 },
  wheel: { name: 'Rover spare wheel', desc: '52.7 cm aluminium-class wheel, metal DED', kind: 'wheel', args: [], machine: 'part', footprint: 1 },
});

const FALLBACK_STRUCT = {
  landingPad: (d, t) => ({ kind: 'landingPad', volume: Math.PI * (d / 2) ** 2 * t, grade: 'pad' }),
  wall: (l, h, t) => ({ kind: 'wall', volume: l * h * t, grade: 'wall' }),
  domeShell: (r, t) => ({ kind: 'domeShell', volume: (2 / 3) * Math.PI * ((r + t) ** 3 - r ** 3), grade: 'wall' }),
};

/** Plan a recipe: mass, regolith, time (s), power (W), energy (J). */
export function planRecipe(key, PR) {
  const r = RECIPES[key];
  if (!r) throw new Error(`unknown recipe ${key}`);
  if (r.machine === 'part') {
    const wheelMass = 3.4;                                    // kg (M2020 wheel is ~3.4 kg Al)
    let rate = 1.57e-4, ePerKg = 1.82e7;
    if (PR && typeof PR.metalDeposition === 'function') {
      try { const d = PR.metalDeposition(); if (d.rate > 0) { rate = d.rate; ePerKg = d.energyPerKg; } } catch { /* fall back */ }
    }
    const printTime = wheelMass / rate;
    const power = ePerKg * rate;
    // feedstock iron from regolith (~13 % recoverable Fe) -> ~26 kg regolith
    return { key, name: r.name, mass: wheelMass, regolithMass: wheelMass / 0.13, printTime, power, energy: power * printTime };
  }
  const S = PR?.STRUCTURES?.[r.kind] ?? FALLBACK_STRUCT[r.kind];
  const st = S(...r.args);
  if (PR && typeof PR.planStructure === 'function') {
    try {
      const p = PR.planStructure(st);
      if (Number.isFinite(p.mass) && Number.isFinite(p.printTime)) {
        return { key, name: r.name, mass: p.mass, regolithMass: p.regolithMass ?? p.mass * 0.9, printTime: p.printTime, power: p.power, energy: p.energy, volume: st.volume };
      }
    } catch { /* fall back */ }
  }
  // fallback: 2340 kg/m^3 printed, 0.85 regolith fraction, 0.094 m^3/h, 15 kW
  const mass = st.volume * 2340, printTime = st.volume / (0.094 / 3600), power = 15e3;
  return { key, name: r.name, mass, regolithMass: mass * 0.85, printTime, power, energy: power * printTime, volume: st.volume };
}

// ---------------------------------------------------------------- terrain --
/** Built-in gentle terrain (m) used when the scene exposes no height function. */
export function fallbackHeight(x, z) {
  return 1.2 * Math.sin(x * 0.045) * Math.cos(z * 0.038) + 0.6 * Math.sin((x + z) * 0.11) + 2.5 * Math.sin(x * 0.012 + 1) * Math.sin(z * 0.015);
}

/** Rover forward unit vector for a heading. Convention (shared with the
 * surface scene): world +x east, -z north, heading 0 = north, positive heading
 * turns left (counter-clockwise seen from above), forward = (-sin h, -cos h). */
export function forward(heading) { return [-Math.sin(heading), -Math.cos(heading)]; }

/** Heading that points from (x, z) toward (tx, tz). */
export function headingTo(x, z, tx, tz) { return Math.atan2(-(tx - x), -(tz - z)); }

/** Slope along heading (deg, + uphill) and cross slope (deg, + = left side high). */
export function slopes(heightAt, x, z, heading) {
  const d = 0.8;
  const [fx, fz] = forward(heading);
  const rx = -fz, rz = fx;                         // right-hand side (cos h, -sin h)
  const along = (heightAt(x + fx * d, z + fz * d) - heightAt(x - fx * d, z - fz * d)) / (2 * d);
  const cross = (heightAt(x - rx * d, z - rz * d) - heightAt(x + rx * d, z + rz * d)) / (2 * d);
  return { along: Math.atan(along) / DEG, cross: Math.atan(cross) / DEG };
}

// ------------------------------------------------------------ rover model --
export function roverModel(RV) {
  const has = (n) => RV && typeof RV[n] === 'function';
  const topSpeed = RV?.ROVER?.topSpeed_m_s ?? 0.042;
  return {
    source: has('groundSpeed') ? 'physics/rover.js' : 'fallback',
    topSpeed,
    slip: has('slipFraction') ? RV.slipFraction : (sl) => sl <= 0 ? 0.03 : Math.min(0.95, 0.03 + 0.0006 * Math.pow(sl, 2.5)),
    load: has('activityLoad') ? (mode, Tair, drive) => { try { return RV.activityLoad(mode, Tair, drive); } catch { return 200; } }
      : (mode, Tair, drive) => mode === 'sleep' ? 60 : mode === 'drive' ? (drive?.moving ? 380 : 230) : mode === 'arm' ? 260 : 160,
    climate: has('makeClimate') ? RV.makeClimate() : (t) => ({ Tair: 215 + 25 * Math.sin((t / SOL_H - 0.3) * 2 * Math.PI), Ts: 220, Tsky: 150 }),
    cosZenith: has('cosZenith') ? (t) => RV.cosZenith(t) : (t) => Math.cos(2 * Math.PI * (t / SOL_H - 0.5)) * 0.94,
    makeBattery: has('createBattery') ? (soc) => RV.createBattery({ soc }) : (soc) => {
      const cap = 2400 * 3600; let e = soc * cap;
      return { get soc() { return e / cap; }, get voltage() { return 28 + 4 * e / cap; }, step(P, dt) { e = Math.max(0, Math.min(cap, e + P * dt)); return 0; } };
    },
    makeMMRTG: (climate) => {
      if (has('createMMRTG')) { try { return RV.createMMRTG({ climate, t0_h: 9 }); } catch { /* fall through */ } }
      return { get power() { return 110; }, step() { return 110; } };
    },
    batteryWh: has('batteryEnergyWh') ? RV.batteryEnergyWh() : 2400,
  };
}

// ----------------------------------------------------------------- create --
export function createSurface(opts = {}) {
  const rm = roverModel(opts.RV);
  const sites = {
    charger: { x: -10, z: 8 }, printer: { x: 14, z: -6 }, dig: { x: 34, z: 26 },
    plots: { pad: { x: 40, z: -30 }, wall: { x: 6, z: -22 }, habitat: { x: 22, z: -30 }, wheel: { x: 14, z: -6 } },
    ...(opts.sites || {}),
  };
  const climate = rm.climate;
  return {
    rm, sites, PR: opts.PR,
    heightAt: opts.heightAt || fallbackHeight,
    t_h: opts.startHour ?? 9.0, sol: 1,
    rover: {
      x: opts.roverX ?? -4, z: opts.roverZ ?? 4, heading: opts.heading ?? -2.2, speed: 0,
      battery: rm.makeBattery(0.8), mmrtg: rm.makeMMRTG(climate),
      load: 0, gen: 110, charging: 0, mode: 'wake', slopeDeg: 0, crossDeg: 0, slip: 0,
      odometer: 0, wheelHealth: 1, lowPower: false, sliding: 0,
    },
    cart: 0, stockpile: opts.stockpile ?? 4000, digging: false, unloading: false,
    base: {
      solarArea: 1000, cellEff: 0.25, dustFactor: 0.8, bankWh: 300e3, bankMaxWh: 500e3,
      baseLoadW: 4000, solarW: 0, printerW: 0, spareWheels: 0,
    },
    jobs: [], built: [], log: [],
    objectives: { pad: false, habitat: false },
    message: '',
  };
}

// ------------------------------------------------------------------- step --
function near(s, site) { return Math.hypot(s.rover.x - site.x, s.rover.z - site.z) <= SITE_RADIUS; }

export function nearSite(s) {
  if (near(s, s.sites.charger)) return 'charger';
  if (near(s, s.sites.printer)) return 'printer';
  if (near(s, s.sites.dig)) return 'dig';
  return null;
}

/** Queue a print job. Returns {ok, reason}. */
export function queueJob(s, key) {
  const r = RECIPES[key];
  if (!r) return { ok: false, reason: 'unknown item' };
  const plan = planRecipe(key, s.PR);
  const idx = s.built.filter((b) => b.key === key).length + s.jobs.filter((j) => j.key === key).length;
  const plot = { ...(s.sites.plots[key] || s.sites.printer) };
  if (key === 'wall') { plot.x += idx * 4.2; }
  else if (key !== 'wheel') { plot.x += idx * (r.footprint * 2 + 2); }
  s.jobs.push({ key, plan, progress: 0, fedKg: 0, status: 'queued', plot, id: `${key}-${s.jobs.length + s.built.length}` });
  return { ok: true, plan };
}

/**
 * Advance dt sim seconds. controls: { drive -1..1, steer -1..1, action bool
 * (dig / unload / install wheel), cancelAction bool }
 */
export function stepSurface(s, dt, c = {}) {
  const sub = Math.max(1, Math.ceil(dt / 5));
  const h = dt / sub;
  for (let i = 0; i < sub; i++) step1(s, h, c, i === 0);
  return s;
}

function step1(s, dt, c, first) {
  const R = s.rover, rm = s.rm, B = s.base;
  s.t_h += dt / 3600;
  if (s.t_h >= SOL_H) { s.t_h -= SOL_H; s.sol += 1; }
  const clim = rm.climate(s.t_h);

  // --- actions
  const site = nearSite(s);
  if (first && c.action) {
    if (site === 'dig' && s.cart < CART_KG) { s.digging = !s.digging; s.unloading = false; }
    else if (site === 'printer' && s.cart > 0) { s.unloading = !s.unloading; s.digging = false; }
    else if (site === 'printer' && B.spareWheels > 0 && R.wheelHealth < 0.999) { B.spareWheels -= 1; R.wheelHealth = 1; s.message = 'Spare wheel installed'; }
  }
  if (site !== 'dig') s.digging = false;
  if (site !== 'printer') s.unloading = false;
  if (s.digging) { const d = Math.min(CART_KG - s.cart, DIG_RATE_KGS * dt); s.cart += d; if (s.cart >= CART_KG - 1e-6) { s.digging = false; s.message = 'Cart full'; } }
  if (s.unloading) { const d = Math.min(s.cart, UNLOAD_RATE_KGS * dt); s.cart -= d; s.stockpile += d; if (s.cart <= 1e-6) { s.cart = 0; s.unloading = false; s.message = 'Cart unloaded'; } }

  // --- rover mobility
  const busy = s.digging || s.unloading;
  const cmd = R.lowPower || busy ? 0 : Math.max(-1, Math.min(1, c.drive ?? 0));
  const steer = R.lowPower || busy ? 0 : Math.max(-1, Math.min(1, c.steer ?? 0));
  const sl = slopes(s.heightAt, R.x, R.z, R.heading);
  const slopeDeg = sl.along * Math.sign(cmd || 1);
  R.slopeDeg = sl.along; R.crossDeg = sl.cross;
  const slip = rm.slip(slopeDeg);
  R.slip = cmd ? slip : 0;
  const wheelFactor = 0.5 + 0.5 * R.wheelHealth;
  const cartFactor = 1 - 0.25 * (s.cart / CART_KG);            // heavier cart -> lower speed
  R.speed = cmd * rm.topSpeed * (1 - slip) * wheelFactor * cartFactor;
  // Perseverance turns in place / arcs: ~ 3 deg/s steering rate at top speed.
  R.heading += steer * 3 * DEG * dt * (cmd ? 1 : 0.8);
  const [fx, fz] = forward(R.heading);
  R.x += fx * R.speed * dt;
  R.z += fz * R.speed * dt;
  // sliding sideways down steep cross-slopes (toward the low side)
  R.sliding = 0;
  if (Math.abs(sl.cross) > 18) {
    const v = 0.004 * (Math.abs(sl.cross) - 18);
    const sgn = Math.sign(sl.cross);                // + : left side high -> slide right
    R.x += -fz * v * dt * sgn; R.z += fx * v * dt * sgn;
    R.sliding = v;
  }
  const dist = Math.abs(R.speed * dt);
  R.odometer += dist;
  R.wheelHealth = Math.max(0, R.wheelHealth - dist * (1 + Math.abs(sl.along) / 10) * 4e-5);

  // --- rover power
  const moving = Math.abs(cmd) > 0.01;
  R.mode = R.lowPower ? 'sleep' : s.digging ? 'arm' : moving ? 'drive' : 'wake';
  R.load = rm.load(R.mode, clim.Tair, { moving, slopeDeg: Math.max(0, slopeDeg) });
  R.gen = R.mmrtg.step(dt, s.t_h);
  R.charging = site === 'charger' && B.bankWh > 1000 ? CHARGER_W : 0;
  R.battery.step(R.gen + R.charging - R.load, dt);
  B.bankWh -= R.charging * dt / 3600;
  if (R.battery.soc < 0.08 && !R.lowPower) { R.lowPower = true; s.message = 'Rover battery low: safe mode, recharging on MMRTG'; }
  if (R.lowPower && R.battery.soc > 0.25) { R.lowPower = false; s.message = 'Rover out of safe mode'; }

  // --- base power: solar field (590 W/m^2 at 1.52 AU, cos zenith, dust) + bank
  const mu = Math.max(0, rm.cosZenith(s.t_h));
  B.solarW = B.solarArea * 590 * B.cellEff * B.dustFactor * mu;
  let avail = B.solarW - B.baseLoadW;                      // W left after base loads

  // --- printers: jobs run in order; one structure and one part at a time
  let structBusy = false, partBusy = false;
  B.printerW = 0;
  for (const j of s.jobs) {
    if (j.status === 'done') continue;
    const isPart = RECIPES[j.key].machine === 'part';
    if ((isPart && partBusy) || (!isPart && structBusy)) { j.status = 'queued'; continue; }
    if (isPart) partBusy = true; else structBusy = true;
    const p = j.plan;
    const need = p.power;
    const energyOk = avail >= need || B.bankWh > need * dt / 3600 + 5000;
    const feedRate = p.regolithMass / p.printTime;               // kg/s
    const feedOk = s.stockpile >= feedRate * dt;
    if (!energyOk) { j.status = 'no power'; continue; }
    if (!feedOk) { j.status = 'no regolith'; continue; }
    j.status = 'printing';
    s.stockpile -= feedRate * dt; j.fedKg += feedRate * dt;
    j.progress = Math.min(1, j.progress + dt / p.printTime);
    avail -= need; B.printerW += need;
    if (j.progress >= 1) {
      j.status = 'done';
      s.built.push({ key: j.key, plot: j.plot, id: j.id, sol: s.sol, t_h: s.t_h });
      if (j.key === 'wheel') B.spareWheels += 1;
      if (j.key === 'pad') s.objectives.pad = true;
      if (j.key === 'habitat') s.objectives.habitat = true;
      s.message = `${RECIPES[j.key].name} complete`;
    }
  }
  // Bank absorbs surplus / covers deficit.
  B.bankWh = Math.max(0, Math.min(B.bankMaxWh, B.bankWh + avail * dt / 3600));
  s.jobs = s.jobs.filter((j) => j.status !== 'done');
}

export function missionElapsedSols(s) { return s.sol - 1 + s.t_h / SOL_H; }

export function surfaceResult(s) {
  return {
    success: s.objectives.pad && s.objectives.habitat,
    sols: missionElapsedSols(s), built: s.built.map((b) => b.key),
    odometer: s.rover.odometer, stockpile: s.stockpile,
  };
}

/** Local solar time string HH:MM (Mars "hours" as LMST scaled 24 h). */
export function lmst(t_h) {
  const x = t_h / SOL_H * 24;
  const hh = Math.floor(x), mm = Math.floor((x - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
