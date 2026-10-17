# Idea log

Ideas for Breath Hold Coach that we may work on later. Each has the reason behind it.
Evidence marked *17 Oct log* comes from the first real iPhone session (iOS 18.7, 4 × 20 s holds, target 75%).

## Measurement accuracy

- **Re-zero the relaxed level during each rest.** After calibration, relaxed breathing read about −19%
  instead of 0% (*17 Oct log*), so hold levels like 115% were partly drift. Re-measure the median calm
  level in the last ~15 s of each rest and shift `zero` to it (keep `full − zero` unchanged).
- **Detect the phone shifting.** At ~40 s the phone tilted ~6° for 2 s and then settled ~0.5° from where it
  was (*17 Oct log*). Flag sudden jumps much larger than a breath, and offer "Phone moved, recalibrate?"
  or recalibrate automatically if it happens during calibration.
- **Better calibration breaths.** Holds reached 105–127% (*17 Oct log*), so the calibration breaths were
  shallower than real holds. Tell the user to breathe in "as deep as you will during treatment", or take
  100% from the highest steady hold instead of the median.
- **Make drop counts match the saved trace.** The live count uses every frame (~60/s) but the log keeps
  10/s, so hold 2 showed 2 drops on screen but 1 in the trace (*17 Oct log*). Either ignore dips shorter
  than ~0.3 s or log the gate state change events themselves.
- **Wobble that ignores the breath-in.** Wobble currently includes the overshoot at the start of a hold.
  Measure it from second 3 onwards, and report the slope (sinking or rising) separately.

## Coaching

- **Warn about slow sinking.** Holds 1–2 rose to ~125% and then sank steadily towards the line
  (*17 Oct log*). Detect a downward slope during a hold and give a gentle cue ("keep your chest lifted")
  before the level reaches the line. Also coach against a big gulp that leaks away.
- **Build-up mode.** Start at 10 s and add 5 s per session or per successful hold up to 25–30 s, as UK
  patient leaflets suggest.
- **Coaching notes on the summary.** Turn the numbers into one plain sentence per hold, e.g. "Started high,
  then sank below the line at 15 s."
- **Ask the treatment team's settings.** Optional fields for chest vs belly breathing, hold length and
  number of holds, so practice matches the clinic's protocol.

## Logs and review

- **Log viewer.** A page that opens an exported `.json` (file picker) and plots each hold with the target
  line, for the patient or clinician to review.
- **Local time in file names.** Session ids and export names use UTC; switch to local time.
- **Delete logs.** A button to clear stored logs and history on the phone.

## Platform

- **Install to Home Screen / offline.** Web app manifest, icon and service worker so it opens like an app
  and works without a connection. Also stops Safari clearing storage after weeks of non-use.
- **Proper hosting for patients.** A permanent HTTPS host (e.g. GitHub Pages) instead of the temporary
  tunnel, once we decide to publish.
- **Second-screen mirror.** Show the ball on a laptop or tablet while lying down. Needs a relay server or
  WebRTC signalling, so it is no longer HTML-only.
- **Languages.** Translated text and spoken cues. Northern Sydney Cancer Centre built a multilingual
  coaching app after 22% of culturally and linguistically diverse patients failed or were excluded from
  breath hold.

## Open questions

- Which app does the oncologist's clinic currently give patients, and what does it do well?
- Does the clinic's system measure chest or abdomen, and where (sternum, upper abdomen)?
