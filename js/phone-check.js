// The first screen: setup stays hidden until this passes. Core holds the rules that judge the results.
import { $, settings, Sound, speak, keepAwake, releaseAwake, show } from './shared.js';

const Caps = {
  facts: {},
  stage: 'idle', // idle, checking or done
  demoOnly: false,
  current() { return { ...this.facts, voiceOn: settings.voice }; },
  issues() { return Core.assessCapabilities(this.current()); },
  blocked() { return this.issues().some(i => i.level === 'block'); },
  canPlay() { return this.facts.audio || (this.facts.speech && settings.voice); },
  // Everything that can be read without a tap or a prompt.
  readStatic() {
    const ua = navigator.userAgent;
    const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    Object.assign(this.facts, {
      secure: window.isSecureContext,
      motionApi: typeof DeviceMotionEvent !== 'undefined',
      audio: !!(window.AudioContext || window.webkitAudioContext),
      ringerMatters: iOS && !navigator.audioSession,
      speech: 'speechSynthesis' in window,
      storage: storageWorks(),
    });
    if (!('wakeLock' in navigator)) this.facts.wakeLock = 'unsupported';
  },
  // Voices can load late, so an empty list only counts after a short wait.
  watchVoices() {
    if (!this.facts.speech) return;
    let waited = false;
    const read = () => {
      const n = speechSynthesis.getVoices().length;
      if (n || waited) { this.facts.voices = n; renderCheck(); }
    };
    speechSynthesis.addEventListener?.('voiceschanged', read);
    read();
    setTimeout(() => { waited = true; read(); }, 2000);
  },
};

function storageWorks() {
  try { localStorage.setItem('dibh-coach.check', '1'); localStorage.removeItem('dibh-coach.check'); return true; } catch { return false; }
}

const CHECK_MARKS = { pending: ['–', 'not checked yet'], pass: ['✓', 'passed'], warn: ['!', 'warning'], block: ['✕', 'failed'] };

function renderCheck() {
  const ul = $('checkRows');
  ul.textContent = '';
  for (const row of Core.capabilityRows(Caps.current())) {
    const [mark, word] = CHECK_MARKS[row.status];
    const li = document.createElement('li');
    li.className = 'check-row ' + row.status;
    const m = document.createElement('span');
    m.className = 'mark';
    m.textContent = mark;
    m.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'check-label';
    label.textContent = row.label;
    const sr = document.createElement('span');
    sr.className = 'sr';
    sr.textContent = `: ${word}`;
    label.append(sr);
    if (row.note) {
      const note = document.createElement('span');
      note.className = 'check-note';
      note.textContent = ` · ${row.note}`;
      label.append(note);
    }
    li.append(m, label);
    for (const it of row.issues) {
      const p = document.createElement('p');
      const title = document.createElement('strong');
      title.textContent = it.title;
      p.append(title, it.detail);
      li.append(p);
    }
    ul.append(li);
  }

  const blocked = Caps.blocked(), done = Caps.stage === 'done', heard = Caps.facts.heard;
  const askSound = done && !blocked && Caps.canPlay();
  const mustAnswer = askSound && heard === undefined;
  $('soundStep').hidden = !askSound || heard === true;
  // After a No the row above explains the fix, so the question shrinks to make room for it.
  const retrying = heard === false;
  $('soundTitle').hidden = retrying;
  $('soundHint').hidden = retrying;
  $('heardNo').hidden = retrying;
  $('heardYes').textContent = retrying ? 'I heard it now' : 'Yes';
  $('checkLede').hidden = Caps.stage !== 'idle';
  $('checkRows').querySelector('.block, .warn')?.scrollIntoView({ block: 'nearest' });
  const parts = [];
  if (Caps.facts.audio) {
    if (settings.tone) parts.push('a steady tone');
    parts.push('two beeps');
  }
  if (Caps.facts.speech && settings.voice) parts.push('a voice');
  $('soundHint').textContent = `You should hear ${parts.join(', then ')}.`;
  $('runCheck').hidden = done || (blocked && Caps.stage === 'idle');
  $('runCheck').disabled = Caps.stage === 'checking';
  $('runCheck').textContent = Caps.stage === 'checking' ? 'Checking your phone…' : 'Check my phone';
  $('checkContinue').hidden = !done || blocked || mustAnswer;
  $('checkContinue').textContent = Caps.issues().length ? 'Continue anyway' : 'Continue';
  $('checkAgain').hidden = !(done || blocked) || mustAnswer || Caps.stage === 'checking';
  $('checkDemo').hidden = !blocked;
}

