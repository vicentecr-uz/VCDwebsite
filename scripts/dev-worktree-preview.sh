#!/usr/bin/env bash
# Detached Astro preview for a git worktree (QA rotation). Survives the
# calling agent exiting — unlike `astro dev` in a worker's process group.
# Does not touch port 4321 (that's `bun run dev:session`).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_DIR="$ROOT/.dev-session"
BUN="$HOME/.bun/bin/bun"

mkdir -p "$SESSION_DIR"

pid_alive() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

port_in_use() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>/dev/null
}

usage() {
  cat <<EOF
Usage: $0 {start|stop|status} <port>

  start 4325   Detached Astro in this checkout on that port
  stop 4325    Stop the tracked process for that port
  status 4325  Running?

Logs: .dev-session/astro-<port>.log
EOF
}

PORT="${2:-}"
CMD="${1:-}"

if [[ -z "$CMD" || -z "$PORT" || ! "$PORT" =~ ^[0-9]+$ ]]; then
  usage
  exit 1
fi

if [[ "$PORT" == "4321" ]]; then
  echo "Port 4321 is the main dev session. Use: bun run dev:session"
  exit 1
fi

PID_FILE="$SESSION_DIR/astro-${PORT}.pid"
LOG_FILE="$SESSION_DIR/astro-${PORT}.log"

cmd_status() {
  local pid=""
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
  fi
  if [[ -n "$pid" ]] && pid_alive "$pid"; then
    echo "Astro: running (pid $pid, port $PORT)  http://localhost:${PORT}/"
    return 0
  fi
  if port_in_use "$PORT"; then
    echo "Astro: port $PORT in use (not tracked by this script)"
    return 0
  fi
  echo "Astro: stopped (port $PORT)"
  return 1
}

cmd_stop() {
  local pid=""
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
  fi
  if [[ -n "$pid" ]] && pid_alive "$pid"; then
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      pid_alive "$pid" || break
      sleep 0.25
    done
    pid_alive "$pid" && kill -9 "$pid" 2>/dev/null || true
    echo "  stopped pid $pid"
  fi
  rm -f "$PID_FILE"
}

cmd_start() {
  if [[ -f "$PID_FILE" ]]; then
    local existing
    existing="$(cat "$PID_FILE")"
    if pid_alive "$existing"; then
      echo "Already running (pid $existing)  http://localhost:${PORT}/"
      return 0
    fi
  fi
  if port_in_use "$PORT"; then
    echo "Port $PORT is already in use."
    exit 1
  fi

  : >"$LOG_FILE"
  # Same detach as scripts/dev-session.sh — nohup + disown so a short-lived
  # agent shell cannot take Astro down with it.
  nohup bash -c "cd '$ROOT'; exec \"\$@\"" _ "$BUN" x astro dev --port "$PORT" --host >>"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" >"$PID_FILE"
  disown "$pid" 2>/dev/null || true

  for _ in {1..40}; do
    if ! pid_alive "$pid"; then
      echo "Failed to start — see $LOG_FILE"
      tail -n 20 "$LOG_FILE" || true
      rm -f "$PID_FILE"
      exit 1
    fi
    if port_in_use "$PORT"; then
      echo "Astro: started (pid $pid, port $PORT)  http://localhost:${PORT}/"
      return 0
    fi
    sleep 0.25
  done

  echo "Astro: started (pid $pid) — waiting for listen; log: $LOG_FILE"
}

case "$CMD" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *) usage; exit 1 ;;
esac
