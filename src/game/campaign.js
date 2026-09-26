// Campaign state machine: the six mission phases in order, per-phase status and
// best score, and the state carried from one phase into the next.
//
// Pure ES module. Persistence goes through an injectable storage object with
// getItem/setItem (localStorage in the browser); every access is wrapped in
// try/catch so private windows, blocked storage or corrupt JSON never break the
// game.

export const PHASES = Object.freeze(['launch', 'refill', 'transfer', 'entry', 'landing', 'surface']);

export const PHASE_INFO = Object.freeze({
  launch: { title: 'Launch', scene: 'launch', blurb: 'Command Super Heavy and Starship from Starbase to low Earth orbit.' },
  refill: { title: 'Orbital refilling', scene: 'refill', blurb: 'Rendezvous and dock with tankers; beat boil-off to fill the depot.' },
  transfer: { title: 'Trans-Mars injection', scene: 'transfer', blurb: 'Pick a departure on the porkchop plot, fly the TMI burn, cruise.' },
  entry: { title: 'Mars entry', scene: 'entry', blurb: 'Choose the entry corridor and fly bank angle through peak heating.' },
  landing: { title: 'Propulsive landing', scene: 'landing', blurb: 'Flip, light the Raptors and set Starship down on the pad.' },
  surface: { title: 'Surface base', scene: 'surface', blurb: 'Drive the rover, haul regolith, keep charged and print the base.' },
});

export const STORAGE_KEY = 'mars-explorations.campaign.v1';
export const VERSION = 1;

/** Default carried state when a phase is played directly from the menu. */
export const DEFAULT_CARRY = Object.freeze({
  launch: {},
  refill: { shipPropKg: 50e3 },
  transfer: { shipPropKg: 1200e3 },
  entry: { entrySpeed: 5600, corridorErrDeg: 0, shipPropKg: 100e3 },
  landing: { altitude: 8000, vx: 880, vy: -205, missKm: 0, propKg: 100e3 },
  surface: {},
});

export function newCampaign() {
  const phases = {};
  for (const p of PHASES) phases[p] = { status: p === 'launch' ? 'available' : 'locked', best: null, attempts: 0, last: null };
  return { version: VERSION, current: 'launch', phases, carry: {}, complete: false, totalScore: 0, started: null };
}

export function isPhase(id) { return PHASES.includes(id); }
export function nextPhase(id) { const i = PHASES.indexOf(id); return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1] : null; }

/** Sanity-check a loaded object; returns a valid campaign (fresh if unusable). */
export function normalize(c) {
  if (!c || typeof c !== 'object' || c.version !== VERSION || !c.phases) return newCampaign();
  const out = newCampaign();
  for (const p of PHASES) {
    const s = c.phases[p];
    if (s && typeof s === 'object') {
      out.phases[p] = {
        status: ['locked', 'available', 'complete'].includes(s.status) ? s.status : out.phases[p].status,
        best: Number.isFinite(s.best) ? s.best : null,
        attempts: Number.isFinite(s.attempts) ? s.attempts : 0,
        last: s.last ?? null,
      };
    }
  }
  out.current = isPhase(c.current) ? c.current : 'launch';
  out.carry = c.carry && typeof c.carry === 'object' ? c.carry : {};
  out.complete = !!c.complete;
  out.started = c.started ?? null;
  out.totalScore = PHASES.reduce((a, p) => a + (out.phases[p].best ?? 0), 0);
  return out;
}

export function load(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch { return newCampaign(); }
}

export function save(storage, c) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(c)); return true; } catch { return false; }
}

export function reset(storage) {
  const c = newCampaign();
  save(storage, c);
  return c;
}

/** Initial conditions for a phase: carried state in campaign mode, defaults otherwise. */
export function inputsFor(c, phase, mode = 'campaign') {
  const d = DEFAULT_CARRY[phase] || {};
  if (mode !== 'campaign' || !c) return { ...d };
  return { ...d, ...(c.carry?.[phase] || {}) };
}

/** Record an attempt start. */
export function startPhase(c, phase) {
  if (!isPhase(phase)) throw new Error(`unknown phase ${phase}`);
  const s = c.phases[phase];
  s.attempts += 1;
  if (!c.started) c.started = new Date().toISOString();
  return c;
}

/**
 * Complete a phase with a score and the outputs for the next one. In campaign
 * mode this unlocks the next phase and moves `current` forward; playing a
 * phase directly (mode 'single') only records the best score.
 */
export function completePhase(c, phase, { score = 0, carryNext = null, summary = null } = {}, mode = 'campaign') {
  if (!isPhase(phase)) throw new Error(`unknown phase ${phase}`);
  const s = c.phases[phase];
  s.best = s.best == null ? score : Math.max(s.best, score);
  s.last = { ok: true, score, summary, at: Date.now() };
  if (mode === 'campaign' || s.status !== 'complete') s.status = 'complete';
  const nxt = nextPhase(phase);
  if (mode === 'campaign') {
    if (nxt) {
      if (carryNext) c.carry[nxt] = carryNext;
      if (c.phases[nxt].status === 'locked') c.phases[nxt].status = 'available';
      c.current = nxt;
    } else {
      c.complete = true;
    }
  } else if (nxt && c.phases[nxt].status === 'locked') {
    // Playing a phase on its own still opens the next one in the menu.
    c.phases[nxt].status = 'available';
  }
  c.totalScore = PHASES.reduce((a, p) => a + (c.phases[p].best ?? 0), 0);
  return c;
}

export function failPhase(c, phase, reason = '') {
  if (!isPhase(phase)) throw new Error(`unknown phase ${phase}`);
  c.phases[phase].last = { ok: false, reason, at: Date.now() };
  return c;
}

/** Progress summary for the menu. */
export function progress(c) {
  const done = PHASES.filter((p) => c.phases[p].status === 'complete').length;
  return { done, total: PHASES.length, current: c.current, complete: c.complete, totalScore: c.totalScore };
}
