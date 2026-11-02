// The setup screen (phases, target, feedback), the history screen and the moves between them.
import { $, SETTINGS_KEY, load, save, settings, LOGS_KEY, exportLogs, show } from './shared.js';

export const HISTORY_KEY = 'dibh-coach.history';

const PHASE_OPTIONS = {
  holds: [1, 2, 3, 4, 5, 6, 8, 10],
  holdSec: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60],
  restSec: [10, 15, 20, 30, 40, 60, 90, 120],
};
const PHASE_LABELS = { holds: 'Holds', holdSec: 'Hold length', restSec: 'Rest' };

function renderPhases() {
  const ol = $('phases');
  ol.textContent = '';
  settings.phases.forEach((ph, i) => {
    const li = document.createElement('li');
    li.className = 'phase phase-grid';
    const n = document.createElement('span');
    n.className = 'phase-n';
    n.textContent = String(i + 1);
    li.append(n);
    for (const k of ['holds', 'holdSec', 'restSec']) {
      const sel = document.createElement('select');
      sel.id = `phase${i}-${k}`;
      sel.setAttribute('aria-label', `Phase ${i + 1} ${PHASE_LABELS[k]}`);
      const opts = [...new Set([...PHASE_OPTIONS[k], ph[k]])].sort((a, b) => a - b);
      for (const v of opts) sel.add(new Option(k === 'holds' ? String(v) : `${v} s`, String(v)));
      sel.value = String(ph[k]);
      sel.addEventListener('change', () => { ph[k] = Number(sel.value); phasesChanged(false); });
      li.append(sel);
    }
    if (settings.phases.length > 1) {
      const rm = document.createElement('button');
      rm.textContent = '✕';
      rm.setAttribute('aria-label', `Remove phase ${i + 1}`);
      rm.addEventListener('click', () => { settings.phases.splice(i, 1); phasesChanged(); });
      li.append(rm);
    }
    ol.append(li);
  });
  $('addPhase').hidden = settings.phases.length >= Core.MAX_PHASES;
  $('holdTip').hidden = settings.phases.length > 1; // room for more phases on small phones
  renderPlanTotal();
}

function renderPlanTotal() {
  const p = Core.buildPlan(settings.phases);
  $('planTotal').textContent = `${p.length} hold${p.length === 1 ? '' : 's'} · about ${Math.round(Core.planSeconds(p) / 60)} min after calibration`;
}

function phasesChanged(rerender = true) {
  save(SETTINGS_KEY, settings);
  if (rerender) renderPhases(); else renderPlanTotal();
}

function bindSettings() {
  renderPhases();
  $('addPhase').addEventListener('click', () => {
    // A new phase starts as a copy of the last one, so small changes are quick.
    settings.phases.push({ ...settings.phases[settings.phases.length - 1] });
    phasesChanged();
  });
  $('target').value = String(settings.target);
  $('targetOut').textContent = settings.target + '%';
  $('target').addEventListener('input', () => {
    settings.target = Number($('target').value);
    $('targetOut').textContent = settings.target + '%';
    save(SETTINGS_KEY, settings);
  });
  for (const k of ['voice', 'tone', 'autoBreathe']) {
    $(k).checked = !!settings[k];
    $(k).addEventListener('change', () => { settings[k] = $(k).checked; save(SETTINGS_KEY, settings); });
  }
}

export function renderHistory() {
  const items = load(HISTORY_KEY, []);
  $('historyPanel').hidden = !items.length;
  const ul = $('history');
  ul.textContent = '';
  for (const h of items.slice(0, 6)) {
    const li = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = new Date(h.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const what = document.createElement('span');
    what.textContent = `${h.plan ?? `${h.holds} × ${h.holdSec} s`} · ${Math.round(h.onPct)}% above line`;
    li.append(when, what);
    ul.append(li);
  }
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
$('exportAll').addEventListener('click', async () => {
  const logs = load(LOGS_KEY, []);
  const r = await exportLogs(logs, 'breath-hold-logs-' + stamp());
  if (r === 'empty') $('exportAllNote').textContent = 'No detailed logs on this phone yet.';
  else if (r === 'downloaded') $('exportAllNote').textContent = `Downloaded ${logs.length} session logs.`;
});

$('next').addEventListener('click', () => show('ready'));
$('readyBack').addEventListener('click', () => show('intro'));
$('openMore').addEventListener('click', () => show('more'));
$('moreBack').addEventListener('click', () => show('intro'));

bindSettings();
renderHistory();
