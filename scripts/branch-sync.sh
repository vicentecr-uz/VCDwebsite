#!/usr/bin/env bash
# Poll origin and pull the currently checked-out branch (pull-only — no auto-commit).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_DIR="$ROOT/.dev-session"
PID_FILE="$SESSION_DIR/branch-sync.pid"
LOG_FILE="$SESSION_DIR/branch-sync.log"
REQUEST_FILE="$SESSION_DIR/branch-sync.request"
STATUS_FILE="$SESSION_DIR/branch-sync.status"
LAUNCHD_LABEL="com.vcruzdesigns.vcdwebsite.branch-sync"

INTERVAL="${BRANCH_SYNC_INTERVAL:-60}"
DAEMON_MODE="${BRANCH_SYNC_DAEMON:-0}"
STATE_URL="${BRANCH_SYNC_STATE_URL:-http://127.0.0.1:4321/api/dev-session-state}"
SESSION_SCRIPT="${BRANCH_SYNC_SESSION_SCRIPT:-$ROOT/scripts/dev-session.sh}"
BUN="${BRANCH_SYNC_BUN:-$HOME/.bun/bin/bun}"

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

write_update_status() {
  [[ -n "$request_id" ]] || return 0
  if [[ "$1" == succeeded || "$1" == failed ]]; then request_finished=1; fi
  "$BUN" -e 'const [file,id,state,message]=process.argv.slice(1); const fs=require("node:fs"); fs.writeFileSync(file+".tmp", JSON.stringify({id,state,message})+"\n"); fs.renameSync(file+".tmp",file);' "$STATUS_FILE" "$request_id" "$1" "$2"
}

