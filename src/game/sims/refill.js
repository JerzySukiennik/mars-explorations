// Orbital refilling: tanker rendezvous (Clohessy-Wiltshire relative motion),
// docking, propellant transfer and boil-off in LEO.
//
// Pure ES module. If src/physics/refill.js exists it is passed in as `R` and
// its constants/functions are used where recognised (feature-detected by name);
// otherwise the documented game defaults below apply.
//
// Frame (LVLH of the depot ship): x radial (up), y along-track (velocity
// direction), z cross-track. The player flies the tanker.

const MU_E = 3.986004418e14, R_E = 6378137;

export const DEFAULTS = Object.freeze({
  orbitAltKm: 200,
  // refs/data/p-refill.real.json: 150 t per tanker, 5 t/min transfer, 0.1 %/day boil-off
  tankerDeliveryKg: 150e3,       // usable propellant per tanker flight
  transferRateKgS: 5000 / 60,    // settled-ullage transfer, 5 t/min
  boiloffPerDay: 0.001,          // fraction of loaded propellant per day
  cadenceDays: 6,                // tanker launch spacing
  rcsAccel: 0.08,                // m/s^2 tanker RCS translation authority
  startRange: 600,               // m behind on V-bar
  dockRange: 3,                  // m, soft-capture ring contact
  dockMaxSpeed: 0.3,             // m/s closing speed for capture
  dockMaxLateral: 1.0,           // m misalignment for capture
  crashSpeed: 0.8,               // m/s contact speed that damages the ports
  shipCapacityKg: 1500e3,
});

const pickNum = (obj, names, dflt) => {
  if (!obj) return dflt;
  for (const n of names) {
    const v = obj[n];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v && typeof v === 'object') for (const k of ['value', 'kg', 'rate']) if (Number.isFinite(v[k])) return v[k];
  }
  return dflt;
};

/** Merge recognised values from src/physics/refill.js into the defaults. */
export function refillParams(R, over = {}) {
  const p = { ...DEFAULTS };
  if (R) {
    const t = (names) => { const v = pickNum(R, names, NaN); return Number.isFinite(v) ? v * 1000 : NaN; };
    const or = (...v) => v.find(Number.isFinite);
    p.tankerDeliveryKg = or(pickNum(R, ['TANKER_DELIVERY_KG', 'tankerDeliveryKg', 'TANKER_PAYLOAD_KG', 'tankerPayloadKg', 'propPerTankerKg', 'PROP_PER_TANKER_KG'], NaN),
      t(['prop_per_tanker_t', 'PROP_PER_TANKER_T', 'propPerTankerT']), p.tankerDeliveryKg);
    p.transferRateKgS = or(pickNum(R, ['TRANSFER_RATE_KG_S', 'transferRateKgS', 'transferRate_kg_s'], NaN),
      t(['transfer_rate_t_per_min', 'transferRateTPerMin']) / 60, p.transferRateKgS);
    p.boiloffPerDay = or(pickNum(R, ['BOILOFF_PER_DAY', 'boiloffPerDay', 'BOILOFF_FRACTION_PER_DAY'], NaN),
      pickNum(R, ['boiloff_pct_per_day', 'boiloffPctPerDay'], NaN) / 100, p.boiloffPerDay);
    p.source = 'physics/refill.js';
  } else p.source = 'game defaults';
  return Object.assign(p, over);
}

export function meanMotion(altKm) {
  const a = R_E + altKm * 1e3;
  return Math.sqrt(MU_E / (a * a * a));
}

/** One Clohessy-Wiltshire step (semi-implicit, substepped). acc = [ax, ay, az] m/s^2. */
export function cwStep(st, acc, dt, n) {
  const sub = Math.max(1, Math.ceil(dt / 0.5));
  const h = dt / sub;
  for (let i = 0; i < sub; i++) {
    const ax = 3 * n * n * st.x + 2 * n * st.vy + acc[0];
    const ay = -2 * n * st.vx + acc[1];
    const az = -n * n * st.z + acc[2];
    st.vx += ax * h; st.vy += ay * h; st.vz += az * h;
    st.x += st.vx * h; st.y += st.vy * h; st.z += st.vz * h;
  }
  return st;
}

export function createRefill(opts = {}) {
  const p = refillParams(opts.R, opts.params);
  return {
    p,
    n: meanMotion(p.orbitAltKm),
    day: 0,                                   // days since the depot reached orbit
    shipProp: opts.shipPropKg ?? 60e3,
    lostBoiloff: 0,
    tankers: [],                              // results per tanker
    mode: 'waiting',                          // waiting | approach | docked | transfer | done | failed
    rel: null,
    nextTankerDay: opts.firstTankerDay ?? 0.5,
    current: null,
    fuelUsedRcs: 0,
    failReason: null,
    message: 'Tanker 1 launching',
  };
}

function spawnTanker(s) {
  const k = s.tankers.length + 1;
  // Arrive on V-bar behind the depot with a small residual drift and offset.
  const jitter = (a) => (Math.sin(k * 12.9898 + a) * 43758.5453) % 1;
  s.rel = { x: 4 * jitter(1), y: -s.p.startRange, z: 3 * jitter(2), vx: 0, vy: 0.4, vz: 0.02 * jitter(3) };
  s.current = { index: k, delivered: 0, dockSpeed: null, lateral: null, auto: false, startDay: s.day };
  s.mode = 'approach';
  s.message = `Tanker ${k} on V-bar, ${s.p.startRange} m`;
}

