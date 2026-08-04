#!/usr/bin/env bash
# Commit engine work only — everything OUTSIDE the content surface.
#
# The content surface (src/content, public/images) is published straight to
# main from the dev save bar, so it must never ride along in a feature commit.
# See CLAUDE.md → "Content vs engine".
#
#   bun run commit:engine "message"                  # every dirty engine file
#   bun run commit:engine "message" path/a path/b    # only these paths
#
# Prefer the second form. The first cannot tell your edits apart from anything
# else dirty in the tree — another agent's work, a half-finished experiment —
# and will commit all of it under your message.
set -euo pipefail

message="${1:-}"
if [ -z "$message" ]; then
  echo "usage: bun run commit:engine \"commit message\" [path ...]" >&2
  exit 1
fi
shift
paths=("$@")

cd "$(git rev-parse --show-toplevel)"

is_content_path() {
  case "$1" in
    src/content|src/content/*|public/images|public/images/*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ ${#paths[@]} -gt 0 ]; then
  for path in "${paths[@]}"; do
    if is_content_path "$path"; then
      echo "Refusing: '$path' is content, not engine." >&2
      echo "Content publishes to main from the dev save bar — see CLAUDE.md." >&2
      exit 1
    fi
  done
  git add -- "${paths[@]}"
else
  git add -- . ':!src/content' ':!public/images'
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

held_back="$(git status --porcelain -- src/content public/images)"
if [ -n "$held_back" ]; then
  echo
  echo "Left alone (content — publish from the save bar):"
  echo "$held_back" | sed 's/^/  /'
fi

echo
git commit -m "$message"
