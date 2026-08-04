#!/usr/bin/env bash
# Commit engine work only — everything OUTSIDE the content surface.
#
# The content surface (src/content, public/images) is published straight to
# main from the dev save bar, so it must never ride along in a feature commit.
# See CLAUDE.md → "Content vs engine".
set -euo pipefail

message="${1:-}"
if [ -z "$message" ]; then
  echo "usage: bun run commit:engine \"commit message\"" >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

git add -- . ':!src/content' ':!public/images'

if git diff --cached --quiet; then
  echo "No engine changes to commit." >&2
  exit 1
fi

echo "Staged (engine):"
git diff --cached --name-only | sed 's/^/  /'

held_back="$(git status --porcelain -- src/content public/images)"
if [ -n "$held_back" ]; then
  echo
  echo "Left alone (content — publish from the save bar):"
  echo "$held_back" | sed 's/^/  /'
fi

echo
git commit -m "$message"
