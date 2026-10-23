// Runs the pure helpers from index.html's <script id="core"> block under Node.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const mod = { exports: {} };
vm.runInNewContext(src, { module: mod });
const Core = mod.exports;

// Simulated chest: calm breathing around 0.5 deg pitch, deep holds at ~3 deg, small roll coupling.
function chest(v, noise = 0.02) {
  return [0.5 + v * 2.5 + (Math.random() - 0.5) * noise, -0.2 + v * 0.5 + (Math.random() - 0.5) * noise];
}
const calm = Array.from({ length: 600 }, (_, i) => chest(0.1 * Math.sin(i / 20)));
const deep = Array.from({ length: 200 }, () => chest(1));

test('tilt is zero when flat and grows with pitch', () => {
  const [p, r] = Core.tilt(0, 0, -9.81);
  assert.ok(Math.abs(p) < 1e-9 && Math.abs(r) < 1e-9);
  const [p2] = Core.tilt(0, 9.81 * Math.sin(Math.PI / 180 * 3), -9.81 * Math.cos(Math.PI / 180 * 3));
  assert.ok(Math.abs(p2 - 3) < 1e-6);
});

test('calibration maps calm breathing to ~0% and deep holds to ~100%', () => {
  const cal = Core.calibrate(calm, deep);
  assert.equal(cal.ok, true);
  assert.ok(cal.rangeDeg > 2 && cal.rangeDeg < 3);
  assert.ok(Math.abs(Core.level(chest(0, 0), cal)) < 5);
  assert.ok(Math.abs(Core.level(chest(1, 0), cal) - 100) < 5);
  assert.ok(Math.abs(Core.level(chest(0.75, 0), cal) - 75) < 5);
});

test('calibration works whichever way the phone tilts', () => {
  const flip = s => [-s[0], -s[1]];
  const cal = Core.calibrate(calm.map(flip), deep.map(flip));
  assert.equal(cal.ok, true);
  assert.ok(Math.abs(Core.level(flip(chest(1, 0)), cal) - 100) < 5);
});

test('calibration rejects a signal that barely moves', () => {
  const tiny = Array.from({ length: 200 }, () => [0.5 + 0.05, -0.2]);
  const cal = Core.calibrate(calm.map(() => [0.5, -0.2]), tiny);
  assert.equal(cal.ok, false);
  assert.equal(cal.reason, 'weak');
  assert.equal(Core.calibrate([], deep).reason, 'few-samples');
});

test('gate uses hysteresis', () => {
  assert.equal(Core.gate(false, 74, 75), false);
  assert.equal(Core.gate(false, 75, 75), true);
  assert.equal(Core.gate(true, 73, 75), true);
  assert.equal(Core.gate(true, 71.9, 75), false);
});

test('hold summary counts time above line and drops', () => {
  const s = [
    ...Array(10).fill({ dt: 0.1, level: 85, on: true }),
    ...Array(5).fill({ dt: 0.1, level: 60, on: false }),
    ...Array(5).fill({ dt: 0.1, level: 85, on: true }),
  ];
  const r = Core.summarizeHold(s);
  assert.ok(Math.abs(r.seconds - 2) < 1e-9);
  assert.ok(Math.abs(r.onPct - 75) < 1e-9);
  assert.equal(r.drops, 1);
  assert.ok(r.wobble > 0);
});

test('smoother converges toward a step', () => {
  const sm = Core.makeSmoother(0.25);
  sm.update(0, 0);
  let v;
  for (let i = 1; i <= 60; i++) v = sm.update(1, i / 60);
  assert.ok(v > 0.95);
});

// Objects made inside the vm context have other prototypes, so compare plain copies.
const plain = v => JSON.parse(JSON.stringify(v));

test('normalizePhases keeps valid phases, clamps values and falls back when empty', () => {
  assert.deepEqual(plain(Core.normalizePhases([{ holds: 2, holdSec: 15, restSec: 30 }])), [{ holds: 2, holdSec: 15, restSec: 30 }]);
  assert.deepEqual(plain(Core.normalizePhases([{ holds: 0, holdSec: 999, restSec: 'x' }])), [{ holds: 1, holdSec: 60, restSec: 40 }]);
  assert.deepEqual(plain(Core.normalizePhases(null)), [{ holds: 4, holdSec: 20, restSec: 40 }]);
  assert.equal(Core.normalizePhases(Array(10).fill({ holds: 1, holdSec: 10, restSec: 10 })).length, Core.MAX_PHASES);
});

test('buildPlan expands phases into holds in order, each with its own lengths', () => {
  const plan = Core.buildPlan([{ holds: 2, holdSec: 15, restSec: 30 }, { holds: 1, holdSec: 25, restSec: 60 }]);
  assert.deepEqual(plain(plan), [
    { phase: 1, phaseHold: 1, phaseHolds: 2, holdSec: 15, restSec: 30 },
    { phase: 1, phaseHold: 2, phaseHolds: 2, holdSec: 15, restSec: 30 },
    { phase: 2, phaseHold: 1, phaseHolds: 1, holdSec: 25, restSec: 60 },
  ]);
  // 6 s prep + (10 + 15 + 3 + 30) × 2 + (10 + 25 + 3), no rest after the last hold.
  assert.equal(Core.planSeconds(plan), 6 + 58 * 2 + 38);
  assert.equal(Core.describePhases([{ holds: 2, holdSec: 15 }, { holds: 1, holdSec: 25 }]), '2 × 15 s, 1 × 25 s');
});
