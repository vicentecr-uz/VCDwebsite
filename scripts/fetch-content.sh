#!/usr/bin/env bash
set -euo pipefail
root=$(git rev-parse --show-toplevel)
source_mode=${CONTENT_SOURCE:-repo}
replace=0
if [[ ${1:-} == --replace ]]; then replace=1; shift; fi
if [[ $# -gt 0 ]]; then echo "usage: CONTENT_SOURCE=sample|repo $0 [--replace]" >&2; exit 2; fi
case "$root" in /|"$HOME"|$HOME/Developer/VCDwebsite) echo "refusing unsafe destination: $root" >&2; exit 2;; esac
if [[ "$root" != / && -L "$root" ]]; then echo "refusing symlink destination: $root" >&2; exit 2; fi
for parent in "$root/src" "$root/public"; do
  [[ ! -L "$parent" ]] || { echo "refusing symlink destination: $parent" >&2; exit 2; }
done
for existing in "$root/src/content" "$root/media" "$root/public/images" "$root/public/videos"; do
  [[ ! -L "$existing" ]] || { echo "refusing symlink destination: $existing" >&2; exit 2; }
done
tmp=$(mktemp -d "${TMPDIR:-/tmp}/vcd-content.XXXXXX"); trap 'rm -rf "$tmp"' EXIT
stage="$tmp/stage"; mkdir -p "$stage"
if [[ "$source_mode" == sample ]]; then
  cp -R "$(cd "$(dirname "$0")/../sample-content" && pwd)/." "$stage/"
elif [[ "$source_mode" == repo ]]; then
  repo=${CONTENT_REPO:-https://github.com/vicentecr-uz/vcd-content.git}
  if [[ "$repo" =~ ^https://[^/]*@ || ! "$repo" =~ ^(https://github\.com/|/|\.) ]]; then echo "CONTENT_REPO must be a GitHub URL or local path without userinfo" >&2; exit 2; fi
  if [[ -n ${CONTENT_TOKEN:-} && "$repo" == https://* ]]; then
    [[ "$repo" == https://github.com/* ]] || { echo "CONTENT_TOKEN is only allowed for github.com" >&2; exit 2; }
    token_b64=$(printf 'x-access-token:%s' "$CONTENT_TOKEN" | base64 | tr -d '\n')
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0="Authorization: Basic $token_b64" git clone --quiet --depth 1 "$repo" "$tmp/repo"
  else git clone --quiet --depth 1 "$repo" "$tmp/repo"; fi
  cp -R "$tmp/repo/." "$stage/"
else echo "unsupported CONTENT_SOURCE: $source_mode" >&2; exit 2; fi
if find "$stage" -type l -print -quit | grep -q .; then echo "content source contains symlinks; refusing" >&2; exit 1; fi
for required in src/content/projects src/content/pages src/content/settings media; do
  [[ -d "$stage/$required" ]] || { echo "content source missing $required" >&2; exit 1; }
done
[[ -f "$stage/src/content/settings/header.json" ]] || { echo "content source missing header settings" >&2; exit 1; }
python3 - "$stage/src/content/settings/header.json" "$stage/src/content/settings/schema.json" <<'PY'
import json, sys
if not isinstance(json.load(open(sys.argv[1])), dict): raise SystemExit('header settings must be an object')
if len(sys.argv) > 2:
    import os
    marker = sys.argv[2]
    if os.path.exists(marker):
        version = json.load(open(marker)).get('schemaVersion')
        if type(version) is not int or version != 1: raise SystemExit('unsupported content schemaVersion')
PY
for path in src/content media public/images public/videos; do
  if [[ -e "$root/$path" && $replace -eq 0 ]]; then echo "destination already contains $path; pass --replace in an isolated checkout" >&2; exit 1; fi
done
for path in src/content media public/images public/videos; do
  [[ $replace -eq 1 ]] && rm -rf "$root/$path"
  [[ -e "$stage/$path" ]] || continue
  mkdir -p "$root/$(dirname "$path")"
  cp -R "$stage/$path" "$root/$(dirname "$path")/"
done
