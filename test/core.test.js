// Runs the pure helpers from js/core.js under Node.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
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

test('demo calibration maps the simulated chest to ~0% calm and ~100% at a deep breath', () => {
  const cal = Core.demoCalibration();
  assert.equal(cal.ok, true);
  assert.ok(Math.abs(Core.level(Core.demoTilt(0), cal)) < 5);
  assert.ok(Math.abs(Core.level(Core.demoTilt(1), cal) - 100) < 5);
});

// A phone lying still: 60 readings a second with a little noise around gravity.
const stillPhone = (n = 90, hz = 60) => Array.from({ length: n }, (_, i) => [0.01 * Math.sin(i), 0.02 * Math.cos(i), -9.81, i / hz]);
const ids = f => plain(Core.assessCapabilities(f).map(i => i.id));
const levels = f => Object.fromEntries(Core.assessCapabilities(f).map(i => [i.id, i.level]));
const healthy = { secure: true, motionApi: true, motionPermission: 'granted', motion: Core.assessMotion(stillPhone()), audio: true, audioRunning: true, heard: true, ringerMatters: false, voiceOn: true, speech: true, voices: 20, wakeLock: 'ok', storage: true };

test('assessMotion measures rate and gravity from a working sensor', () => {
  const m = Core.assessMotion(stillPhone());
  assert.equal(m.usable, true);
  assert.equal(m.hz, 60);
  assert.ok(Math.abs(m.gravity - 9.81) < 0.01);
  assert.equal(m.stuck, false);
});

test('assessMotion treats too few readings as unusable and spots a stuck sensor', () => {
  assert.equal(Core.assessMotion([]).usable, false);
  assert.equal(Core.assessMotion(stillPhone(2)).usable, false);
  const frozen = Array.from({ length: 20 }, (_, i) => [0, 0, -9.81, i / 60]);
  assert.equal(Core.assessMotion(frozen).stuck, true);
});

test('a healthy phone has no issues', () => {
  assert.deepEqual(ids(healthy), []);
});

test('nothing is reported before it has been checked', () => {
  assert.deepEqual(ids({}), []);
  assert.deepEqual(ids({ secure: true, motionApi: true, audio: true, speech: true, voiceOn: true, storage: true }), []);
});

test('motion problems block a real session', () => {
  for (const [fact, id] of [
    [{ secure: false }, 'https'],
    [{ motionApi: false }, 'motion-api'],
    [{ motionPermission: 'denied', motion: undefined }, 'motion-denied'],
    [{ motionPermission: 'error', motion: undefined }, 'motion-error'],
    [{ motion: Core.assessMotion([]) }, 'motion-none'],
  ]) {
    assert.equal(levels({ ...healthy, ...fact })[id], 'block', id);
  }
});

test('the first motion problem is the only one reported', () => {
  assert.deepEqual(ids({ ...healthy, secure: false, motionApi: false, motion: Core.assessMotion([]) }), ['https']);
});

test('poor sensor quality warns but does not block', () => {
  const slow = Core.assessMotion(stillPhone(20, 5));
  assert.equal(levels({ ...healthy, motion: slow })['motion-slow'], 'warn');
  const frozen = Core.assessMotion(Array.from({ length: 20 }, (_, i) => [0, 0, -9.81, i / 60]));
  assert.equal(levels({ ...healthy, motion: frozen })['motion-stuck'], 'warn');
  const shaken = Core.assessMotion(stillPhone().map(r => [r[0], r[1], -20, r[3]]));
  assert.equal(levels({ ...healthy, motion: shaken })['motion-gravity'], 'warn');
});

test('sound, screen and storage problems warn', () => {
  for (const [fact, id, row] of [
    [{ audio: false }, 'audio', 'sound'],
    [{ audioRunning: false }, 'audio-stopped', 'sound'],
    [{ heard: false }, 'unheard', 'sound'],
    [{ heard: undefined, ringerMatters: true }, 'ringer', 'sound'],
    [{ speech: false }, 'speech', 'sound'],
    [{ heard: undefined, voices: 0 }, 'voices', 'sound'],
    [{ wakeLock: 'unsupported' }, 'wake-lock', 'wake'],
    [{ wakeLock: 'denied' }, 'wake-lock', 'wake'],
    [{ storage: false }, 'storage', 'storage'],
  ]) {
    const [issue] = Core.assessCapabilities({ ...healthy, ...fact });
    assert.equal(issue.id, id);
    assert.equal(issue.level, 'warn', id);
    assert.equal(issue.row, row, id);
  }
});

test('hearing the coach settles the silent mode and missing voice warnings', () => {
  assert.deepEqual(ids({ ...healthy, heard: true, ringerMatters: true, voices: 0 }), []);
  assert.deepEqual(ids({ ...healthy, heard: false, ringerMatters: true }), ['unheard']);
});

test('missing speech does not warn when spoken cues are turned off', () => {
  assert.deepEqual(ids({ ...healthy, voiceOn: false, speech: false }), []);
  assert.deepEqual(ids({ ...healthy, voiceOn: false, voices: 0 }), []);
});

const rowStatus = f => Object.fromEntries(Core.capabilityRows(f).map(r => [r.id, r.status]));

test('capability rows start pending and all pass on a healthy phone', () => {
  assert.ok(Object.values(rowStatus({})).every(v => v === 'pending'));
  assert.ok(Object.values(rowStatus(healthy)).every(v => v === 'pass'));
});

test('capability rows show the worst problem on the right row', () => {
  const r = rowStatus({ ...healthy, secure: false, wakeLock: 'denied' });
  assert.equal(r.secure, 'block');
  assert.equal(r.wake, 'warn');
  assert.equal(r.sound, 'pass');
  const motion = Core.capabilityRows({ ...healthy, motion: Core.assessMotion([]) }).find(x => x.id === 'motion');
  assert.equal(motion.status, 'block');
  assert.equal(motion.issues[0].id, 'motion-none');
});

test('the sound row passes only after the person says they heard it', () => {
  assert.equal(rowStatus({ ...healthy, heard: undefined }).sound, 'pending');
  assert.equal(rowStatus({ ...healthy, heard: false }).sound, 'warn');
  assert.equal(rowStatus(healthy).sound, 'pass');
  assert.deepEqual(plain(Core.capabilityRows(healthy).map(r => r.id)), ['secure', 'motion', 'sound', 'wake', 'storage']);
});

test('capability rows report the sensor rate', () => {
  assert.equal(Core.capabilityRows(healthy).find(x => x.id === 'motion').note, '60 readings/s');
});

test('turning spoken cues off removes speech problems from the sound row', () => {
  const sound = Core.capabilityRows({ ...healthy, voiceOn: false, speech: false }).find(x => x.id === 'sound');
  assert.equal(sound.status, 'pass');
  assert.deepEqual(plain(sound.issues), []);
});
