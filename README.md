# Breath Hold Coach

A single-page web app for practising the deep inspiration breath hold (DIBH) used in breast radiotherapy.
The phone lies flat on the patient's breastbone; its motion sensor measures how much a deep chest breath
tilts it. After calibration the app guides a set of holds and gives sound feedback: a steady tone while the
breath is above the target line ("beam on"), double beeps when it drops below ("beam paused").

**Practice only.** It does not connect to or match any treatment machine, and its percentages are not a
clinical threshold.

## How it works

1. **Signal check** (4 s): confirms motion data is arriving.
2. **Calibration**: 20 s of calm breathing sets 0%, three deep breaths held for 6 s set 100%.
   The breathing direction is learned from the data, so the phone's orientation on the chest doesn't matter.
3. **Practice**: for each hold, breathe in until the level crosses the target, hold for the set time
   (spoken 3-2-1 countdown), then rest. The session is a list of **phases** (up to 6); each phase has its
   own number of holds, hold length and rest after each hold, e.g. 2 × 15 s with 30 s rest, then
   3 × 25 s with 60 s rest. A new phase is announced during the rest before it. Default: one phase of
   4 holds × 20 s, 40 s rest, target 75%. Settings saved before phases existed become one phase.
4. **Summary**: time above line, average level, wobble (standard deviation of level) and drops per hold.
   Recent sessions are kept in the browser's local storage.

The app is `index.html` (no build step, no dependencies). Pure signal maths lives in the
`<script id="core">` block and is tested with Node. `server.py` serves it for testing.

## Session logs

Every session (completed, stopped early, or failed calibration) produces a detailed record:

- settings (including `phases`; `holds` is the planned total, `holdSec`/`restSec` the longest), device user
  agent, outcome, start/end time
- calibration: tilt range between calm and deep breaths (`rangeDeg`), calm-breathing and hold spread,
  learned axis
- each hold: phase, planned length (`plannedSec`), time to reach the line, length, % above line, mean level,
  wobble, drops
- phase events, and a 10 Hz trace: `t_s, pitch_deg, roll_deg, level_pct, beam_on, phase`

Logs stay on the phone (the last 10 records, in Safari's local storage) and leave it only when you
share them: **Export log** on the summary screen, or **Export detailed logs** on the start screen, opens the
share sheet (Files, AirDrop, WhatsApp, Mail…) with a `.json` and a `.csv` file. Nothing is uploaded
automatically.

## Log viewer

`logviewer.py` turns exported logs into one self-contained HTML report with charts (standard-library
Python, no packages, works offline):

```sh
python3 logviewer.py path/to/breath-hold-*.json   # files or folders; default ./logs
python3 logviewer.py logs -o report.html --no-open
```

Reports go to `reports/` (git-ignored) and open in the browser. Each session shows: time above line,
signal range and duration; a session timeline with calibration and hold bands and a beam on/paused strip;
all holds overlaid from their start; per-hold bars and table; the calibration tilt scatter with notes
; calibration drift (the calm level of each rest over the session, the three calibration deep breaths, and
the biggest shift); and the raw pitch/roll trace. With several sessions there is a session
picker and a progress chart. Multi-session exports from the app's **Export detailed logs** work too.

## Test on an iPhone

iPhone Safari only gives motion data to `https://` pages, so run:

```sh
./serve.sh            # local server + temporary HTTPS tunnel
```

Open the printed `https://…` link in Safari on the iPhone, tap **Test sound**, then **Start** and
**Allow** motion access. Press Ctrl-C to stop the tunnel.

On a laptop, open `http://localhost:8000` and use **demo mode** (hold the on-screen button to "breathe in").

## iPhone notes

- No vibration: iPhone browsers don't support it, so feedback is sound and voice only.
- Turn the ringer on. Safari 17+ is asked to play through silent mode, older versions may stay muted.
- The screen is kept awake during a session; if the page is hidden, the current hold restarts.

## Tests

```sh
npm test
```
