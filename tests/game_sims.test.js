// Gameplay sims: each phase must be winnable with its autopilot and must fail
// for the right physical reasons. Physics modules are loaded defensively (they
// are owned by other builders and may change); the sims have fallbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Asc from '../src/game/sims/ascent.js';
import * as Ref from '../src/game/sims/refill.js';
import * as Cr from '../src/game/sims/cruise.js';
import * as En from '../src/game/sims/entry.js';
import * as Ld from '../src/game/sims/landing.js';
import * as Sf from '../src/game/sims/surface.js';

const opt = async (p) => { try { return await import(p); } catch { return null; } };
const V = await opt('../src/physics/vehicle.js');
const A = await opt('../src/physics/mars_atmosphere.js');
const B = await opt('../src/physics/mars_body.js');
const T = await opt('../src/physics/transfer.js');
const RV = await opt('../src/physics/rover.js');
const PR = await opt('../src/physics/printer.js');

function flyAscent(opts) {
  const s = Asc.createAscent({ V, ...opts });
  Asc.stepAscent(s, 0, { start: true });
  for (let i = 0; i < 12000 && s.phase !== 'failed' && s.phase !== 'orbit'; i++) Asc.stepAscent(s, 0.1, { autoStage: true });
  return s;
}

test('ascent: auto-staged flight reaches orbit with propellant left', () => {
  const s = flyAscent();
  const r = Asc.ascentResult(s);
  assert.equal(r.success, true, r.failReason);
  assert.ok(r.periKm > 120 && r.periKm < 250, `perigee ${r.periKm}`);
  assert.ok(r.shipPropKg > 10e3, `prop ${r.shipPropKg}`);
  const meco = s.events.find((e) => e.name === 'MECO');
  assert.ok(meco.t > 110 && meco.t < 190, `MECO at T+${meco.t}`);
  assert.ok(r.maxQkPa > 15 && r.maxQkPa < 40, `max-Q ${r.maxQkPa}`);
});

test('ascent: works on the built-in vehicle fallback too', () => {
  const s = Asc.createAscent({ V: null });
  assert.equal(s.veh.source, 'fallback');
  Asc.stepAscent(s, 0, { start: true });
  for (let i = 0; i < 12000 && s.phase !== 'failed' && s.phase !== 'orbit'; i++) Asc.stepAscent(s, 0.1, { autoStage: true });
  assert.equal(s.phase, 'orbit', s.failReason);
});

test('ascent: never staging exhausts the booster and loses it', () => {
  const s = Asc.createAscent({ V });
  Asc.stepAscent(s, 0, { start: true });
  for (let i = 0; i < 3000 && s.phase === 'booster' || s.phase === 'countdown'; i++) Asc.stepAscent(s, 0.1, { autoStage: false });
  assert.ok(s.staged);
  assert.ok(s.booster.prop <= 1, 'no boostback propellant left');
});

test('refill: CW relative motion holds a V-bar station', () => {
  const n = Ref.meanMotion(200);
  const st = { x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0 };
  Ref.cwStep(st, [0, 0, 0], 600, n);
  assert.ok(Math.abs(st.y + 100) < 1e-6 && Math.abs(st.x) < 1e-6);
  const r = { x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };   // radial offset drifts along-track
  Ref.cwStep(r, [0, 0, 0], 600, n);
  assert.ok(Math.abs(r.y) > 1);
});

test('refill: autopilot docks tankers, transfer fills, boil-off drains', () => {
  const s = Ref.createRefill({ shipPropKg: 50e3 });
  for (let i = 0; i < 400000 && s.tankers.length < 2 && s.mode !== 'failed'; i++) Ref.stepRefill(s, 0.5, { auto: true, skip: true });
  assert.equal(s.tankers.length, 2, s.failReason);
  for (const t of s.tankers) assert.ok(t.dockSpeed <= s.p.dockMaxSpeed);
  const before = s.shipProp;
  Ref.stepRefill(s, 86400, {});
  assert.ok(s.shipProp < before && s.lostBoiloff > 0);
  Ref.stepRefill(s, 1, { finish: true });
  assert.equal(Ref.refillResult(s).success, true);
});

