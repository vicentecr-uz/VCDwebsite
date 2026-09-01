#!/usr/bin/env bash
# Start/stop Astro + branch sync for a local editing session.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_DIR="$ROOT/.dev-session"
BUN="$HOME/.bun/bin/bun"

ASTRO_PID="$SESSION_DIR/astro.pid"
SYNC_PID="$SESSION_DIR/branch-sync.pid"
ASTRO_LOG="$SESSION_DIR/astro.log"
SYNC_LOG="$SESSION_DIR/branch-sync.log"

ASTRO_LABEL="com.vcruzdesigns.vcdwebsite.astro"
SYNC_LABEL="com.vcruzdesigns.vcdwebsite.branch-sync"

ASTRO_PORT=4321

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

adopt_launchd_job() {
  local label="$1"
  local pid_file="$2"
  local pid

  pid="$(launchd_pid "$label")"
  if [[ -n "$pid" ]] && pid_alive "$pid"; then
    echo "$pid" >"$pid_file"
    return 0
  fi
  return 1
}

port_in_use() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

lan_ip() {
  # Prefer the active Wi‑Fi / Ethernet interface so phone URLs match the LAN.
  ipconfig getifaddr en0 2>/dev/null \
    || ipconfig getifaddr en1 2>/dev/null \
    || true
}

print_urls() {
  local ip
  ip="$(lan_ip)"

  echo ""
  echo "  Site:  http://localhost:${ASTRO_PORT}"
  if [[ -n "$ip" ]]; then
    echo "  Phone: http://${ip}:${ASTRO_PORT}"
  fi
  echo ""
  echo "  Logs: tail -f .dev-session/astro.log"
}

cmd_status() {
  local astro_pid astro_ok=0

  astro_pid="$(read_pid "$ASTRO_PID" || true)"

  echo "Dev session status"
  echo "------------------"

  if [[ -n "$astro_pid" ]] && pid_alive "$astro_pid"; then
    echo "  Astro: running (pid $astro_pid, port $ASTRO_PORT)"
    astro_ok=1
  elif port_in_use "$ASTRO_PORT"; then
    echo "  Astro: port $ASTRO_PORT in use (not tracked by this script)"
  else
    echo "  Astro: stopped"
  fi

  local sync_pid sync_ok=0
  sync_pid="$(read_pid "$SYNC_PID" || true)"
  if [[ -n "$sync_pid" ]] && pid_alive "$sync_pid"; then
    echo "  Sync:  running (pid $sync_pid)"
    sync_ok=1
  else
    echo "  Sync:  stopped"
  fi

  if [[ "$astro_ok" -eq 1 ]]; then
    print_urls
  fi

  if [[ "$sync_ok" -eq 1 ]]; then
    echo "  Sync log: tail -f .dev-session/branch-sync.log"
  fi
}

stop_pid_file() {
  local name="$1"
  local label="$2"
  local pid_file="$3"

  local pid was_alive=0 removed_job=0
  pid="$(read_pid "$pid_file" || true)"

  if use_launchd && [[ -n "$label" ]] && launchd_loaded "$label"; then
    if [[ -z "$pid" ]]; then
      pid="$(launchd_pid "$label")"
    fi
    if [[ -n "$pid" ]] && pid_alive "$pid"; then
      was_alive=1
    fi
    remove_launchd_job "$label"
    removed_job=1
  fi

  if [[ -z "$pid" ]]; then
    echo "  $name: not tracked"
    rm -f "$pid_file"
    return 0
  fi

  if pid_alive "$pid"; then
    was_alive=1
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      if ! pid_alive "$pid"; then
        break
      fi
      sleep 0.25
    done
    if pid_alive "$pid"; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "  $name: stopped (pid $pid)"
  elif [[ "$was_alive" -eq 1 || "$removed_job" -eq 1 ]]; then
    echo "  $name: stopped (pid $pid)"
  else
    echo "  $name: already stopped (stale pid $pid)"
  fi

  rm -f "$pid_file"
}

cmd_stop() {
  echo "Stopping dev session..."
  stop_pid_file "Astro" "$ASTRO_LABEL" "$ASTRO_PID"
  # Legacy Decap pid from older sessions — stop if still tracked.
  stop_pid_file "Decap" "" "$SESSION_DIR/decap.pid"
  stop_pid_file "Sync" "$SYNC_LABEL" "$SYNC_PID"
  echo "Done."
}

