#!/usr/bin/env python3
"""Turn Breath Hold Coach session logs into an HTML report with charts.

Reads logs exported from the app (one session per .json, or the multi-session export) and writes a single
self-contained HTML file: no Python packages, no network. Open it in any browser.

Usage:
  python3 logviewer.py                      # every .json in ./logs
  python3 logviewer.py path/to/log.json ... # files or folders
  python3 logviewer.py -o report.html --no-open
"""
import argparse
import json
import re
import statistics
import sys
import webbrowser
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent


# ---------- Loading ----------

def load_records(paths):
    """Return session records from files or folders, de-duplicated by id and sorted by start time."""
    files = []
    for p in map(Path, paths):
        if p.is_dir():
            files += sorted(p.glob("*.json"))
        elif p.is_file():
            files.append(p)
        else:
            print(f"skipping {p}: not found", file=sys.stderr)
    records = {}
    for f in files:
        try:
            data = json.loads(f.read_text())
        except (OSError, ValueError) as e:
            print(f"skipping {f}: {e}", file=sys.stderr)
            continue
        for rec in data if isinstance(data, list) else [data]:
            if isinstance(rec, dict) and rec.get("app") == "dibh-coach" and rec.get("trace") is not None:
                records[rec.get("id") or f"{f.name}-{len(records)}"] = rec
    return sorted(records.values(), key=lambda r: r.get("startedAt", ""))


# ---------- Deriving chart data ----------