// Listens for up to 3 s, or 1.5 s when readings arrive promptly. Own listener, so it cannot affect the session.
function probeMotion() {
  return new Promise(resolve => {
    const readings = [], started = performance.now();
    let hidden = false;
    const onReading = e => {
      const g = e.accelerationIncludingGravity;
      if (g && g.x != null && g.y != null && g.z != null) readings.push([g.x, g.y, g.z, performance.now() / 1000]);
    };
    const onHide = () => { if (document.visibilityState === 'hidden') hidden = true; };
    window.addEventListener('devicemotion', onReading);
    document.addEventListener('visibilitychange', onHide);
    const timer = setInterval(() => {
      const ms = performance.now() - started;
      if (!hidden && ms < 3000 && !(ms >= 1500 && readings.length >= 10)) return;
      clearInterval(timer);
      window.removeEventListener('devicemotion', onReading);
      document.removeEventListener('visibilitychange', onHide);
      resolve({ readings, hidden });
    }, 100);
  });
}

// Plays each sound a session uses, one at a time, through the same code the session uses.
// Speech goes last and starts only when none is playing, because Safari interrupts audio during speech.
let testRun = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function playTestSound() {
  const run = ++testRun;
  Sound.init();
  for (let i = 0; i < 30 && window.speechSynthesis?.speaking; i++) await wait(100);
  await wait(300);
  if (run !== testRun) return;
  Sound.tone(true);
  await wait(1200);
  if (run !== testRun) return;
  Sound.tone(false);
  await wait(400);
  if (run !== testRun) return;
  Sound.alert();
  await wait(800);
  if (run !== testRun) return;
  speak('This is how the coach sounds.');
}

function stopTestSound() {
  testRun++;
  Sound.tone(false);
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
}

// Runs inside the tap until its first await: iPhone only allows the motion prompt and wake lock from a tap.
async function runCheck() {
  const facts = Caps.facts;
  Object.assign(facts, { motionPermission: undefined, motionError: undefined, motion: undefined, audioRunning: undefined, wakeLock: undefined, heard: undefined });
  Caps.readStatic();
  // No point asking for motion access that cannot work.
  if (Caps.blocked()) { Caps.stage = 'done'; renderCheck(); return; }

  Sound.init();
  speak('Checking your phone.');
  let ask;
  try {
    ask = typeof DeviceMotionEvent.requestPermission === 'function' ? DeviceMotionEvent.requestPermission() : Promise.resolve('granted');
  } catch (e) { ask = Promise.reject(e); }
  const wake = keepAwake();
  Caps.stage = 'checking';
  renderCheck();

  let granted = false;
  try {
    granted = await ask === 'granted';
    facts.motionPermission = granted ? 'granted' : 'denied';
  } catch (e) {
    facts.motionPermission = 'error';
    facts.motionError = String(e && e.message || e);
  }
  if (granted) {
    const { readings, hidden } = await probeMotion();
    if (hidden) { // Leaving the page stops the readings, which says nothing about the sensor.
      releaseAwake();
      Caps.stage = 'idle';
      renderCheck();
      return;
    }
    facts.motion = Core.assessMotion(readings);
  }
  facts.wakeLock = await wake;
  releaseAwake(); // the session takes it again when it starts
  if (facts.speech && !facts.voices) facts.voices = speechSynthesis.getVoices().length;
  // Safari interrupts audio while speech plays and it recovers afterwards, so only a plain stop counts.
  const state = Sound.ctx?.state;
  if (state) facts.audioRunning = (state !== 'suspended' && state !== 'closed') || window.speechSynthesis?.speaking === true;
  Caps.stage = 'done';
  renderCheck();
  if (!Caps.blocked() && Caps.canPlay()) playTestSound();
}

function leaveCheck(demoOnly) {
  Caps.demoOnly = demoOnly;
  $('demoOnly').hidden = !demoOnly;
  $('next').hidden = demoOnly;
  $('demoStart').hidden = !demoOnly;
  show('intro');
}

// For the session log.
export const capabilitySnapshot = () => ({ ...Caps.facts, issues: Caps.issues().map(i => i.id) });

$('runCheck').addEventListener('click', runCheck);
$('checkAgain').addEventListener('click', () => { stopTestSound(); runCheck(); });
$('checkContinue').addEventListener('click', () => leaveCheck(false));
$('checkDemo').addEventListener('click', () => leaveCheck(true));
$('backToCheck').addEventListener('click', () => { Caps.stage = 'idle'; renderCheck(); show('check'); });
$('soundAgain').addEventListener('click', () => { stopTestSound(); playTestSound(); });
for (const [id, heard] of [['heardYes', true], ['heardNo', false]]) {
  $(id).addEventListener('click', () => { stopTestSound(); Caps.facts.heard = heard; renderCheck(); });
}

Caps.readStatic();
Caps.watchVoices();
renderCheck();
