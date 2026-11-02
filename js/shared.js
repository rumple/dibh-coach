// Used by more than one part of the app: stored settings, sound and voice, wake lock, session logs, screens.
// Core is the global from core.js.
export const $ = id => document.getElementById(id);

// Tells the fallback in index.html that the app has started.
window.coachReady = true;
$('oldBrowser').hidden = true;

// ---------- Stored settings (per-device conveniences) ----------
const DEFAULTS = { phases: [{ holds: 4, holdSec: 20, restSec: 40 }], target: 75, voice: true, tone: true, autoBreathe: false };
export const SETTINGS_KEY = 'dibh-coach.settings';

export function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const stored = load(SETTINGS_KEY, {});
export const settings = { ...DEFAULTS, ...stored };
// Settings saved before phases existed had one holds / holdSec / restSec set.
settings.phases = Core.normalizePhases(stored.phases ?? (stored.holds != null ? [stored] : DEFAULTS.phases));
for (const k of ['holds', 'holdSec', 'restSec']) delete settings[k];

// ---------- Sound and voice ----------
export const Sound = {
  ctx: null, gain: null, on: false,
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // Safari 17+: play even when the ringer switch is on silent.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 392;
    osc.connect(this.gain);
    osc.start();
    // Safari 27 interrupts Web Audio whenever speech plays and leaves it interrupted afterwards.
    this.ctx.addEventListener('statechange', () => {
      Rec.event('audio-state', { state: this.ctx.state });
      this.wake();
    });
    this.ctx.resume?.();
  },
  // Restart audio that iOS stopped. Resuming does not need a tap, but it cuts off speech,
  // so wait while the voice is talking; speak() calls this again when it finishes.
  wake() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    if ('speechSynthesis' in window && speechSynthesis.speaking) return;
    ctx.resume().catch(() => { /* retried on the next tap or prompt */ });
  },
  tone(on) {
    if (!this.ctx) return;
    on = on && settings.tone;
    if (on) this.wake();
    if (on === this.on) return;
    this.on = on;
    const g = this.gain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(on ? 0.1 : 0, t, 0.06);
  },
  beep(freq, dur, delay = 0, vol = 0.35) {
    if (!this.ctx) return;
    this.wake();
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  },
  alert() { this.beep(660, 0.12); this.beep(660, 0.12, 0.2); },
  chime() { this.beep(523, 0.2); this.beep(784, 0.35, 0.18); },
};

let utterance = null; // the current one, held so Safari cannot discard it mid-speech
export function speak(text) {
  if (!settings.voice || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    utterance = u;
    u.addEventListener('start', () => Rec.event('voice-start', { text }));
    u.addEventListener('end', () => { Rec.event('voice-end', { text }); Sound.wake(); });
    u.addEventListener('error', e => { Rec.event('voice-error', { text, error: e.error }); Sound.wake(); });
    // Safari drops an utterance queued straight after cancel(), so only cancel when
    // something is playing and give it a moment. Otherwise speak now, inside the tap.
    if (speechSynthesis.speaking || speechSynthesis.pending) {
      speechSynthesis.cancel();
      setTimeout(() => speechSynthesis.speak(u), 150);
    } else {
      speechSynthesis.speak(u);
    }
  } catch { /* speech unavailable */ }
}

// ---------- Screen wake lock ----------
let wakeLock = null;
// Returns 'ok', 'unsupported' or 'denied'.
export async function keepAwake() {
  if (!('wakeLock' in navigator)) return 'unsupported';
  try {
    if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    return 'ok';
  } catch (e) {
    Rec.event('wake-lock-failed', { error: e && e.name });
    return 'denied';
  }
}
export function releaseAwake() { try { wakeLock?.release(); } catch { /* ignore */ } wakeLock = null; }

// ---------- Detailed session logs ----------
// Each session keeps calibration, per-hold stats, phase events and a 10 Hz trace.
// The last 10 records stay on the phone and leave it only through Export.
export const LOGS_KEY = 'dibh-coach.logs';
const MAX_LOGS = 10;
export const r1 = v => Math.round(v * 10) / 10;
export const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;

