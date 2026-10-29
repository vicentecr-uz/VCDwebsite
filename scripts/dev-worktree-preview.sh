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

read_pid() {
  local file="$1"
  if [[ -f "$file" ]]; then
    cat "$file"
  fi
}

use_launchd() {
  [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1
}

launchd_loaded() {
  local label="$1"
  launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1
}

launchd_pid() {
  local label="$1"
  launchctl print "gui/$(id -u)/$label" 2>/dev/null \
    | awk '/^[[:space:]]*pid = / { print $3; exit }' \
    || true
}

remove_launchd_job() {
  local label="$1"

  launchctl remove "$label" 2>/dev/null || true
  for _ in {1..20}; do
    if ! launchd_loaded "$label"; then
      return 0
    fi
    sleep 0.25
  done
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
LAUNCHD_LABEL="com.vcruzdesigns.vcdwebsite.preview.${PORT}"

cmd_status() {
  local pid
  if use_launchd; then
    pid="$(launchd_pid "$LAUNCHD_LABEL")"
    if [[ -n "$pid" ]] && pid_alive "$pid"; then
      echo "$pid" >"$PID_FILE"
    else
      pid="$(read_pid "$PID_FILE" || true)"
    fi
  else
    pid="$(read_pid "$PID_FILE" || true)"
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
  local pid was_alive=0
  pid="$(read_pid "$PID_FILE" || true)"
  if use_launchd && launchd_loaded "$LAUNCHD_LABEL"; then
    pid="$(launchd_pid "$LAUNCHD_LABEL")"
    if [[ -n "$pid" ]] && pid_alive "$pid"; then
      was_alive=1
    fi
    remove_launchd_job "$LAUNCHD_LABEL"
  fi
  if [[ -n "$pid" ]] && pid_alive "$pid"; then
    was_alive=1
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      pid_alive "$pid" || break
      sleep 0.25
    done
    pid_alive "$pid" && kill -9 "$pid" 2>/dev/null || true
  fi
  if [[ "$was_alive" -eq 1 ]]; then
    echo "  stopped pid $pid"
  fi
  rm -f "$PID_FILE"
}

cmd_start() {
  local existing
  if use_launchd; then
    existing="$(launchd_pid "$LAUNCHD_LABEL")"
    if [[ -n "$existing" ]] && pid_alive "$existing"; then
      echo "$existing" >"$PID_FILE"
      echo "Already running (pid $existing)  http://localhost:${PORT}/"
      return 0
    fi
    if launchd_loaded "$LAUNCHD_LABEL"; then
      remove_launchd_job "$LAUNCHD_LABEL"
    fi
  fi

  existing="$(read_pid "$PID_FILE" || true)"
  if [[ -n "$existing" ]] && pid_alive "$existing"; then
    echo "Already running (pid $existing)  http://localhost:${PORT}/"
    return 0
  fi
  if port_in_use "$PORT"; then
    echo "Port $PORT is already in use."
    exit 1
  fi

  "$BUN" "$ROOT/scripts/content-snapshot.mjs" "$ROOT"

  : >"$LOG_FILE"
  local pid
  if use_launchd; then
    if ! launchctl submit -l "$LAUNCHD_LABEL" -o "$LOG_FILE" -e "$LOG_FILE" -- \
      /usr/bin/env \
      "PATH=${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}" \
      "HOME=${HOME:-}" \
      "USER=${USER:-$(id -un)}" \
      "LOGNAME=${LOGNAME:-${USER:-$(id -un)}}" \
      "VCD_REVIEW_PREVIEW=1" \
      /bin/bash -c 'cd "$1"; shift; exec "$@"' _ "$ROOT" "$BUN" x astro dev --port "$PORT" --host; then
      echo "Failed to start — see $LOG_FILE"
      tail -n 20 "$LOG_FILE" || true
      rm -f "$PID_FILE"
      exit 1
    fi

    local current_pid candidate_pid="" stable_ticks=0
    for _ in {1..40}; do
      current_pid="$(launchd_pid "$LAUNCHD_LABEL")"
      if [[ -n "$current_pid" ]] && pid_alive "$current_pid"; then
        echo "$current_pid" >"$PID_FILE"
        if [[ "$current_pid" == "$candidate_pid" ]]; then
          stable_ticks=$((stable_ticks + 1))
        else
          candidate_pid="$current_pid"
          stable_ticks=1
        fi
        if [[ "$stable_ticks" -ge 3 ]] && port_in_use "$PORT"; then
          echo "Astro: started (pid $current_pid, port $PORT)  http://localhost:${PORT}/"
          return 0
        fi
      else
        candidate_pid=""
        stable_ticks=0
        rm -f "$PID_FILE"
      fi
      sleep 0.25
    done
    remove_launchd_job "$LAUNCHD_LABEL"
    rm -f "$PID_FILE"
    echo "Failed to start — see $LOG_FILE"
    tail -n 20 "$LOG_FILE" || true
    exit 1
  fi

  # Non-macOS fallback for environments without a per-user launchd session.
  nohup env VCD_REVIEW_PREVIEW=1 bash -c 'cd "$1"; shift; exec "$@"' _ "$ROOT" "$BUN" x astro dev --port "$PORT" --host >>"$LOG_FILE" 2>&1 &
  pid=$!
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
