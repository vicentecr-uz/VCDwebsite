#!/usr/bin/env bash
# Start/stop Astro dev server + Decap local proxy for a local editing session.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_DIR="$ROOT/.dev-session"
BUN="$HOME/.bun/bin/bun"

ASTRO_PID="$SESSION_DIR/astro.pid"
DECAP_PID="$SESSION_DIR/decap.pid"
ASTRO_LOG="$SESSION_DIR/astro.log"
DECAP_LOG="$SESSION_DIR/decap.log"

ASTRO_PORT=4321
DECAP_PORT=8081

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

port_in_use() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

print_urls() {
  echo ""
  echo "  Site:  http://localhost:${ASTRO_PORT}"
  echo "  Admin: http://localhost:${ASTRO_PORT}/admin"
  echo ""
  echo "  Logs: tail -f .dev-session/astro.log .dev-session/decap.log"
}

cmd_status() {
  local astro_pid decap_pid astro_ok=0 decap_ok=0

  astro_pid="$(read_pid "$ASTRO_PID" || true)"
  decap_pid="$(read_pid "$DECAP_PID" || true)"

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

  if [[ -n "$decap_pid" ]] && pid_alive "$decap_pid"; then
    echo "  Decap: running (pid $decap_pid, port $DECAP_PORT)"
    decap_ok=1
  elif port_in_use "$DECAP_PORT"; then
    echo "  Decap: port $DECAP_PORT in use (not tracked by this script)"
  else
    echo "  Decap: stopped"
  fi

  if [[ "$astro_ok" -eq 1 && "$decap_ok" -eq 1 ]]; then
    print_urls
  fi
}

stop_pid_file() {
  local name="$1"
  local pid_file="$2"

  local pid
  pid="$(read_pid "$pid_file" || true)"

  if [[ -z "$pid" ]]; then
    echo "  $name: not tracked"
    rm -f "$pid_file"
    return 0
  fi

  if pid_alive "$pid"; then
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
  else
    echo "  $name: already stopped (stale pid $pid)"
  fi

  rm -f "$pid_file"
}

cmd_stop() {
  echo "Stopping dev session..."
  stop_pid_file "Astro" "$ASTRO_PID"
  stop_pid_file "Decap" "$DECAP_PID"
  echo "Done."
}

start_process() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  shift 3

  local existing_pid
  existing_pid="$(read_pid "$pid_file" || true)"
  if [[ -n "$existing_pid" ]] && pid_alive "$existing_pid"; then
    echo "  $name: already running (pid $existing_pid)"
    return 0
  fi

  : >"$log_file"
  # nohup + disown detaches the child so it survives the caller's shell exiting
  # (e.g. an agent that launches the session from a short-lived command).
  nohup bash -c "cd '$ROOT'; exec \"\$@\"" _ "$@" >>"$log_file" 2>&1 &

  local pid=$!
  echo "$pid" >"$pid_file"
  disown "$pid" 2>/dev/null || true

  for _ in {1..40}; do
    if ! pid_alive "$pid"; then
      echo "  $name: failed to start — see $log_file"
      tail -n 20 "$log_file" || true
      rm -f "$pid_file"
      return 1
    fi
    sleep 0.25
  done

  echo "  $name: started (pid $pid)"
}

session_running() {
  local astro_pid decap_pid
  astro_pid="$(read_pid "$ASTRO_PID" || true)"
  decap_pid="$(read_pid "$DECAP_PID" || true)"
  [[ -n "$astro_pid" ]] && pid_alive "$astro_pid" && [[ -n "$decap_pid" ]] && pid_alive "$decap_pid"
}

cmd_start() {
  if session_running; then
    echo "Dev session already running."
    cmd_status
    exit 0
  fi

  if port_in_use "$ASTRO_PORT"; then
    echo "Port $ASTRO_PORT is already in use. Stop the other process or run: $0 stop"
    exit 1
  fi

  if port_in_use "$DECAP_PORT"; then
    echo "Port $DECAP_PORT is already in use. Stop the other process or run: $0 stop"
    exit 1
  fi

  echo "Starting dev session..."
  start_process "Astro" "$ASTRO_PID" "$ASTRO_LOG" "$BUN" run dev
  start_process "Decap" "$DECAP_PID" "$DECAP_LOG" "$BUN" x decap-server

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

  start    Start Astro (port $ASTRO_PORT) and Decap proxy (port $DECAP_PORT)
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
