#!/bin/bash
# Double-click to run Portfol.io locally and open it in the browser.
# Required because the app fetches local files (the world map data,
# the PDF importer's vendor scripts) - those fetch() calls are blocked
# by the browser when the page is opened directly as a file:// URL,
# so it must be served over http:// instead.
cd "$(dirname "$0")/.."
PORT=5177
LOG="/tmp/portfolio-io-server.log"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found on PATH - can't start the local server."
  echo "Press Enter to close this window."
  read -r
  exit 1
fi

if ! curl -s "http://localhost:$PORT" > /dev/null; then
  # nohup + disown: without both, the server was dying the moment this
  # script's shell exited (SIGHUP on the backgrounded job) - the browser
  # tab would open, then "connection refused" a second later, because
  # by the time it tried to connect the server was already gone. This
  # way the server keeps running in the background after this window
  # closes, exactly like before - just actually working now.
  nohup python3 -m http.server "$PORT" > "$LOG" 2>&1 &
  disown

  # Poll instead of a fixed sleep - don't open the browser until the
  # server has actually confirmed it's answering requests.
  for i in $(seq 1 20); do
    if curl -s "http://localhost:$PORT" > /dev/null; then break; fi
    sleep 0.25
  done

  if ! curl -s "http://localhost:$PORT" > /dev/null; then
    echo "Server didn't start. Log output:"
    cat "$LOG"
    echo ""
    echo "Press Enter to close this window."
    read -r
    exit 1
  fi
fi

open "http://localhost:$PORT/index.html"
