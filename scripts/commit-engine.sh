#!/usr/bin/env bash
# Commit engine work only — everything OUTSIDE the content surface.
#
# The content surface (src/content, media) is published straight to
# main from the dev save bar, so it must never ride along in a feature commit.
# See AGENTS.md → "Choose the delivery lane first".
#
#   bun run commit:engine "message" path/a path/b    # only these paths
#
# Paths are mandatory. The public engine and private content repositories have
# separate delivery lanes, including for schema migrations.
set -euo pipefail

if [ "${1:-}" = "--schema-migration" ]; then
  echo "Refusing: schema migrations use coordinated engine and private-content commits; this helper cannot stage content." >&2
  exit 1
fi

message="${1:-}"
if [ -z "$message" ]; then
  echo "usage: bun run commit:engine \"commit message\" [path ...]" >&2
  exit 1
fi
shift
paths=("$@")

if [ ${#paths[@]} -eq 0 ]; then
  echo "usage: bun run commit:engine \"message\" path [path ...]" >&2
  echo "Explicit paths are required; the helper never sweeps the worktree." >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

is_private_path() {
  case "$1" in
    src/content|src/content/*|media|media/*|public/images|public/images/*|public/videos|public/videos/*|sitemap|sitemap/*|ops|ops/*|uploads|uploads/*|scripts/vps-agent.py|scripts/test/vps-agent.test.py|scripts/build-view.mjs|.github/workflows/content-deploy.yml) return 0 ;;
    *) return 1 ;;
  esac
}

if ! git diff --cached --quiet; then
  echo "Refusing: the index already contains staged changes. Commit only the explicit paths from this session." >&2
  git diff --cached --name-only | sed 's/^/  staged: /' >&2
  exit 1
fi

for path in "${paths[@]}"; do
  case "$path" in
    -*) echo "Refusing: paths beginning with '-' must be passed after '--'." >&2; exit 1 ;;
  esac
  if is_private_path "$path"; then
    echo "Refusing: '$path' is private content or operations material." >&2
    echo "Use the private content repository for content and schema migrations." >&2
    exit 1
  fi
done

git add -- "${paths[@]}"

staged_private="$(git diff --cached --name-only | while IFS= read -r path; do if is_private_path "$path"; then printf '%s\n' "$path"; fi; done)"
if [ -n "$staged_private" ]; then
  echo "Refusing: private paths entered the staged diff:" >&2
  printf '%s\n' "$staged_private" | sed 's/^/  /' >&2
  exit 1
fi

if git diff --cached --quiet; then
  echo "No engine changes to commit." >&2
  exit 1
fi

staged="$(git diff --cached --name-only)"
echo "Staged (engine):"
printf '%s\n' "$staged" | sed 's/^/  /'

echo
git commit -m "$message"
