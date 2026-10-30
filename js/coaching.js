// The live session: sensor input, the hold sequence, the chart and the summary.
// This is the app's entry point: importing the other parts starts them. Core is the global from core.js.
import { $, load, save, settings, Sound, speak, keepAwake, releaseAwake, Rec, calInfo, r1, r2, exportLogs, show, showError, hideError } from './shared.js';
import { HISTORY_KEY, renderHistory } from './config.js';
import { capabilitySnapshot } from './phone-check.js';
import { startDemo, stopDemo } from './demo.js';

// Plan for the running session, fixed when practice starts.
let plan = Core.buildPlan(settings.phases);

// ---------- Signal input (sensor or demo) ----------
const smP = Core.makeSmoother(0.25), smR = Core.makeSmoother(0.25);
const S = {
  running: false, demo: false, latest: null, samples: 0,
  cal: null, phase: '', phaseT: 0, phaseDur: 0, spoken: {},
  calBase: [], calHold: [], calStep: 0,
  holdIdx: 0, holdSamples: [], results: [], inReached: false,
  level: null, gateOn: false, beepT: 0,
  clock: 0, trace: [], rawRef: null,
};

function feed(p, r, t) {
  S.latest = [smP.update(p, t), smR.update(r, t)];
  S.samples++;
}

function onMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null || g.y == null || g.z == null) return;
  const [p, r] = Core.tilt(g.x, g.y, g.z);
  feed(p, r, performance.now() / 1000);
}

// What demo mode's simulated chest needs from the session.
const demoChest = { feed, breathingIn: () => settings.autoBreathe && (S.phase === 'in' || S.phase === 'hold') };

// ---------- Session sequencer ----------
const CAL_DEEP_BREATHS = 3;

function enter(phase, dur, chip, cue, say) {
  S.phase = phase;
  S.phaseT = 0;
  S.phaseDur = dur;
  S.spoken = {};
  Rec.event('phase', { phase });
  if (chip) $('chip').textContent = chip;
  if (cue) $('cue').textContent = cue;
  if (say) speak(say);
}

function startCalibration() {
  S.cal = null; S.level = null; S.calBase = []; S.calHold = []; S.calStep = 0; S.rawRef = null;
  S.trace = [];
  enter('settle', 4, 'Signal check', 'Lie still and breathe normally', 'Lie still, and breathe normally.');
}

// Labels for the hold at plan index i.
const multiPhase = () => plan.some(h => h.phase > 1);
function holdChip(i) {
  const h = plan[i];
  return multiPhase() ? `Phase ${h.phase} · hold ${h.phaseHold} of ${h.phaseHolds}` : `Hold ${i + 1} of ${plan.length}`;
}
function phaseIntro(i) {
  const h = plan[i];
  return `Phase ${h.phase}. ${h.phaseHolds} hold${h.phaseHolds === 1 ? '' : 's'} of ${h.holdSec} seconds.`;
}

function startPractice() {
  S.holdIdx = 0; S.results = []; S.trace = [];
  const intro = multiPhase() ? phaseIntro(0) : `Hold 1 of ${plan.length}.`;
  enter('prep', 6, holdChip(0), 'Breathe normally', `Practice starts. ${intro} Breathe normally.`);
}