sync_once() (
  mkdir -p "$SESSION_DIR"
  local request_finished=0
  local lock="$SESSION_DIR/branch-sync.lock" request_id="" active_request="$SESSION_DIR/branch-sync.active"
  if ! mkdir "$lock" 2>/dev/null; then
    echo "Update already running."
    return 0
  fi
  trap 'if [[ -n "$request_id" && "$request_finished" -eq 0 ]]; then write_update_status failed "Update interrupted. Check the sync log before retrying."; fi; rmdir "$lock" 2>/dev/null || true' EXIT
  if [[ -f "$REQUEST_FILE" ]]; then
    mv "$REQUEST_FILE" "$active_request"
    request_id="$("$BUN" -e 'try { console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).id || "") } catch {}' "$active_request")"
    rm -f "$active_request"
    write_update_status running "Updating…"
  fi
  local branch upstream behind incoming_paths dependencies_changed=0 astro_stopped=0
  local failure="" result=0
  branch="$(git -C "$ROOT" branch --show-current)"
  if [[ -z "$branch" ]] || ! upstream="$(git -C "$ROOT" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)"; then
    write_update_status failed "The checkout has no active upstream branch."
    return 1
  fi
  if [[ "${VCD_REVIEW_PREVIEW:-0}" == 1 || -e "$SESSION_DIR/content-snapshot.json" ]]; then
    write_update_status failed "Updates are unavailable in a review preview."
    return 1
  fi
  if [[ -L "$ROOT/.content.git" || ( -e "$ROOT/.content.git" && ! -d "$ROOT/.content.git" ) ]]; then
    write_update_status failed "The content repository is invalid. Your files are unchanged."
    return 1
  fi
  local content_repo=0 content_branch="" content_behind=0 content_main=""
  if [[ -d "$ROOT/.content.git" && ! -L "$ROOT/.content.git" ]]; then
    content_repo=1
    content_branch="$(git --git-dir="$ROOT/.content.git" --work-tree="$ROOT" branch --show-current 2>/dev/null || true)"
    if [[ "$content_branch" != main ]] || ! content_main="$(git --git-dir="$ROOT/.content.git" --work-tree="$ROOT" rev-parse --verify origin/main 2>/dev/null)"; then
      write_update_status failed "The content checkout is not ready on main."
      return 1
    fi
  fi
  if ! git -C "$ROOT" fetch origin "$branch" 2>&1; then
    write_update_status failed "Could not fetch the update. Your files are unchanged."
    return 1
  fi
  if [[ "$content_repo" -eq 1 ]] && ! git --git-dir="$ROOT/.content.git" --work-tree="$ROOT" fetch origin main 2>&1; then
    write_update_status failed "Could not fetch the content update. Your files are unchanged."
    return 1
  fi
  behind="$(git -C "$ROOT" rev-list --count HEAD.."$upstream")"
  if [[ "$content_repo" -eq 1 ]]; then
    content_behind="$(git --git-dir="$ROOT/.content.git" --work-tree="$ROOT" rev-list --count HEAD..origin/main)"
  fi
  if [[ "$behind" -eq 0 && "$content_behind" -eq 0 ]]; then
    echo "$branch up to date ($upstream)"
    write_update_status succeeded "Already up to date."
    return 0
  fi
  incoming_paths="$(git -C "$ROOT" diff --name-only "$(git -C "$ROOT" merge-base HEAD "$upstream")" "$upstream")"
  if grep -Eq '^(package.json|bun.lock|bun.lockb)$' <<<"$incoming_paths"; then dependencies_changed=1; fi
  if astro_running; then
    local state
    if ! state="$(curl --silent --show-error --fail --max-time 2 "$STATE_URL" 2>/dev/null)" || [[ "$state" != '{"editing":false,"clients":0}' ]]; then
      echo "Update deferred (authoring session active or state unavailable)."
      write_update_status failed "Another Edit tab is active or the editor is unavailable. Try again after closing Edit mode."
      return 0
    fi
    # Lease checks precede shutdown; stopping Astro prevents writes during draft restoration.
    if ! bash "$SESSION_SCRIPT" stop-astro; then
      write_update_status failed "Could not stop the dev server. Your files are unchanged."
      return 1
    fi
    astro_stopped=1
  fi

  if ! "$BUN" "$ROOT/scripts/branch-sync-drafts.mjs" "$ROOT" "$upstream"; then
    failure="Update cancelled. See the recovery details in the sync log."
    if [[ -f "$SESSION_DIR/branch-sync.error" ]]; then failure="$(cat "$SESSION_DIR/branch-sync.error")"; fi
    result=1
  elif [[ "$dependencies_changed" -eq 1 ]] && ! "$BUN" install --frozen-lockfile --cwd "$ROOT"; then
    failure="Files were updated and drafts restored, but dependency installation failed."
    result=1
  fi
  if [[ "$astro_stopped" -eq 1 ]]; then
    if ! bash "$SESSION_SCRIPT" start-astro; then
      failure="${failure:+$failure }Could not restart the dev server."
      result=1
    else
      local ready=0 attempt
      for attempt in {1..100}; do
        if curl --silent --fail --max-time 1 "$STATE_URL" >/dev/null; then ready=1; break; fi
        sleep 0.2
      done
      if [[ "$ready" -eq 0 ]]; then
        failure="${failure:+$failure }The dev server did not become ready."
        result=1
      fi
    fi
  fi
  if [[ "$result" -ne 0 ]]; then
    write_update_status failed "$failure"
    echo "$failure"
    return 1
  fi
  write_update_status succeeded "Update complete."
)

astro_running() {
  bash "$SESSION_SCRIPT" astro-running >/dev/null 2>&1
}

daemon_loop() {
  DAEMON_MODE=1
  mkdir -p "$SESSION_DIR"
  echo "$(date '+%Y-%m-%d %H:%M:%S') branch sync started (interval ${INTERVAL}s, pid $$)" >>"$LOG_FILE"
  local script_revision
  script_revision="$(git hash-object "$ROOT/scripts/branch-sync.sh")"
  while true; do
    bash "$ROOT/scripts/branch-sync.sh" once >>"$LOG_FILE" 2>&1 || true
    if [[ "$(git hash-object "$ROOT/scripts/branch-sync.sh")" != "$script_revision" ]]; then
      exec env BRANCH_SYNC_DAEMON=1 BRANCH_SYNC_INTERVAL="$INTERVAL" "$ROOT/scripts/branch-sync.sh" _daemon
    fi
    local elapsed=0
    while [[ "$elapsed" -lt "$INTERVAL" ]]; do
      if [[ -f "$REQUEST_FILE" ]]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') manual sync requested" >>"$LOG_FILE"
        break
      fi
      sleep 1
      elapsed=$((elapsed + 1))
    done
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
