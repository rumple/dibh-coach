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
   (spoken 3-2-1 countdown), then rest. Defaults: 4 holds × 20 s, 40 s rest, target 75%.
4. **Summary**: time above line, average level, wobble (standard deviation of level) and drops per hold.
   Recent sessions are kept in the browser's local storage.

Everything is in `index.html` (no build step, no dependencies). Pure signal maths lives in the
`<script id="core">` block and is tested with Node.

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