function startSession(reuseCal) {
  S.running = true;
  S.clock = 0;
  show('session');
  keepAwake();
  const reuse = reuseCal && S.cal;
  plan = Core.buildPlan(settings.phases);
  Rec.start({ reusedCal: reuse ? S.cal : null, demo: S.demo, plan, capabilities: capabilitySnapshot(), clock: () => S.clock });
  Rec.event('audio-state', { state: Sound.ctx?.state ?? 'none' });
  if (reuse) startPractice(); else startCalibration();
  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

function stopSession() {
  S.running = false;
  Sound.tone(false);
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  releaseAwake();
}

function failCalibration(reason) {
  Rec.finish('calibration-failed', { failReason: reason, calibration: calInfo(S.lastCal), samplesReceived: S.samples });
  stopSession();
  stopDemo();
  const range = S.lastCal?.rangeDeg;
  const msgs = {
    nosensor: '<strong>No motion data arrived.</strong> Open the link in your phone’s main browser (Safari on iPhone, Chrome on Android) and tap <em>Allow</em> if asked about motion access. If you tapped <em>Don’t Allow</em> before, close the tab, open the link again and tap Start.',
    weak: `<strong>The phone barely moved when you breathed in</strong>${range != null ? ` (about ${Math.max(0, range).toFixed(1)}° between calm and deep breaths)` : ''}. Make sure the phone lies flat on the lower breastbone without sliding, breathe into your chest, and try again.`,
    'few-samples': '<strong>Not enough data to calibrate.</strong> Keep the screen on and the page open during calibration, then try again.',
  };
  showError(msgs[reason] || msgs.weak);
}

function finishSession() {
  stopSession();
  stopDemo();
  const res = S.results;
  const rec = Rec.finish(res.length >= plan.length ? 'completed' : 'stopped');
  lastRecord = rec;
  if (!res.length) { show('intro'); return; }
  $('logStatus').textContent = 'Log saved on this phone. Tap Export log to share it.';
  const total = res.reduce((s, r) => s + r.seconds, 0);
  const onPct = total ? res.reduce((s, r) => s + (r.onPct * r.seconds) / total, 0) : 0;
  const wobble = Core.mean(res.map(r => r.wobble));
  $('sBeam').textContent = Math.round(onPct) + '%';
  $('sHolds').textContent = `${res.length}/${plan.length}`;
  $('sWobble').textContent = wobble.toFixed(1);
  $('sumTitle').textContent = onPct >= 90 ? 'Steady holds' : onPct >= 70 ? 'Good practice' : 'Keep practising';
  const tbody = $('sumRows');
  tbody.textContent = '';
  const phases = multiPhase();
  $('phaseCol').hidden = !phases;
  res.forEach((r, i) => {
    const tr = document.createElement('tr');
    for (const v of [i + 1, ...(phases ? [plan[i].phase] : []), r.seconds.toFixed(0) + ' s', Math.round(r.onPct) + '%', Math.round(r.meanLevel) + '%', r.wobble.toFixed(1), r.drops]) {
      const td = document.createElement('td');
      td.textContent = String(v);
      tr.append(td);
    }
    tbody.append(tr);
  });
  if (!S.demo) {
    const hist = load(HISTORY_KEY, []);
    hist.unshift({ date: Date.now(), holds: res.length, plan: Core.describePhases(settings.phases), target: settings.target, onPct, wobble });
    save(HISTORY_KEY, hist.slice(0, 50));
    renderHistory();
  }
  show('summary');
}

function remaining() { return Math.max(0, S.phaseDur - S.phaseT); }

function tick(dt) {
  S.phaseT += dt;
  const s = S.latest;
  const done = S.phaseT >= S.phaseDur;

  if (S.cal && s) {
    S.level = Core.level(s, S.cal);
    S.gateOn = Core.gate(S.gateOn, S.level, settings.target);
  }

  switch (S.phase) {
    case 'settle':
      if (done) {
        if (S.samples < 10) return failCalibration('nosensor');
        enter('baseline', 20, 'Calibrating', 'Breathe normally and relax', 'Breathe normally, and relax.');
      }
      break;
    case 'baseline':
      if (s) S.calBase.push(s);
      if (done) {
        S.calStep = 0;
        enter('calIn', 4, `Deep breath 1 of ${CAL_DEEP_BREATHS}`, 'Breathe in deeply into your chest', 'Breathe in deeply, and hold.');
      }
      break;
    case 'calIn':
      if (done) enter('calHold', 6, null, 'Hold', null);
      break;
    case 'calHold':
      if (s && S.phaseT >= 2.5) S.calHold.push(s);
      if (done) enter('calRest', 8, null, 'Breathe out and relax', 'Breathe out, and relax.');
      break;
    case 'calRest':
      if (done) {
        S.calStep++;
        if (S.calStep < CAL_DEEP_BREATHS) {
          enter('calIn', 4, `Deep breath ${S.calStep + 1} of ${CAL_DEEP_BREATHS}`, 'Breathe in deeply into your chest', 'Breathe in deeply, and hold.');
        } else {
          const cal = Core.calibrate(S.calBase, S.calHold, S.demo ? 0.1 : 0.4);
          S.lastCal = cal;
          if (!cal.ok) return failCalibration(cal.reason);
          S.cal = cal;
          if (Rec.cur) Rec.cur.calibration = calInfo(cal, false);
          S.gateOn = false;
          S.trace = [];
          Sound.chime();
          enter('calDone', 4, 'Calibrated', 'Calibrated. Get ready.', 'Calibration done.');
        }
      }
      break;
    case 'calDone':
      if (done) startPractice();
      break;
    case 'prep':
    case 'rest':
      if (S.phase === 'rest' && remaining() <= 5 && !S.spoken.ready) { S.spoken.ready = true; speak('Get ready.'); }
      if (done) {
        S.inReached = false;
        enter('in', 10, holdChip(S.holdIdx), 'Breathe in deeply and hold', 'Breathe in deeply, and hold.');
      }
      break;
    case 'in':
      if (S.level != null && S.gateOn) S.inReached = true;
      if (S.inReached || done) {
        S.holdSamples = [];
        S.beepT = 0;
        S.holdStartT = S.clock;
        S.reachSec = S.phaseT;
        enter('hold', plan[S.holdIdx].holdSec, null, 'Hold', null);
      }
      break;
    case 'hold': {
      if (S.level != null) S.holdSamples.push({ dt, level: S.level, on: S.gateOn });
      if (!S.gateOn) {
        S.beepT -= dt;
        if (S.beepT <= 0) { Sound.alert(); S.beepT = 1.0; }
      } else {
        S.beepT = 0;
      }
      const left = remaining();
      for (const [n, w] of [[3, 'three'], [2, 'two'], [1, 'one']]) {
        if (left <= n && !S.spoken[n]) { S.spoken[n] = true; speak(w); }
      }
      if (done) {
        const sum = Core.summarizeHold(S.holdSamples);
        S.results.push(sum);
        if (Rec.cur) Rec.cur.holds.push({
          hold: S.holdIdx + 1, phase: plan[S.holdIdx].phase, plannedSec: plan[S.holdIdx].holdSec, startT: r2(S.holdStartT), reachedTarget: S.inReached, secondsToReach: r1(S.reachSec),
          seconds: r1(sum.seconds), onPct: r1(sum.onPct), meanLevel: r1(sum.meanLevel), wobble: r2(sum.wobble), drops: sum.drops,
        });
        S.holdIdx++;
        enter('out', 3, null, 'Relax and breathe out', 'And relax. Breathe out.');
      }
      break;
    }
    case 'out':
      if (done) {
        if (S.holdIdx >= plan.length) return finishSession();
        // Rest length belongs to the hold just finished; announce a new phase as its rest begins.
        const next = plan[S.holdIdx], newPhase = next.phase !== plan[S.holdIdx - 1].phase;
        enter('rest', plan[S.holdIdx - 1].restSec, `Rest · next: ${holdChip(S.holdIdx).toLowerCase()}`,
          newPhase ? `Rest. Next: phase ${next.phase}, ${next.holdSec} s holds` : 'Rest and breathe normally',
          newPhase ? `Rest. Next, ${phaseIntro(S.holdIdx)}` : null);
      }
      break;
  }

  // Feedback sound: steady tone while above the line during a hold attempt,
  // quiet during the spoken 3-2-1 at the end of the hold.
  const active = S.phase === 'in' || (S.phase === 'hold' && remaining() > 3);
  Sound.tone(active && S.gateOn);
}

// ---------- Rendering ----------
let lastFrame = 0;
const TRACE_SEC = 20;

function frame(now) {
  if (!S.running) return;
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  S.clock += dt;
  tick(dt);
  if (!S.running) return;
  Rec.sample(S.latest, S.level, S.gateOn, S.phase);

  if (S.latest) {
    if (S.cal && S.level != null) {
      S.trace.push({ t: S.clock, v: S.level });
    } else {
      if (!S.rawRef) S.rawRef = S.latest;
      S.trace.push({ t: S.clock, v: (S.latest[0] - S.rawRef[0]) + (S.latest[1] - S.rawRef[1]) });
    }
    while (S.trace.length && S.trace[0].t < S.clock - TRACE_SEC) S.trace.shift();
  }
  renderPanel();
  drawChart();
  requestAnimationFrame(frame);
}

function renderPanel() {
  const timed = ['settle', 'baseline', 'calIn', 'calHold', 'calRest', 'calDone', 'prep', 'hold', 'out', 'rest'];
  $('timer').textContent = timed.includes(S.phase) ? String(Math.ceil(remaining())) : '–';
  const gate = $('gate');
  const active = S.phase === 'in' || S.phase === 'hold';
  gate.hidden = !(S.cal && active);
  gate.textContent = S.gateOn ? 'Beam on' : 'Beam paused';
  gate.className = 'gate ' + (S.gateOn ? 'on' : 'off');
  $('level').textContent = S.cal && S.level != null
    ? `Breath level ${Math.round(S.level)}% · target ${settings.target}%`
    : (S.samples ? 'Reading sensor…' : 'Waiting for sensor…');
  $('recal').hidden = !S.cal;
}

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function drawChart() {
  const c = $('chart');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const col = { ink: css('--ink'), muted: css('--muted'), line: css('--line'), accent: css('--accent'), on: css('--on'), off: css('--off') };
  const padT = 14, padB = 14, left = 12, ballX = w - 30;
  let lo, hi;
  if (S.cal) { lo = -25; hi = 130; } else {
    const vs = S.trace.map(p => p.v);
    lo = Math.min(-0.5, ...vs); hi = Math.max(0.5, ...vs);
    const m = (hi - lo) * 0.15; lo -= m; hi += m;
  }
  const y = v => padT + ((hi - v) / (hi - lo)) * (h - padT - padB);
  const x = t => ballX - ((S.clock - t) / TRACE_SEC) * (ballX - left);

  ctx.font = `12px ${css('--font-body')}`;
  ctx.textBaseline = 'bottom';
  if (S.cal) {
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    for (const [v, label] of [[0, 'calm breathing'], [100, 'deepest breath']]) {
      ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(w - 8, y(v)); ctx.stroke();
      ctx.fillStyle = col.muted; ctx.fillText(label, left + 2, y(v) - 3);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = col.accent;
    ctx.lineWidth = 2;
    const ty = y(settings.target);
    ctx.beginPath(); ctx.moveTo(left, ty); ctx.lineTo(w - 8, ty); ctx.stroke();
    ctx.fillStyle = col.accent;
    ctx.fillText(`target ${settings.target}%`, left + 2, ty - 3);
  } else {
    ctx.fillStyle = col.muted;
    ctx.fillText('signal check', left + 2, padT + 14);
  }

  if (S.trace.length > 1) {
    ctx.strokeStyle = col.ink;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    S.trace.forEach((p, i) => { const px = x(p.t), py = y(Core.clamp(p.v, lo, hi)); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const last = S.trace[S.trace.length - 1];
  if (last) {
    const by = y(Core.clamp(last.v, lo, hi));
    const active = S.phase === 'in' || S.phase === 'hold';
    ctx.fillStyle = S.cal && active ? (S.gateOn ? col.on : col.off) : col.accent;
    ctx.beginPath(); ctx.arc(ballX, by, 13, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------- Pausing when the page is hidden ----------
const CAL_PHASES = ['settle', 'baseline', 'calIn', 'calHold', 'calRest'];
document.addEventListener('visibilitychange', () => {
  if (!S.running) return;
  if (document.visibilityState === 'hidden') { Sound.tone(false); return; }
  keepAwake();
  Sound.wake();
  lastFrame = performance.now();
  Rec.event('resumed-after-hidden', { phase: S.phase });
  if (CAL_PHASES.includes(S.phase)) {
    startCalibration();
    speak('Calibration restarted.');
  } else if (S.phase === 'in' || S.phase === 'hold') {
    enter('rest', 10, `Rest · next: ${holdChip(S.holdIdx).toLowerCase()}`, 'Paused. This hold will restart.', 'Paused. This hold will restart.');
  }
});

// ---------- Buttons ----------
function begin(demo) {
  hideError();
  // Everything that needs a tap happens here, before the first await.
  Sound.init();
  speak('Starting.');
  S.demo = demo;
  S.samples = 0; S.latest = null; smP.reset(); smR.reset();
  // Demo mode skips calibration: its simulated chest has a known range.
  if (demo) { startDemo(demoChest); S.cal = Core.demoCalibration(); startSession(true); return; }
  window.removeEventListener('devicemotion', onMotion);
  window.addEventListener('devicemotion', onMotion);
  startSession(false);
}

// A tap during a session also restarts audio iOS stopped.
document.addEventListener('pointerdown', () => { if (S.running) Sound.wake(); });
$('start').addEventListener('click', () => begin(false));
$('demo').addEventListener('click', () => begin(true));
$('stop').addEventListener('click', () => {
  if (S.results.length) finishSession();
  else {
    Rec.finish('stopped', { calibration: Rec.cur?.calibration ?? calInfo(S.lastCal) });
    stopSession(); stopDemo(); show('intro');
  }
});
$('recal').addEventListener('click', () => { Rec.event('recalibrate'); S.results = []; startCalibration(); });

let lastRecord = null;
$('export').addEventListener('click', async () => {
  if (!lastRecord) return;
  const r = await exportLogs([lastRecord], 'breath-hold-' + lastRecord.id);
  if (r === 'downloaded') $('logStatus').textContent = 'Log files downloaded.';
});
$('again').addEventListener('click', () => {
  Sound.init();
  speak('Starting.');
  if (S.demo) startDemo(demoChest);
  startSession(true);
});
$('home').addEventListener('click', () => show('intro'));