export function range(rel) { return Math.hypot(rel.x, rel.y, rel.z); }

/** Autopilot: V-bar approach with a closing-speed schedule. Returns accel command. */
export function autoApproach(rel, p) {
  const r = Math.max(0, -rel.y - 0.5);
  const vDes = Math.min(1.5, 0.004 * r + 0.08);           // closing speed schedule
  const k = 0.05, kd = 0.4;
  const ax = -k * rel.x - kd * rel.vx;
  const az = -k * rel.z - kd * rel.vz;
  const ay = 0.3 * (vDes - rel.vy);
  const lim = (a) => Math.max(-p.rcsAccel, Math.min(p.rcsAccel, a));
  return [lim(ax), lim(ay), lim(az)];
}

/**
 * controls: { thrust:[-1..1 x3] (radial, along-track, cross), auto bool,
 * skip bool (jump to next tanker), finish bool, warpDays (days per real second is handled by caller) }
 */
export function stepRefill(s, dt, c = {}) {
  if (s.mode === 'done' || s.mode === 'failed') return s;
  const days = dt / 86400;
  // Boil-off applies at all times to what is in the tanks.
  const boil = s.shipProp * s.p.boiloffPerDay * days;
  s.shipProp -= boil; s.lostBoiloff += boil;
  s.day += days;

  if (c.finish && s.mode !== 'approach' && s.mode !== 'transfer') { s.mode = 'done'; s.message = 'Depot ready for TMI'; return s; }

  if (s.mode === 'waiting') {
    if (c.skip && s.nextTankerDay > s.day) {
      // jump to the next tanker arrival, boiling off the propellant on the way
      const dd = s.nextTankerDay - s.day;
      const left = s.shipProp * Math.pow(1 - s.p.boiloffPerDay, dd);
      s.lostBoiloff += s.shipProp - left; s.shipProp = left; s.day = s.nextTankerDay;
    }
    if (s.day >= s.nextTankerDay) spawnTanker(s);
    else s.message = `Next tanker in ${(s.nextTankerDay - s.day).toFixed(1)} d`;
    return s;
  }
  if (s.mode === 'approach') {
    const rel = s.rel;
    let acc;
    if (c.auto) { acc = autoApproach(rel, s.p); s.current.auto = true; }
    else {
      const t = c.thrust || [0, 0, 0];
      acc = t.map((v) => Math.max(-1, Math.min(1, v)) * s.p.rcsAccel);
    }
    s.fuelUsedRcs += (Math.abs(acc[0]) + Math.abs(acc[1]) + Math.abs(acc[2])) * dt;   // delta-v spent (m/s)
    cwStep(rel, acc, dt, s.n);
    const rg = range(rel);
    // contact when the docking axis (y) reaches the port
    if (rel.y > -s.p.dockRange) {
      const closing = rel.vy;
      const lateral = Math.hypot(rel.x, rel.z);
      s.current.dockSpeed = closing; s.current.lateral = lateral;
      if (closing > s.p.crashSpeed) { s.mode = 'failed'; s.failReason = `Tanker ${s.current.index} struck the depot at ${closing.toFixed(2)} m/s`; return s; }
      if (closing <= s.p.dockMaxSpeed && lateral <= s.p.dockMaxLateral) {
        s.mode = 'transfer'; s.message = `Tanker ${s.current.index} soft capture, settling ullage`;
        rel.vx = rel.vy = rel.vz = 0;
      } else {
        // bounce back off the ring: missed capture, retry
        rel.y = -s.p.dockRange - 0.5; rel.vy = -Math.abs(closing) * 0.3;
        s.message = lateral > s.p.dockMaxLateral ? 'Missed capture: misaligned' : 'Missed capture: too fast';
      }
    } else if (rg > 3 * s.p.startRange) {
      s.mode = 'failed'; s.failReason = `Tanker ${s.current.index} drifted out of range`;
    } else s.message = `Tanker ${s.current.index}: range ${rg.toFixed(1)} m`;
    return s;
  }
  if (s.mode === 'transfer') {
    const cap = s.p.shipCapacityKg;
    const want = Math.min(s.p.tankerDeliveryKg - s.current.delivered, cap - s.shipProp);
    const dm = Math.min(want, s.p.transferRateKgS * dt);
    s.current.delivered += dm; s.shipProp += dm;
    s.message = `Transferring: ${(s.current.delivered / 1e3).toFixed(1)} t`;
    if (want - dm <= 1e-6) {
      s.tankers.push(s.current);
      s.current = null; s.rel = null;
      s.mode = 'waiting';
      s.nextTankerDay = s.day + s.p.cadenceDays;
      s.message = `Tanker ${s.tankers.length} undocked`;
      if (s.shipProp >= cap - 1) s.message = 'Depot full';
    }
  }
  return s;
}

export function refillResult(s) {
  return {
    success: s.mode === 'done',
    shipPropKg: s.shipProp, tankers: s.tankers.length, days: s.day,
    boiloffKg: s.lostBoiloff,
    manualDockings: s.tankers.filter((t) => !t.auto).length,
    meanDockSpeed: s.tankers.length ? s.tankers.reduce((a, t) => a + (t.dockSpeed ?? 0), 0) / s.tankers.length : 0,
    failReason: s.failReason,
  };
}
