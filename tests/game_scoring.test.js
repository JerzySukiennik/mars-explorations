import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/game/scoring.js';

const inRange = (r) => r.score >= 0 && r.score <= 1000 && typeof r.grade === 'string';

test('failures score zero in every phase', () => {
  for (const [k, f] of Object.entries(S.SCORERS)) {
    if (k === 'surface') continue;
    const r = f({ success: false });
    assert.equal(r.score, 0, k);
  }
  assert.equal(S.scoreSurface({ built: [] }).score, 0);
});

test('launch: more propellant in orbit and a caught booster score higher', () => {
  const base = { success: true, periKm: 150, apoKm: 160, shipPropKg: 20e3, maxQkPa: 30, boosterOutcome: 'LOST' };
  const a = S.scoreLaunch(base), b = S.scoreLaunch({ ...base, shipPropKg: 60e3, boosterOutcome: 'CAUGHT' });
  assert.ok(inRange(a) && inRange(b));
  assert.ok(b.score > a.score);
  assert.ok(S.scoreLaunch({ ...base, maxQkPa: 48 }).score < a.score, 'max-Q overshoot penalised');
});

test('landing: touchdown speed dominates (Mars hoverslam)', () => {
  const td = (vy, extra = {}) => S.scoreLanding({ success: true, touchdown: { vy, vx: 0.2, tilt: 0.5, dist: 5, prop: 10e3, ...extra } });
  assert.ok(td(1).score > td(3).score);
  assert.ok(td(3).score > td(5.5).score);
  assert.ok(td(1).score >= 900, `soft centred landing is an A (${td(1).score})`);
  assert.ok(td(1, { dist: 600 }).score < td(1).score, 'off-pad penalised');
  assert.equal(S.touchdownRating(1.5), 'NOMINAL');
  assert.equal(S.touchdownRating(3), 'FIRM');
  assert.equal(S.touchdownRating(5), 'HARD');
  assert.equal(S.touchdownRating(9), 'IMPACT');
});

test('entry: lower g and heating score higher', () => {
  const r = (g, q, miss = 0) => S.scoreEntry({ success: true, peakG: g, peakHeatKW: q, missKm: miss }).score;
  assert.ok(r(3, 300) > r(5, 700));
  assert.ok(r(3, 300, 0) > r(3, 300, 100));
});

test('transfer: C3 above the window minimum costs points', () => {
  const base = { success: true, c3: 9, residual: 0.5, tcm: false, shipPropKg: 100e3 };
  assert.ok(S.scoreTransfer(base, 9).score > S.scoreTransfer({ ...base, c3: 20 }, 9).score);
  assert.ok(S.scoreTransfer({ ...base, residual: 30 }, 9).score < S.scoreTransfer(base, 9).score);
});

test('refill: meeting the requirement matters most', () => {
  const r = (kg) => S.scoreRefill({ success: true, shipPropKg: kg, boiloffKg: 5e3, manualDockings: 1, tankers: 3, meanDockSpeed: 0.1 }, 800e3).score;
  assert.ok(r(800e3) > r(400e3));
});

test('surface: objectives and speed', () => {
  const full = S.scoreSurface({ built: ['pad', 'habitat', 'wall', 'wheel'], sols: 3 });
  const slow = S.scoreSurface({ built: ['pad', 'habitat'], sols: 25 });
  const half = S.scoreSurface({ built: ['pad'], sols: 2 });
  assert.ok(full.score > slow.score && slow.score > half.score);
  assert.equal(S.grade(950), 'A'); assert.equal(S.grade(100), 'F');
});