test('refill: ramming the port fails the tanker', () => {
  const s = Ref.createRefill({ shipPropKg: 50e3 });
  Ref.stepRefill(s, 0.1, { skip: true });
  Ref.stepRefill(s, 0.1, {});
  s.rel.y = -10; s.rel.vy = 2;
  for (let i = 0; i < 200 && s.mode === 'approach'; i++) Ref.stepRefill(s, 0.1, {});
  assert.equal(s.mode, 'failed');
});

test('transfer: porkchop finds a 2026 minimum near C3 9 km2/s2 and TMI ~3.6 km/s', { skip: !T && 'transfer.js absent' }, () => {
  const pc = Cr.buildPorkchop(T, { year: 2026, dDep: 6, dTof: 16 });
  assert.ok(pc.best.c3 > 7 && pc.best.c3 < 12, `C3 ${pc.best.c3}`);
  assert.ok(pc.best.tmiDv > 3400 && pc.best.tmiDv < 3900, `dv ${pc.best.tmiDv}`);
});

test('transfer: burn delivers the requested delta-v and cruise arrives', () => {
  const s = Cr.createCruise({ V, shipPropKg: 1200e3 });
  Cr.stepCruise(s, 0, { ignite: true });
  for (let i = 0; i < 20000 && s.mode === 'burn'; i++) Cr.stepCruise(s, 0.05, {});
  assert.equal(s.mode, 'coast');
  assert.ok(Math.abs(s.residual) < 5, `residual ${s.residual}`);
  while (s.mode === 'coast') Cr.stepCruise(s, 86400 * 5, {});
  assert.equal(Cr.cruiseResult(s).success, true);
  assert.ok(Cr.cruiseResult(s).shipPropKg > Cr.LANDING_RESERVE_KG, 'landing reserve kept');
});

test('entry: corridor too steep fails on loads, too shallow skips out, nominal survives', () => {
  const base = { A, B, entrySpeed: 5600 };
  const steep = En.simulateEntry({ ...base, gammaDeg: -16 }, 60);
  assert.equal(steep.mode, 'failed'); assert.match(steep.failReason, /steep/);
  const shallow = En.simulateEntry({ ...base, gammaDeg: -8 }, 60);
  assert.equal(shallow.mode, 'failed'); assert.match(shallow.failReason, /shallow/);
  const nom = En.simulateEntry({ ...base, gammaDeg: -11.5 }, 60);
  assert.equal(nom.mode, 'handoff', nom.failReason);
  assert.ok(nom.peakG < En.LIMITS.gFail && nom.peakQ < En.LIMITS.heatFail);
});

test('entry: Sutton-Graves heating scales with v^3 and sqrt(rho)', () => {
  const q1 = En.suttonGraves(1e-4, 5000, 4), q2 = En.suttonGraves(4e-4, 10000, 4);
  assert.ok(Math.abs(q2 / q1 - 16) < 1e-9);
});

test('landing: Mars gravity is ~3.71 m/s^2', () => {
  const g = Ld.marsGravity(B);
  assert.ok(g > 3.69 && g < 3.74, `g = ${g}`);
});

test('landing: autopilot sets Starship down softly from the entry handover', () => {
  const s = Ld.createLanding({ A, B, V, altitude: 8000, vx: 880, vy: -205 });
  for (let i = 0; i < 20000 && s.mode !== 'landed' && s.mode !== 'crashed'; i++) Ld.stepLanding(s, 0.05, Ld.landingAutopilot(s));
  assert.equal(s.mode, 'landed', s.failReason);
  assert.ok(s.touchdown.vy < 4 && s.touchdown.dist < 50, JSON.stringify(s.touchdown));
});

