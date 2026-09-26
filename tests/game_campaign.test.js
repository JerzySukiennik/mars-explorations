import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/game/campaign.js';

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

test('new campaign: only launch available, current = launch', () => {
  const c = C.newCampaign();
  assert.equal(c.current, 'launch');
  assert.deepEqual(C.PHASES, ['launch', 'refill', 'transfer', 'entry', 'landing', 'surface']);
  for (const p of C.PHASES) assert.equal(c.phases[p].status, p === 'launch' ? 'available' : 'locked');
  assert.equal(c.complete, false);
});

test('campaign completes phases in order, carrying state forward', () => {
  let c = C.newCampaign();
  c = C.startPhase(c, 'launch');
  c = C.completePhase(c, 'launch', { score: 700, carryNext: { shipPropKg: 40e3 } }, 'campaign');
  assert.equal(c.phases.launch.status, 'complete');
  assert.equal(c.phases.refill.status, 'available');
  assert.equal(c.current, 'refill');
  assert.deepEqual(C.inputsFor(c, 'refill', 'campaign'), { shipPropKg: 40e3 });
  for (const [i, p] of C.PHASES.slice(1).entries()) c = C.completePhase(c, p, { score: 100 * (i + 1), carryNext: { k: i } }, 'campaign');
  assert.equal(c.complete, true);
  assert.equal(c.current, 'surface');
  assert.equal(c.totalScore, 700 + 100 + 200 + 300 + 400 + 500);
});

test('single-phase play records best score but does not move the campaign', () => {
  let c = C.newCampaign();
  c = C.completePhase(c, 'entry', { score: 300 }, 'single');
  c = C.completePhase(c, 'entry', { score: 200 }, 'single');
  assert.equal(c.phases.entry.best, 300, 'best score kept');
  assert.equal(c.current, 'launch');
  assert.equal(c.phases.landing.status, 'available', 'next phase opens in the menu');
  assert.deepEqual(C.inputsFor(c, 'entry', 'single'), { ...C.DEFAULT_CARRY.entry }, 'single mode uses defaults');
});

test('every phase is playable directly with defaults', () => {
  const c = C.newCampaign();
  for (const p of C.PHASES) assert.ok(C.inputsFor(c, p, 'single'), p);
  assert.ok(C.DEFAULT_CARRY.landing.altitude > 0);
});

test('failure is recorded without unlocking', () => {
  let c = C.newCampaign();
  c = C.failPhase(c, 'launch', 'RUD');
  assert.equal(c.phases.launch.last.ok, false);
  assert.equal(c.phases.refill.status, 'locked');
  assert.throws(() => C.failPhase(c, 'nope'));
});

test('persistence round-trips and survives corrupt or unavailable storage', () => {
  const st = memStore();
  let c = C.newCampaign();
  c = C.completePhase(c, 'launch', { score: 650, carryNext: { shipPropKg: 1 } });
  assert.equal(C.save(st, c), true);
  const back = C.load(st);
  assert.equal(back.current, 'refill');
  assert.equal(back.phases.launch.best, 650);
  st.setItem(C.STORAGE_KEY, '{not json');
  assert.equal(C.load(st).current, 'launch');
  st.setItem(C.STORAGE_KEY, JSON.stringify({ version: 999 }));
  assert.equal(C.load(st).current, 'launch');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(C.load(throwing).current, 'launch');
  assert.equal(C.save(throwing, c), false);
  assert.equal(C.load(null).current, 'launch');
});

test('normalize repairs bad fields', () => {
  const c = C.normalize({ version: C.VERSION, current: 'moon', phases: { launch: { status: 'weird', best: 'x', attempts: -1 } } });
  assert.equal(c.current, 'launch');
  assert.equal(c.phases.launch.status, 'available');
  assert.equal(c.phases.launch.best, null);
  assert.equal(C.reset(memStore()).current, 'launch');
});

test('progress summary', () => {
  let c = C.newCampaign();
  c = C.completePhase(c, 'launch', { score: 10 });
  const p = C.progress(c);
  assert.equal(p.done, 1); assert.equal(p.total, 6); assert.equal(p.current, 'refill');
  assert.equal(C.nextPhase('surface'), null);
});
