#!/usr/bin/env bash
# Serve the app locally and expose it over a temporary HTTPS link for testing on an iPhone.
# iPhone Safari only allows motion sensor access on https:// pages, so a plain LAN http:// URL will not work.
#
# Usage: ./serve.sh [port]
#   Uses cloudflared if installed (brew install cloudflared), otherwise an ssh tunnel to localhost.run.
#   The link is public but random and stops working when you press Ctrl-C.
set -euo pipefail
PORT="${1:-8000}"
cd "$(dirname "$0")"

python3 server.py "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
echo "Local:  http://localhost:$PORT  (demo mode only; no sensor on desktop)"
echo "Starting HTTPS tunnel. Open the https:// link it prints on your iPhone in Safari."
echo

if command -v cloudflared >/dev/null; then
  cloudflared tunnel --url "http://localhost:$PORT"
else
  ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -R 80:localhost:"$PORT" nokey@localhost.run
fi
