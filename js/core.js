// Pure signal-processing helpers. No DOM access, so they can be tested with Node.
const Core = (() => {
  const DEG = 180 / Math.PI;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const sd = a => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
  };
  const quantile = (a, q) => {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };

  // Phone tilt from the gravity vector, in degrees: [pitch (top edge up/down), roll (side to side)].
  function tilt(ax, ay, az) {
    const g = Math.hypot(ax, ay, az) || 1;
    return [Math.asin(clamp(ay / g, -1, 1)) * DEG, Math.asin(clamp(ax / g, -1, 1)) * DEG];
  }

  // Time-based exponential smoother; tau in seconds.
  function makeSmoother(tau) {
    let v = null, last = 0;
    return {
      update(x, t) {
        if (v === null) { v = x; last = t; return v; }
        const dt = Math.max(0, t - last);
        last = t;
        v += (1 - Math.exp(-dt / tau)) * (x - v);
        return v;
      },
      reset() { v = null; },
    };
  }

  // Learn the breathing axis and range from calm breathing and deep-hold tilt samples ([pitch, roll] pairs).
  // 0 % = median calm breathing, 100 % = median deep hold.
  function calibrate(baseline, holds, minRangeDeg = 0.4) {
    if (baseline.length < 20 || holds.length < 20) return { ok: false, reason: 'few-samples' };
    const origin = [mean(baseline.map(s => s[0])), mean(baseline.map(s => s[1]))];
    const dx = mean(holds.map(s => s[0])) - origin[0];
    const dy = mean(holds.map(s => s[1])) - origin[1];
    const n = Math.hypot(dx, dy);
    if (n < 1e-6) return { ok: false, reason: 'weak', rangeDeg: 0 };
    const axis = [dx / n, dy / n];
    const proj = s => (s[0] - origin[0]) * axis[0] + (s[1] - origin[1]) * axis[1];
    const zero = quantile(baseline.map(proj), 0.5);
    const full = quantile(holds.map(proj), 0.5);
    const cal = { origin, axis, zero, full, rangeDeg: full - zero, calmSdDeg: sd(baseline.map(proj)), holdSdDeg: sd(holds.map(proj)) };
    if (cal.rangeDeg < minRangeDeg) return { ...cal, ok: false, reason: 'weak' };
    return { ...cal, ok: true };
  }

  function level(s, cal) {
    const p = (s[0] - cal.origin[0]) * cal.axis[0] + (s[1] - cal.origin[1]) * cal.axis[1];
    return (100 * (p - cal.zero)) / (cal.full - cal.zero);
  }

  // Gate with hysteresis so noise at the line does not flicker on and off.
  function gate(wasOn, lvl, target, hysteresis = 3) {
    return wasOn ? lvl >= target - hysteresis : lvl >= target;
  }

  // samples: [{dt, level, on}] recorded during one hold.
  function summarizeHold(samples) {
    let total = 0, on = 0, drops = 0, prev = null;
    const lv = [];
    for (const s of samples) {
      total += s.dt;
      if (s.on) on += s.dt;
      if (prev === true && !s.on) drops++;
      prev = s.on;
      lv.push(s.level);
    }
    return {
      seconds: total,
      onPct: total ? (100 * on) / total : 0,
      meanLevel: lv.length ? mean(lv) : 0,
      wobble: sd(lv),
      drops,
    };
  }

  // Session plan. A session is a list of phases; each phase repeats its own hold and rest length.
  // Rest follows every hold except the last one of the session.
  const PHASE_LIMITS = { holds: [1, 10], holdSec: [5, 60], restSec: [5, 180] };
  const MAX_PHASES = 6;

  function normalizePhases(phases, fallback = { holds: 4, holdSec: 20, restSec: 40 }) {
    const fix = (v, k) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? clamp(n, ...PHASE_LIMITS[k]) : fallback[k];
    };
    const list = Array.isArray(phases) ? phases.filter(p => p && typeof p === 'object') : [];
    const out = list.slice(0, MAX_PHASES).map(p => ({ holds: fix(p.holds, 'holds'), holdSec: fix(p.holdSec, 'holdSec'), restSec: fix(p.restSec, 'restSec') }));
    return out.length ? out : [{ ...fallback }];
  }

  // One entry per hold, in order.
  function buildPlan(phases) {
    const plan = [];
    phases.forEach((p, pi) => {
      for (let i = 0; i < p.holds; i++) {
        plan.push({ phase: pi + 1, phaseHold: i + 1, phaseHolds: p.holds, holdSec: p.holdSec, restSec: p.restSec });
      }
    });
    return plan;
  }

  // Practice time after calibration: 6 s prep, then per hold up to 10 s breathing in, the hold, 3 s breathing out, rest.
  function planSeconds(plan) {
    return plan.reduce((s, h, i) => s + 10 + h.holdSec + 3 + (i < plan.length - 1 ? h.restSec : 0), 6);
  }

  function describePhases(phases) {
    return phases.map(p => `${p.holds} × ${p.holdSec} s`).join(', ');
  }

  // Demo mode's simulated chest: c = 0 is calm, 1 is a full deep breath. Returns [pitch, roll] in degrees.
  function demoTilt(c) {
    return [0.4 + c * 2.4, -0.3 + c * 0.6];
  }

  // The calibration demo mode would learn, so demo sessions can skip straight to practice.
  function demoCalibration() {
    const calm = Array.from({ length: 200 }, (_, i) => demoTilt(0.12 * Math.sin(i / 10)));
    const deep = Array.from({ length: 50 }, () => demoTilt(1));
    return calibrate(calm, deep, 0.1);
  }

  // Phone check: judges a short burst of motion readings, each [x, y, z, seconds].
  const MOTION_MIN_READINGS = 3, MOTION_MIN_HZ = 10, GRAVITY_RANGE = [7, 13];

  function assessMotion(readings) {
    const count = readings.length;
    if (count < MOTION_MIN_READINGS) return { usable: false, count, hz: 0 };
    const secs = readings[count - 1][3] - readings[0][3];
    return {
      usable: true,
      count,
      hz: secs > 0 ? Math.round((count - 1) / secs) : 0,
      gravity: Math.round(quantile(readings.map(r => Math.hypot(r[0], r[1], r[2])), 0.5) * 100) / 100,
      stuck: count >= 10 && [0, 1, 2].every(i => readings.every(r => r[i] === readings[0][i])),
    };
  }

  // Phone check: turns gathered facts into problems to show. A fact left undefined has not been checked yet.
  // Motion problems block a real session; everything else warns.
  function assessCapabilities(f) {
    const out = [];
    const add = (id, level, row, title, detail) => out.push({ id, level, row, title, detail });
    const mainBrowser = 'Open the link in your phone’s main browser (Safari on iPhone, Chrome on Android), not inside another app such as WhatsApp.';

    if (f.secure === false) {
      add('https', 'block', 'secure', 'This page must be opened over https://', 'Phones only give motion data to secure pages. Use the https:// link.');
    } else if (f.motionApi === false) {
      add('motion-api', 'block', 'motion', 'This browser has no motion sensor access', mainBrowser);
    } else if (f.motionPermission === 'denied') {
      add('motion-denied', 'block', 'motion', 'Motion access was not allowed', 'Close this tab, open the link again, tap Check my phone and choose Allow.');
    } else if (f.motionPermission === 'error') {
      add('motion-error', 'block', 'motion', 'Could not turn on the motion sensor', mainBrowser);
    } else if (f.motion && !f.motion.usable) {
      add('motion-none', 'block', 'motion', 'No motion readings arrived', `This device may have no motion sensor, or the browser is blocking it. ${mainBrowser}`);
    } else if (f.motion) {
      if (f.motion.hz < MOTION_MIN_HZ) add('motion-slow', 'warn', 'motion', 'The motion sensor is slow', `It sends about ${f.motion.hz} readings a second, so the breath level may lag.`);
      if (f.motion.stuck) add('motion-stuck', 'warn', 'motion', 'The motion sensor looks stuck', 'Its readings never changed during the check, so calibration may fail. Restart the browser and try again.');
      if (f.motion.gravity < GRAVITY_RANGE[0] || f.motion.gravity > GRAVITY_RANGE[1]) add('motion-gravity', 'warn', 'motion', 'The motion readings look wrong', 'Keep the phone still during the check, then try again. Results may be unreliable if this keeps happening.');
    }

    if (f.audio === false) {
      add('audio', 'warn', 'audio', 'The tone and beeps cannot play', 'This browser has no Web Audio, so you will not hear when you are above or below the line. Update your phone or use its main browser.');
    } else if (f.audioRunning === false) {
      add('audio-stopped', 'warn', 'audio', 'The tone and beeps may not play', 'The browser did not start audio. Close other apps that are playing sound and check again.');
    }
    // Hearing the sound settles what the page cannot measure itself.
    if (f.heard === false) {
      add('unheard', 'warn', 'hearing', 'You did not hear the coach', 'Turn the ringer on and the volume up, then tap Play again. The coach gives its feedback by sound.');
    } else if (f.ringerMatters && f.heard !== true) {
      add('ringer', 'warn', 'hearing', 'Silent mode can mute the coach', 'On this iOS version web pages cannot play through silent mode. Turn the ringer on and the volume up.');
    }
    if (f.voiceOn) {
      if (f.speech === false) add('speech', 'warn', 'speech', 'Spoken cues are not available', 'You will hear tones but no voice prompts or countdown.');
      else if (f.voices === 0 && f.heard !== true) add('voices', 'warn', 'speech', 'Spoken cues may not play', 'No voices are installed for this browser, so you may hear tones but no voice prompts or countdown.');
    }

    if (f.wakeLock === 'unsupported' || f.wakeLock === 'denied') {
      add('wake-lock', 'warn', 'wake', 'The screen may turn off', 'Set the screen timeout (Auto-Lock on iPhone) to Never or its longest setting. If the screen turns off, the current hold restarts.');
    }
    if (f.storage === false) add('storage', 'warn', 'storage', 'Results will not be saved', 'This browser is blocking storage, so settings, history and logs will be lost. Private browsing can cause this.');
    return out;
  }

  // One row per check for the phone check screen. status: pending, pass, warn or block.
  // A row passes only once something was tested; sound counts only when the person says they heard it.
  function capabilityRows(f) {
    const issues = assessCapabilities(f);
    const row = (id, label, checked, note) => {
      const mine = issues.filter(i => i.row === id);
      const status = mine.some(i => i.level === 'block') ? 'block' : mine.length ? 'warn' : checked ? 'pass' : 'pending';
      return { id, label, status, note: mine.length ? undefined : note, issues: mine };
    };
    return [
      row('secure', 'Secure connection', f.secure === true),
      row('motion', 'Motion sensor', !!f.motion && f.motion.usable, f.motion && `about ${f.motion.hz} readings a second`),
      row('audio', 'Tone and beeps', f.audioRunning === true && f.heard === true),
      row('hearing', 'You can hear the coach', f.heard === true),
      row('speech', 'Spoken cues', f.voiceOn !== false && f.heard === true, f.voiceOn === false ? 'turned off' : undefined),
      row('wake', 'Screen stays awake', f.wakeLock === 'ok'),
      row('storage', 'Saved results', f.storage === true),
    ];
  }

  return { clamp, mean, sd, quantile, tilt, makeSmoother, calibrate, level, gate, summarizeHold, PHASE_LIMITS, MAX_PHASES, normalizePhases, buildPlan, planSeconds, describePhases, demoTilt, demoCalibration, assessMotion, assessCapabilities, capabilityRows };
})();
if (typeof module !== 'undefined') module.exports = Core;
