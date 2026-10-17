#!/usr/bin/env python3
"""Serve Breath Hold Coach and save session logs posted by the app.

GET  /, /index.html   the app (nothing else is served, so logs/ and .git stay private behind the tunnel)
POST /api/log         one session record as JSON; written to logs/<session id>.json

Usage: python3 server.py [port]
"""
import json
import re
import secrets
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOGS = ROOT / "logs"
MAX_BYTES = 5_000_000
PAGES = {"/": "index.html", "/index.html": "index.html"}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, content_type="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        name = PAGES.get(self.path.split("?")[0])
        if not name:
            return self._send(404, b'{"error":"not found"}')
        self._send(200, (ROOT / name).read_bytes(), "text/html; charset=utf-8")

    def do_POST(self):
        if self.path.split("?")[0] != "/api/log":
            return self._send(404, b'{"error":"not found"}')
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BYTES:
            return self._send(413, b'{"error":"bad size"}')
        try:
            rec = json.loads(self.rfile.read(length))
        except ValueError:
            return self._send(400, b'{"error":"bad json"}')
        if not isinstance(rec, dict) or rec.get("app") != "dibh-coach":
            return self._send(400, b'{"error":"not a session log"}')

        # The session id names the file, so a retried upload overwrites instead of duplicating.
        stem = re.sub(r"[^A-Za-z0-9-]", "", str(rec.get("id", "")))[:40] or secrets.token_hex(6)
        LOGS.mkdir(exist_ok=True)
        path = LOGS / f"{stem}.json"
        path.write_text(json.dumps(rec, indent=1))

        cal = rec.get("calibration") or {}
        holds = rec.get("holds") or []
        on = ", ".join(f"{h.get('onPct', 0):.0f}%" for h in holds) or "-"
        print(
            f"saved logs/{path.name}: {rec.get('outcome')}, demo={rec.get('demo')}, "
            f"range={cal.get('rangeDeg', '-')} deg, holds above line: {on}",
            flush=True,
        )
        self._send(200, json.dumps({"saved": path.name}).encode())

    def log_message(self, fmt, *args):
        pass  # keep the terminal for saved-log lines


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