test('landing: no burn means an impact', () => {
  const s = Ld.createLanding({ A, B, V, altitude: 3000, vx: 50, vy: -150, padX: 0 });
  for (let i = 0; i < 20000 && s.mode === 'fall'; i++) Ld.stepLanding(s, 0.05, {});
  assert.equal(s.mode, 'crashed');
});

test('surface: rover speed limited to 4.2 cm/s and slips on slopes', () => {
  const flat = Sf.createSurface({ RV, heightAt: () => 0 });
  Sf.stepSurface(flat, 10, { drive: 1 });
  assert.ok(flat.rover.speed > 0.035 && flat.rover.speed <= 0.042, `speed ${flat.rover.speed}`);
  const hill = Sf.createSurface({ RV, heightAt: (x, z) => -Math.tan(15 * Math.PI / 180) * z, heading: 0 });  // uphill toward -z (north)
  Sf.stepSurface(hill, 10, { drive: 1 });
  assert.ok(hill.rover.slopeDeg > 14, `slope ${hill.rover.slopeDeg}`);
  assert.ok(hill.rover.slip > 0.3 && hill.rover.speed < flat.rover.speed * 0.8);
});

test('surface: driving drains the battery, the charger refills it', () => {
  const s = Sf.createSurface({ RV, heightAt: () => 0 });
  const soc0 = s.rover.battery.soc;
  Sf.stepSurface(s, 3600, { drive: 1 });
  assert.ok(s.rover.battery.soc < soc0, 'drive load exceeds MMRTG output');
  s.rover.x = s.sites.charger.x; s.rover.z = s.sites.charger.z;
  const soc1 = s.rover.battery.soc;
  Sf.stepSurface(s, 3600, {});
  assert.ok(s.rover.battery.soc > soc1 && s.rover.charging > 0);
});

test('surface: regolith delivered to the printer becomes a printed structure', () => {
  const s = Sf.createSurface({ RV, PR, heightAt: () => 0, stockpile: 0 });
  s.rover.x = s.sites.dig.x; s.rover.z = s.sites.dig.z;
  Sf.stepSurface(s, 1, { action: true });
  assert.ok(s.digging);
  Sf.stepSurface(s, 3600, {});
  assert.equal(s.cart, Sf.CART_KG);
  s.rover.x = s.sites.printer.x; s.rover.z = s.sites.printer.z;
  Sf.stepSurface(s, 1, { action: true });
  Sf.stepSurface(s, 3600, {});
  assert.equal(s.cart, 0); assert.ok(s.stockpile > Sf.CART_KG - 1);
  const plan = Sf.planRecipe('wall', PR);
  assert.ok(plan.regolithMass < s.stockpile, 'one cart covers a wall segment');
  Sf.queueJob(s, 'wall');
  for (let i = 0; i < 400 && !s.built.length; i++) Sf.stepSurface(s, 600, {});
  assert.deepEqual(s.built.map((b) => b.key), ['wall']);
  assert.ok(s.stockpile < Sf.CART_KG - plan.regolithMass * 0.99 + 1);
});

test('surface: printing stalls without regolith', () => {
  const s = Sf.createSurface({ RV, PR, heightAt: () => 0, stockpile: 0 });
  Sf.queueJob(s, 'pad');
  Sf.stepSurface(s, 3600 * 5, {});
  assert.equal(s.jobs[0].status, 'no regolith');
  assert.equal(s.built.length, 0);
});

test('surface: recipes come from the printer model', () => {
  for (const k of Object.keys(Sf.RECIPES)) {
    const p = Sf.planRecipe(k, PR);
    assert.ok(p.mass > 0 && p.regolithMass > 0 && p.printTime > 0 && p.power > 0, k);
  }
  assert.equal(Sf.lmst(Sf.SOL_H / 2), '12:00');
});
