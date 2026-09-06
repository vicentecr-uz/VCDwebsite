#!/usr/bin/env bash
# Poll origin and pull the currently checked-out branch (pull-only — no auto-commit).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_DIR="$ROOT/.dev-session"
PID_FILE="$SESSION_DIR/branch-sync.pid"
LOG_FILE="$SESSION_DIR/branch-sync.log"
LAUNCHD_LABEL="com.vcruzdesigns.vcdwebsite.branch-sync"

INTERVAL="${BRANCH_SYNC_INTERVAL:-60}"
STATE_URL="${BRANCH_SYNC_STATE_URL:-http://127.0.0.1:4321/api/dev-session-state}"
SESSION_SCRIPT="${BRANCH_SYNC_SESSION_SCRIPT:-$ROOT/scripts/dev-session.sh}"
BUN="$HOME/.bun/bin/bun"

pid_alive() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    cat "$PID_FILE"
  fi
}

use_launchd() {
  [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1
}

launchd_loaded() {
  launchctl print "gui/$(id -u)/$LAUNCHD_LABEL" >/dev/null 2>&1
}

launchd_pid() {
  launchctl print "gui/$(id -u)/$LAUNCHD_LABEL" 2>/dev/null \
    | awk '/^[[:space:]]*pid = / { print $3; exit }' \
    || true
}

remove_launchd_job() {
  launchctl remove "$LAUNCHD_LABEL" 2>/dev/null || true
  for _ in {1..20}; do
    if ! launchd_loaded; then
      return 0
    fi
    sleep 0.25
  done
}

sync_once() {
  if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') not a git repo — skip"
    return 0
  fi

  local branch upstream
  branch="$(git -C "$ROOT" branch --show-current 2>/dev/null || true)"
  if [[ -z "$branch" ]]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') detached HEAD — skip"
    return 0
  fi

  if ! upstream="$(git -C "$ROOT" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)"; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') $branch has no upstream — skip"
    return 0
  fi

  if ! git -C "$ROOT" fetch origin "$branch" 2>&1; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') fetch failed for $branch"
    return 0
  fi

  local behind ahead merge_base incoming_paths requires_restart=0 dependencies_changed=0 astro_stopped=0
  behind="$(git -C "$ROOT" rev-list --count HEAD.."$upstream" 2>/dev/null || echo 0)"
  ahead="$(git -C "$ROOT" rev-list --count "$upstream"..HEAD 2>/dev/null || echo 0)"

  if [[ "$behind" -eq 0 ]]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') $branch up to date ($upstream)"
    return 0
  fi

  merge_base="$(git -C "$ROOT" merge-base HEAD "$upstream")"
  incoming_paths="$(git -C "$ROOT" diff --name-only "$merge_base" "$upstream")"
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if [[ "$path" == package.json || "$path" == bun.lock || "$path" == bun.lockb ]]; then
      dependencies_changed=1
      requires_restart=1
    elif [[ "$path" == src/content/* || "$path" == media/* || "$path" == docs/* || "$path" == *.md || "$path" == .github/* || "$path" == .codex/* || "$path" == .cursor/* || "$path" == .claude/* ]]; then
      :
    else
      requires_restart=1
    fi
  done <<<"$incoming_paths"

  if [[ "$requires_restart" -eq 1 ]] && astro_running; then
    local state
    if ! state="$(curl --silent --show-error --fail --max-time 2 "$STATE_URL" 2>/dev/null)" || ! grep -q '"editing":false' <<<"$state"; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') runtime update deferred (authoring session active or state unavailable)"
      return 0
    fi
    # The state query is intentionally not a distributed lock; upgrade to an atomic lease if this race matters.
    if ! bash "$SESSION_SCRIPT" stop-astro; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') could not stop Astro — deferring runtime update"
      return 0
    fi
    astro_stopped=1
  fi

  echo "$(date '+%Y-%m-%d %H:%M:%S') $branch behind $upstream by $behind (ahead $ahead) — pulling"

  if [[ "$ahead" -eq 0 ]]; then
    if git -C "$ROOT" merge --ff-only "$upstream" 2>&1; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') fast-forwarded $branch"
      if [[ "$dependencies_changed" -eq 1 ]]; then
        if ! "$BUN" install --frozen-lockfile 2>&1; then
          echo "$(date '+%Y-%m-%d %H:%M:%S') dependency install failed"
          [[ "$astro_stopped" -eq 1 ]] && bash "$SESSION_SCRIPT" start-astro || true
          return 1
        fi
      fi
      [[ "$astro_stopped" -eq 1 ]] && bash "$SESSION_SCRIPT" start-astro || true
    else
      echo "$(date '+%Y-%m-%d %H:%M:%S') fast-forward failed for $branch"
      [[ "$astro_stopped" -eq 1 ]] && bash "$SESSION_SCRIPT" start-astro || true
    fi
    return 0
  fi

  if git -C "$ROOT" pull --rebase --autostash origin "$branch" 2>&1; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') rebased $branch onto $upstream"
    if [[ "$dependencies_changed" -eq 1 ]]; then
      if ! "$BUN" install --frozen-lockfile 2>&1; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') dependency install failed"
        [[ "$astro_stopped" -eq 1 ]] && bash "$SESSION_SCRIPT" start-astro || true
        return 1
      fi
    fi
  else
    echo "$(date '+%Y-%m-%d %H:%M:%S') pull --rebase failed for $branch (resolve manually)"
    git -C "$ROOT" rebase --abort 2>/dev/null || true
  fi
  if [[ "$astro_stopped" -eq 1 ]]; then bash "$SESSION_SCRIPT" start-astro || true; fi
}

astro_running() {
  bash "$SESSION_SCRIPT" astro-running >/dev/null 2>&1
}

daemon_loop() {
  mkdir -p "$SESSION_DIR"
  echo "$(date '+%Y-%m-%d %H:%M:%S') branch sync started (interval ${INTERVAL}s, pid $$)" >>"$LOG_FILE"

  while true; do
    {
      sync_once
    } >>"$LOG_FILE" 2>&1 || true
    sleep "$INTERVAL"
  done
}

cmd_start() {
  mkdir -p "$SESSION_DIR"

  if use_launchd; then
    local job_pid
    job_pid="$(launchd_pid)"
    if [[ -n "$job_pid" ]] && pid_alive "$job_pid"; then
      echo "$job_pid" >"$PID_FILE"
      echo "Branch sync: already running (pid $job_pid)"
      return 0
    fi
  fi

  local existing_pid
  existing_pid="$(read_pid || true)"
  if [[ -n "$existing_pid" ]] && pid_alive "$existing_pid"; then
    echo "Branch sync: already running (pid $existing_pid)"
    return 0
  fi

  local pid
  if use_launchd; then
    if launchd_loaded; then
      remove_launchd_job
    fi
    : >"$LOG_FILE"

    if ! launchctl submit -l "$LAUNCHD_LABEL" -o "$LOG_FILE" -e "$LOG_FILE" -- \
      /usr/bin/env \
      "PATH=${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}" \
      "HOME=${HOME:-}" \
      "USER=${USER:-$(id -un)}" \
      "LOGNAME=${LOGNAME:-${USER:-$(id -un)}}" \
      /bin/bash -c 'cd "$1"; shift; exec "$@"' _ "$ROOT" \
      /usr/bin/env "BRANCH_SYNC_INTERVAL=$INTERVAL" "$ROOT/scripts/branch-sync.sh" _daemon; then
      echo "Branch sync: failed to start — see $LOG_FILE"
      tail -n 10 "$LOG_FILE" || true
      rm -f "$PID_FILE"
      return 1
    fi

    local current_pid candidate_pid="" stable_ticks=0 stable_pid=""
    for _ in {1..20}; do
      current_pid="$(launchd_pid)"
      if [[ -n "$current_pid" ]] && pid_alive "$current_pid"; then
        echo "$current_pid" >"$PID_FILE"
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
        rm -f "$PID_FILE"
      fi
      sleep 0.25
    done
    pid="$stable_pid"
  else
    : >"$LOG_FILE"
    nohup bash -c 'cd "$1"; shift; exec "$@"' _ "$ROOT" "$ROOT/scripts/branch-sync.sh" _daemon >>"$LOG_FILE" 2>&1 &
    pid=$!
    echo "$pid" >"$PID_FILE"
    disown "$pid" 2>/dev/null || true
    sleep 0.5
  fi

  if [[ -n "${pid:-}" ]] && pid_alive "$pid"; then
    echo "Branch sync: started (pid $pid, every ${INTERVAL}s)"
    echo "  Log: tail -f .dev-session/branch-sync.log"
  else
    echo "Branch sync: failed to start — see $LOG_FILE"
    tail -n 10 "$LOG_FILE" || true
    if use_launchd; then
      remove_launchd_job
    fi
    rm -f "$PID_FILE"
    return 1
  fi
}

cmd_stop() {
  local pid was_alive=0 removed_job=0
  pid="$(read_pid || true)"

  if use_launchd && launchd_loaded; then
    if [[ -z "$pid" ]]; then
      pid="$(launchd_pid)"
    fi
    if [[ -n "$pid" ]] && pid_alive "$pid"; then
      was_alive=1
    fi
    remove_launchd_job
    removed_job=1
  fi

  if [[ -z "$pid" ]]; then
    echo "Branch sync: not tracked"
    rm -f "$PID_FILE"
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
    echo "Branch sync: stopped (pid $pid)"
  elif [[ "$was_alive" -eq 1 || "$removed_job" -eq 1 ]]; then
    echo "Branch sync: stopped (pid $pid)"
  else
    echo "Branch sync: already stopped (stale pid $pid)"
  fi

  rm -f "$PID_FILE"
}

cmd_status() {
  local pid job_pid via_launchd=0

  if use_launchd; then
    job_pid="$(launchd_pid)"
    if [[ -n "$job_pid" ]] && pid_alive "$job_pid"; then
      echo "$job_pid" >"$PID_FILE"
      via_launchd=1
    fi
  fi

  pid="$(read_pid || true)"

  if [[ -n "$pid" ]] && pid_alive "$pid"; then
    local branch upstream
    branch="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '?')"
    upstream="$(git -C "$ROOT" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || echo 'none')"
    if [[ "$via_launchd" -eq 1 ]]; then
      echo "Branch sync: running (pid $pid, every ${INTERVAL}s, via launchd)"
    else
      echo "Branch sync: running (pid $pid, every ${INTERVAL}s)"
    fi
    echo "  Branch: $branch → $upstream"
    echo "  Log: tail -f .dev-session/branch-sync.log"
  else
    echo "Branch sync: stopped"
  fi
}

usage() {
  cat <<EOF
Usage: $0 {start|stop|status|once}

  start   Start background poll loop (default: every ${INTERVAL}s)
  stop    Stop tracked branch-sync process
  status  Show whether sync is running
  once    Run a single fetch/pull cycle (foreground)

Env:
  BRANCH_SYNC_INTERVAL  Seconds between polls (default: 60)
EOF
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  once) sync_once ;;
  _daemon) daemon_loop ;;
  *) usage; exit 1 ;;
esac
