"""Tests for logviewer.py using a synthetic session (run: python3 -m unittest discover test)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import logviewer  # noqa: E402


def synthetic_record(rec_id="s1", started="2026-10-17T06:00:00.000Z", on=1):
    """Calibration 0-30 s, one 10 s hold at 40-50 s, rest until 60 s."""
    trace, events = [], []
    plan = [("settle", 0, 4), ("baseline", 4, 20), ("calHold", 20, 30), ("prep", 30, 40), ("hold", 40, 50), ("rest", 50, 60)]
    for ph, a, b in plan:
        events.append({"t": a, "name": "phase", "phase": ph})
        for i in range(int(a * 10), int(b * 10)):
            t = i / 10
            level = None if a < 30 else (90 if ph == "hold" else 0)
            trace.append([t, 1.0 + (2 if ph in ("calHold", "hold") else 0), 0.5, level, on if ph == "hold" else 0, ph])
    return {
        "app": "dibh-coach", "id": rec_id, "startedAt": started, "demo": False, "outcome": "completed",
        "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)",
        "settings": {"holds": 1, "holdSec": 10, "restSec": 20, "target": 75},
        "calibration": {"rangeDeg": 2.0, "axis": [1, 0]}, "durationSec": 60,
        "holds": [{"hold": 1, "startT": 40, "seconds": 10, "onPct": 100 * on, "meanLevel": 90, "wobble": 1.0, "drops": 0}],
        "events": events,
        "traceColumns": ["t_s", "pitch_deg", "roll_deg", "level_pct", "beam_on", "phase"],
        "trace": trace,
    }


class LogViewerTest(unittest.TestCase):
    def test_build_session(self):
        s = logviewer.build_session(synthetic_record())
        self.assertEqual(s["device"], "iPhone, iOS 18.7")
        self.assertEqual(s["onPct"], 100)
        self.assertEqual([b["label"] for b in s["timeline"]["bands"]], ["Calibration", "H1"])
        self.assertEqual(s["timeline"]["bands"][0]["x1"], 30)
        self.assertEqual(s["timeline"]["lane"], [{"x0": 40.0, "x1": 49.9, "on": True}])
        self.assertEqual(len(s["overlay"][0]["points"]), 100)
        self.assertEqual(s["overlay"][0]["points"][0][0], 0)
        self.assertEqual(len(s["calib"]["calm"]), 160)
        self.assertEqual(s["restLevelMedian"], 0)

    def test_loads_single_and_multi_exports_and_dedupes(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = synthetic_record("a", "2026-10-16T06:00:00Z"), synthetic_record("b", "2026-10-15T06:00:00Z")
            Path(d, "one.json").write_text(json.dumps(a))
            Path(d, "all.json").write_text(json.dumps([a, b, {"app": "other"}]))
            Path(d, "bad.json").write_text("{not json")
            recs = logviewer.load_records([d])
        self.assertEqual([r["id"] for r in recs], ["b", "a"])

    def test_writes_report(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "log.json").write_text(json.dumps(synthetic_record()))
            out = Path(d, "r.html")
            self.assertEqual(logviewer.main([d, "-o", str(out), "--no-open"]), 0)
            html = out.read_text()
        self.assertNotIn("/*__DATA__*/", html)
        self.assertIn('"id":"s1"', html)

    def test_no_logs(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(logviewer.main([d, "--no-open"]), 1)


if __name__ == "__main__":
    unittest.main()


class DriftTest(unittest.TestCase):
    def test_drift_projects_calm_and_deep_breaths(self):
        rec = synthetic_record()
        rec["calibration"] = {"origin": [1.0, 0.5], "axis": [1.0, 0.0], "zero": 0.0, "full": 2.0}
        # Shift the phone 0.5 deg against the breathing direction during the final rest.
        for row in rec["trace"]:
            if row[5] == "rest":
                row[1] -= 0.5
        d = logviewer.build_session(rec)["drift"]
        self.assertEqual([c["label"] for c in d["calm"]], ["Calibration calm", "Before hold 1", "Rest after hold 1"])
        self.assertEqual([c["median"] for c in d["calm"]], [0, 0, -25])
        self.assertEqual([x["median"] for x in d["deep"]], [100])
        self.assertEqual(d["rangeDeg"], 2.0)

    def test_no_drift_without_calibration_axis(self):
        self.assertIsNone(logviewer.build_session(synthetic_record())["drift"])
