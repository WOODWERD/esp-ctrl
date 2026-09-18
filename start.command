#!/bin/bash
# ESP Ctrl launcher: serves the page on localhost (Web Serial needs that) and opens it in Chrome.
# The server sends "no-store" so the browser never shows a stale copy after an update.
cd "$(dirname "$0")/site" || exit 1
PORT=8137
# stop an older copy of this launcher's server if it is still running
OLD=$(lsof -ti tcp:$PORT 2>/dev/null); [ -n "$OLD" ] && kill $OLD 2>/dev/null && sleep 0.5
if command -v python3 >/dev/null 2>&1; then
python3 - $PORT <<'PY' &
import sys, http.server as h
class H(h.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a): pass
h.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
elif command -v ruby >/dev/null 2>&1; then ruby -run -e httpd . -b 127.0.0.1 -p $PORT >/dev/null 2>&1 &
else echo "Needs python3 or ruby to serve the page. Install Xcode command line tools: xcode-select --install"; read -r; exit 1; fi
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
sleep 1
open -a "Google Chrome" "http://localhost:$PORT/" 2>/dev/null || open "http://localhost:$PORT/"
echo "ESP Ctrl is running at http://localhost:$PORT"
echo "Leave this window open while you use it. Close it to stop."
wait $PID
