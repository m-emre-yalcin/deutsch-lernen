#!/usr/bin/env bash
#
# Deutsch Lernen — start the app.
#
#   ./start.sh              start the server and open the browser
#   ./start.sh --install    add a `german` command to your shell, then start
#   ./start.sh --prefetch   download all audio + images for offline use, then start
#   ./start.sh --validate   check the vocabulary data and exit
#   ./start.sh --port 6000  use a different port
#   ./start.sh --no-open    start without opening the browser
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PORT=5555
OPEN=1
PREFETCH=0
INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)      PORT="$2"; shift 2 ;;
    --no-open)   OPEN=0; shift ;;
    --prefetch)  PREFETCH=1; shift ;;
    --install)   INSTALL=1; shift ;;
    --validate)  exec node tools/validate.js ;;
    -h|--help)   sed -n '3,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── node check ────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js is not installed."
  echo "  Install it with:  brew install node"
  echo "  or download from: https://nodejs.org"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "✗ Node 18+ required (you have $(node -v)). Upgrade with: brew upgrade node"
  exit 1
fi

# ── optional: install the `german` shortcut ───────────────────────────────────
install_shortcut() {
  local rc="$HOME/.zshrc"
  [ -n "${BASH_VERSION:-}" ] && [ -f "$HOME/.bashrc" ] && [ ! -f "$rc" ] && rc="$HOME/.bashrc"

  if [ -f "$rc" ] && grep -q "# deutsch-lernen" "$rc"; then
    echo "✓ The 'german' command is already installed in $rc"
    return
  fi

  echo
  echo "  This will append a 'german' function to $rc so you can start"
  echo "  the app from anywhere by typing:  german"
  echo
  printf "  Add it? [y/N] "
  read -r reply
  case "$reply" in
    [yY]*)
      {
        echo ""
        echo "# deutsch-lernen — German study app"
        echo "german() { \"$DIR/start.sh\" \"\$@\"; }"
      } >> "$rc"
      echo "✓ Added. Run 'source $rc' (or open a new terminal), then just type: german"
      ;;
    *)
      echo "  Skipped. You can always run ./start.sh from $DIR"
      ;;
  esac
  echo
}

[ "$INSTALL" -eq 1 ] && install_shortcut

# ── free a stale port ─────────────────────────────────────────────────────────
# Only kills a process that is actually one of our own servers, so we never take
# down something unrelated that happens to hold the port.
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  STALE_PID="$(lsof -ti:"$PORT" | head -1)"
  if ps -p "$STALE_PID" -o command= 2>/dev/null | grep -q "server/server.js"; then
    echo "→ Stopping the previous Deutsch Lernen server (pid $STALE_PID)…"
    kill "$STALE_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      lsof -ti:"$PORT" >/dev/null 2>&1 || break
      sleep 0.2
    done
  else
    echo "✗ Port $PORT is used by another program (pid $STALE_PID):"
    ps -p "$STALE_PID" -o command= 2>/dev/null | sed 's/^/    /'
    echo "  Use a different port:  ./start.sh --port 5556"
    exit 1
  fi
fi

# ── optional: warm the offline cache ──────────────────────────────────────────
if [ "$PREFETCH" -eq 1 ]; then
  echo "→ Warming the audio + image cache (this can take a while)…"
  node tools/prefetch.js --port "$PORT" &
  PREFETCH_PID=$!
fi

# ── start ─────────────────────────────────────────────────────────────────────
node server/server.js --port "$PORT" &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  [ -n "${PREFETCH_PID:-}" ] && kill "$PREFETCH_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Wait for the health endpoint rather than a blind sleep, so the browser never
# opens onto a connection-refused page.
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  # If the server died on startup, stop waiting and surface its error.
  kill -0 "$SERVER_PID" 2>/dev/null || { wait "$SERVER_PID" 2>/dev/null || true; exit 1; }
  sleep 0.25
done

if [ "${READY:-0}" -eq 1 ]; then
  [ "$OPEN" -eq 1 ] && open "http://localhost:$PORT" 2>/dev/null || true
else
  echo "✗ Server did not become ready in 15s."
  exit 1
fi

wait "$SERVER_PID"