def local_time(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()
    except (AttributeError, ValueError):
        return None


def device_name(ua):
    ua = ua or ""
    m = re.search(r"iPhone OS (\d+)_(\d+)", ua)
    if m:
        return f"iPhone, iOS {m.group(1)}.{m.group(2)}"
    m = re.search(r"Android (\d+(?:\.\d+)?)", ua)
    if m:
        return f"Android {m.group(1)}"
    return "Desktop browser" if ua else "Unknown device"


def phase_intervals(rec):
    """[(phase, start, end)] from the phase events; the last one ends at the session end."""
    evs = [(e["t"], e["phase"]) for e in rec.get("events", []) if e.get("name") == "phase"]
    end = rec.get("durationSec") or (rec["trace"][-1][0] if rec["trace"] else 0)
    return [(ph, t, evs[i + 1][0] if i + 1 < len(evs) else end) for i, (t, ph) in enumerate(evs)]


def runs(rows, key):
    """Split consecutive rows into [start_t, end_t, value] runs of key(row)."""
    out = []
    for r in rows:
        v = key(r)
        if out and out[-1][2] == v and r[0] - out[-1][1] <= 0.25:
            out[-1][1] = r[0]
        else:
            out.append([r[0], r[0], v])
    return out


def r1(v):
    return None if v is None else round(v, 1)


def quantile(values, q):
    s = sorted(values)
    return s[round(q * (len(s) - 1))]


def drift(trace, cal, ix):
    """Calm level of each calm stretch and level of each calibration deep breath, on the calibrated scale.

    Uses the stored calibration (origin, axis, zero, full) to project raw tilt, so it also works before
    calibration finished. Returns None when the log has no usable calibration.
    """
    if not all(k in cal for k in ("origin", "axis", "zero", "full")) or cal["full"] == cal["zero"]:
        return None
    T, P, R, PH = ix["t_s"], ix["pitch_deg"], ix["roll_deg"], ix["phase"]
    (ox, oy), (ax, ay), zero, full = cal["origin"], cal["axis"], cal["zero"], cal["full"]

    def level(row):
        return 100 * ((row[P] - ox) * ax + (row[R] - oy) * ay - zero) / (full - zero)

    # Consecutive rows of the same phase form one stretch.
    stretches = []
    for row in trace:
        if stretches and stretches[-1]["phase"] == row[PH] and row[T] - stretches[-1]["rows"][-1][T] < 0.3:
            stretches[-1]["rows"].append(row)
        else:
            stretches.append({"phase": row[PH], "rows": [row]})

    calm, deep, holds_seen = [], [], 0
    for s in stretches:
        rows, t0 = s["rows"], s["rows"][0][T]
        if s["phase"] == "hold":
            holds_seen += 1
            continue
        if s["phase"] == "calHold":
            rows = [r for r in rows if r[T] - t0 >= 2.5]  # the app ignores the first 2.5 s too
            label = f"Deep breath {len(deep) + 1}"
            target = deep
        elif s["phase"] in ("baseline", "prep", "rest"):
            if s["phase"] == "rest":
                rows = [r for r in rows if r[T] - t0 >= 5]  # skip the recovery breaths right after a hold
            label = {"baseline": "Calibration calm", "prep": "Before hold 1"}.get(s["phase"], f"Rest after hold {holds_seen}")
            target = calm
        else:
            continue
        if len(rows) < 10:
            continue
        levels = [level(r) for r in rows]
        target.append({
            "label": label, "t0": rows[0][T], "t1": rows[-1][T], "t": round((rows[0][T] + rows[-1][T]) / 2, 2),
            "median": r1(statistics.median(levels)), "lo": r1(quantile(levels, 0.1)), "hi": r1(quantile(levels, 0.9)),
        })
    return {"calm": calm, "deep": deep, "rangeDeg": round(full - zero, 3)}


def build_session(rec):
    cols = rec.get("traceColumns") or ["t_s", "pitch_deg", "roll_deg", "level_pct", "beam_on", "phase"]
    ix = {c: i for i, c in enumerate(cols)}
    T, P, R, L, B, PH = (ix[c] for c in ["t_s", "pitch_deg", "roll_deg", "level_pct", "beam_on", "phase"])
    trace = rec["trace"]
    settings = rec.get("settings", {})
    cal = rec.get("calibration") or {}
    holds = rec.get("holds", [])
    hold_sec = settings.get("holdSec", 20)
    intervals = phase_intervals(rec)

    # Bands: calibration block, then each hold.
    bands = []
    cal_phases = {"settle", "baseline", "calIn", "calHold", "calRest"}
    cal_spans = [(s, e) for ph, s, e in intervals if ph in cal_phases]
    for s, e in [(cal_spans[0][0], cal_spans[-1][1])] if cal_spans else []:
        bands.append({"x0": s, "x1": e, "label": "Calibration"})
    hold_spans = [(s, e) for ph, s, e in intervals if ph == "hold"]
    for i, (s, e) in enumerate(hold_spans):
        bands.append({"x0": s, "x1": e, "label": f"H{i + 1}"})

    hold_rows = [r for r in trace if r[PH] == "hold" and r[L] is not None]
    lane = [{"x0": a, "x1": b, "on": bool(v)} for a, b, v in runs(hold_rows, lambda r: r[B])]

    overlay = []
    for i, h in enumerate(holds):
        s = h.get("startT", hold_spans[i][0] if i < len(hold_spans) else 0)
        pts = [[round(r[T] - s, 2), r[L]] for r in trace if r[PH] == "hold" and s - 0.05 <= r[T] <= s + hold_sec + 0.2]
        overlay.append({"name": f"Hold {h.get('hold', i + 1)}", "points": pts})

    total = sum(h.get("seconds", 0) for h in holds)
    on_pct = sum(h.get("onPct", 0) * h.get("seconds", 0) for h in holds) / total if total else None

    calm_rest = [r[L] for r in trace if r[PH] in ("rest", "prep") and r[L] is not None]
    start = local_time(rec.get("startedAt"))
    return {
        "id": rec.get("id"),
        "title": start.strftime("%a %d %b %Y, %H:%M") if start else rec.get("id"),
        "dateShort": start.strftime("%d %b %H:%M") if start else rec.get("id"),
        "device": device_name(rec.get("userAgent")),
        "demo": bool(rec.get("demo")),
        "outcome": rec.get("outcome"),
        "failReason": rec.get("failReason"),
        "settings": settings,
        "durationSec": rec.get("durationSec"),
        "onPct": r1(on_pct),
        "holdsDone": len(holds),
        "calibration": cal,
        "restLevelMedian": r1(statistics.median(calm_rest)) if calm_rest else None,
        "holds": holds,
        "timeline": {"points": [[r[T], r[L]] for r in trace], "bands": bands, "lane": lane},
        "overlay": overlay,
        "calib": {
            "calm": [[r[P], r[R]] for r in trace if r[PH] == "baseline"],
            "deep": [[r[P], r[R]] for r in trace if r[PH] == "calHold"],
        },
        "raw": {"pitch": [[r[T], r[P]] for r in trace], "roll": [[r[T], r[R]] for r in trace], "bands": bands},
        "drift": drift(trace, cal, ix),
    }


# ---------- Output ----------

def render(sessions):
    data = json.dumps({"sessions": sessions, "generated": datetime.now().strftime("%d %b %Y, %H:%M")}, separators=(",", ":"))
    data = data.replace("</", "<\\/")
    return (ROOT / "logviewer_template.html").read_text().replace("/*__DATA__*/null", data)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Make an HTML report with charts from Breath Hold Coach logs.")
    ap.add_argument("paths", nargs="*", default=[str(ROOT / "logs")], help="log files or folders (default: ./logs)")
    ap.add_argument("-o", "--output", help="output HTML file (default: reports/report-<time>.html)")
    ap.add_argument("--no-open", action="store_true", help="don't open the report in the browser")
    args = ap.parse_args(argv)

    records = load_records(args.paths)
    if not records:
        print("No Breath Hold Coach logs found. Export a log from the app and pass its path.", file=sys.stderr)
        return 1
    sessions = [build_session(r) for r in records]

    out = Path(args.output) if args.output else ROOT / "reports" / f"report-{datetime.now():%Y%m%d-%H%M%S}.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(sessions))
    print(f"Wrote {out} ({len(sessions)} session{'s' if len(sessions) != 1 else ''})")
    if not args.no_open:
        webbrowser.open(out.resolve().as_uri())
    return 0


if __name__ == "__main__":
    sys.exit(main())