export function calInfo(cal, reused) {
  if (!cal) return null;
  const out = { reused: !!reused, ok: cal.ok !== false };
  for (const k of ['rangeDeg', 'calmSdDeg', 'holdSdDeg', 'zero', 'full']) if (cal[k] != null) out[k] = r3(cal[k]);
  if (cal.origin) out.origin = cal.origin.map(r3);
  if (cal.axis) out.axis = cal.axis.map(r3);
  return out;
}

function storeLogs(logs) {
  // Drop the oldest records until the list fits in storage.
  for (let list = logs.slice(0, MAX_LOGS); list.length; list = list.slice(0, -1)) {
    try { localStorage.setItem(LOGS_KEY, JSON.stringify(list)); return; } catch { /* quota: try fewer */ }
  }
}

export const Rec = {
  cur: null,
  nextT: 0,
  clock: () => 0,
  // clock gives the session time in seconds, for stamping events and samples.
  start({ reusedCal, demo, plan, capabilities, clock }) {
    this.clock = clock;
    this.cur = {
      app: 'dibh-coach', format: 1,
      id: new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + '-' + Math.random().toString(36).slice(2, 6),
      startedAt: new Date().toISOString(),
      demo,
      userAgent: navigator.userAgent,
      capabilities,
      // holds is the planned total; holdSec / restSec are the longest, for readers of the older format.
      settings: {
        ...settings, phases: settings.phases.map(p => ({ ...p })), holds: plan.length,
        holdSec: Math.max(...plan.map(h => h.holdSec)), restSec: Math.max(...plan.map(h => h.restSec)),
      },
      outcome: 'running',
      calibration: reusedCal ? calInfo(reusedCal, true) : null,
      holds: [],
      events: [],
      traceColumns: ['t_s', 'pitch_deg', 'roll_deg', 'level_pct', 'beam_on', 'phase'],
      trace: [],
    };
    this.nextT = 0;
  },
  event(name, extra) {
    if (this.cur) this.cur.events.push({ t: r2(this.clock()), name, ...extra });
  },
  sample(latest, level, gateOn, phase) {
    const t = this.clock();
    if (!this.cur || !latest || t < this.nextT) return;
    this.nextT = t + 0.1;
    this.cur.trace.push([r2(t), r3(latest[0]), r3(latest[1]), level == null ? null : r1(level), gateOn ? 1 : 0, phase]);
  },
  finish(outcome, extra) {
    const rec = this.cur;
    if (!rec) return null;
    this.cur = null;
    Object.assign(rec, { outcome, endedAt: new Date().toISOString(), durationSec: r1(this.clock()) }, extra);
    storeLogs([rec, ...load(LOGS_KEY, [])]);
    return rec;
  },
};

function toCSV(recs) {
  const rows = ['session_id,' + recs[0].traceColumns.join(',')];
  for (const rec of recs) for (const row of rec.trace) rows.push([rec.id, ...row.map(v => v == null ? '' : v)].join(','));
  return rows.join('\n') + '\n';
}

// Share sheet on iPhone (Save to Files, AirDrop, Mail); falls back to downloads elsewhere.
export async function exportLogs(recs, baseName) {
  if (!recs.length) return 'empty';
  const files = [
    new File([JSON.stringify(recs.length === 1 ? recs[0] : recs, null, 1)], baseName + '.json', { type: 'application/json' }),
    new File([toCSV(recs)], baseName + '.csv', { type: 'text/csv' }),
  ];
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title: 'Breath hold log' }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  return 'downloaded';
}

// ---------- Screens ----------
export function show(id) {
  for (const s of ['check', 'intro', 'ready', 'more', 'session', 'summary']) $(s).hidden = s !== id;
  window.scrollTo(0, 0);
}
export function showError(html) { $('error').innerHTML = html; $('error').hidden = false; show('ready'); }
export function hideError() { $('error').hidden = true; }
