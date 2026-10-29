#!/usr/bin/env bash
# Commit engine work only — everything OUTSIDE the content surface.
#
# The content surface (src/content, media) is published straight to
# main from the dev save bar, so it must never ride along in a feature commit.
# See AGENTS.md → "Choose the delivery lane first".
#
#   bun run commit:engine "message"                  # every dirty engine file
#   bun run commit:engine "message" path/a path/b    # only these paths
#   bun run commit:engine --schema-migration "message" path/a path/b
#
# Prefer the second form. The first cannot tell your edits apart from anything
# else dirty in the tree — another agent's work, a half-finished experiment —
# and will commit all of it under your message.
#
# --schema-migration is the documented exception in AGENTS.md for a change
# that requires touching content JSON alongside the code that reads it. It
# only lifts the content-path refusal for THIS invocation — say so in the
# message, and pass explicit paths (never the no-paths sweep) alongside it.
set -euo pipefail

schema_migration=0
if [ "${1:-}" = "--schema-migration" ]; then
  schema_migration=1
  shift
fi

message="${1:-}"
if [ -z "$message" ]; then
  echo "usage: bun run commit:engine \"commit message\" [path ...]" >&2
  exit 1
fi
shift
paths=("$@")

cd "$(git rev-parse --show-toplevel)"

is_content_path() {
  if [ "$schema_migration" = "1" ]; then return 1; fi
  case "$1" in
    src/content|src/content/*|media|media/*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ ${#paths[@]} -gt 0 ]; then
  for path in "${paths[@]}"; do
    if is_content_path "$path"; then
      echo "Refusing: '$path' is content, not engine." >&2
      echo "Content publishes to main from the dev save bar — see AGENTS.md." >&2
      exit 1
    fi
  done
  if [ "$schema_migration" = "1" ]; then
    git add -f -- "${paths[@]}"
  else
    git add -- "${paths[@]}"
  fi
elif [ "$schema_migration" = "1" ]; then
  echo "usage: bun run commit:engine --schema-migration \"message\" path [path ...]" >&2
  echo "The no-paths sweep is refused under --schema-migration." >&2
  exit 1
else
  git add -- . ':!src/content' ':!media'
fi

if git diff --cached --quiet; then
  echo "No engine changes to commit." >&2
  exit 1
fi

staged="$(git diff --cached --name-only)"
staged_count="$(printf '%s\n' "$staged" | wc -l | tr -d ' ')"

echo "Staged (engine):"
printf '%s\n' "$staged" | sed 's/^/  /'

# The sweep can't distinguish your edits from anyone else's. Say so, rather
# than letting an unrelated file ride along unnoticed under your message.
if [ ${#paths[@]} -eq 0 ] && [ "$staged_count" -gt 0 ]; then
  echo
  echo "⚠️  Swept every dirty engine file — this is not scoped to your session."
  echo "    Check the list above. If anything is not yours, run:"
  echo "      git reset && bun run commit:engine \"$message\" <your paths>"
fi

held_back="$(git status --porcelain -- src/content media)"
if [ -n "$held_back" ]; then
  echo
  echo "Left alone (content — publish from the save bar):"
  echo "$held_back" | sed 's/^/  /'
fi

echo
git commit -m "$message"