start_process() {
  local name="$1"
  local label="$2"
  local pid_file="$3"
  local log_file="$4"
  shift 4

  if use_launchd; then
    local job_pid
    job_pid="$(launchd_pid "$label")"
    if [[ -n "$job_pid" ]] && pid_alive "$job_pid"; then
      echo "$job_pid" >"$pid_file"
      echo "  $name: already running (pid $job_pid)"
      return 0
    fi
  fi

  local existing_pid
  existing_pid="$(read_pid "$pid_file" || true)"
  if [[ -n "$existing_pid" ]] && pid_alive "$existing_pid"; then
    echo "  $name: already running (pid $existing_pid)"
    return 0
  fi

  local pid
  if use_launchd; then
    if launchd_loaded "$label"; then
      remove_launchd_job "$label"
    fi
    : >"$log_file"

    if ! launchctl submit -l "$label" -o "$log_file" -e "$log_file" -- \
      /bin/bash -c 'cd "$1"; shift; exec "$@"' _ "$ROOT" "$@"; then
      echo "  $name: failed to start — see $log_file"
      tail -n 20 "$log_file" || true
      rm -f "$pid_file"
      return 1
    fi

    local current_pid candidate_pid="" stable_ticks=0 stable_pid=""
    for _ in {1..40}; do
      current_pid="$(launchd_pid "$label")"
      if [[ -n "$current_pid" ]] && pid_alive "$current_pid"; then
        echo "$current_pid" >"$pid_file"
        if [[ "$current_pid" == "$candidate_pid" ]]; then
          stable_ticks=$((stable_ticks + 1))
        else
          candidate_pid="$current_pid"
          stable_ticks=1
        fi
        if [[ "$stable_ticks" -ge 3 ]]; then
          stable_pid="$current_pid"
          break
        fi
      else
        candidate_pid=""
        stable_ticks=0
        rm -f "$pid_file"
      fi
      sleep 0.25
    done
    pid="$stable_pid"
  else
    # Non-macOS fallback for environments without a per-user launchd session.
    : >"$log_file"
    nohup bash -c 'cd "$1"; shift; exec "$@"' _ "$ROOT" "$@" >>"$log_file" 2>&1 &
    pid=$!
    echo "$pid" >"$pid_file"
    disown "$pid" 2>/dev/null || true

    for _ in {1..40}; do
      if ! pid_alive "$pid"; then
        break
      fi
      sleep 0.25
    done
  fi

  if [[ -z "${pid:-}" ]] || ! pid_alive "$pid"; then
    echo "  $name: failed to start — see $log_file"
    tail -n 20 "$log_file" || true
    if use_launchd; then
      remove_launchd_job "$label"
    fi
    rm -f "$pid_file"
    return 1
  fi

  echo "  $name: started (pid $pid)"
}

session_running() {
  local astro_pid
  astro_pid="$(read_pid "$ASTRO_PID" || true)"
  [[ -n "$astro_pid" ]] && pid_alive "$astro_pid"
}

cmd_start() {
  if use_launchd; then
    adopt_launchd_job "$ASTRO_LABEL" "$ASTRO_PID" || true
    adopt_launchd_job "$SYNC_LABEL" "$SYNC_PID" || true
  fi

  if session_running; then
    echo "Dev session already running."
    cmd_status
    exit 0
  fi

  if port_in_use "$ASTRO_PORT"; then
    echo "Port $ASTRO_PORT is already in use. Stop the other process or run: $0 stop"
    exit 1
  fi

  echo "Starting dev session..."
  # --host is also set in astro.config.mjs (server.host); keep the flag so a
  # bare restart still binds even if config is temporarily wrong.
  start_process "Astro" "$ASTRO_LABEL" "$ASTRO_PID" "$ASTRO_LOG" "$BUN" run dev -- --host
  bash "$ROOT/scripts/branch-sync.sh" start

  echo ""
  echo "Dev session ready."
  print_urls
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

usage() {
  cat <<EOF
Usage: $0 {start|stop|status|restart}

  start    Start Astro (port $ASTRO_PORT) and branch sync
  stop     Stop tracked dev-session processes
  status   Show whether server is running
  restart  Stop then start
EOF
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  restart) cmd_restart ;;
  *) usage; exit 1 ;;
esac
