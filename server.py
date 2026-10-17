#!/usr/bin/env python3
"""Serve Breath Hold Coach for testing over an HTTPS tunnel.

Only / and /index.html are served, so nothing else in the repo (such as .git) is reachable through the tunnel.

Usage: python3 server.py [port]
"""
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGES = {"/": "index.html", "/index.html": "index.html"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        name = PAGES.get(self.path.split("?")[0])
        body = (ROOT / name).read_bytes() if name else b"not found"
        self.send_response(200 if name else 404)
        self.send_header("Content-Type", "text/html; charset=utf-8" if name else "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
