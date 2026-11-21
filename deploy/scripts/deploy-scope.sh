#!/usr/bin/env bash
# Prints which containers a deploy must recreate, given the changed file paths
# on stdin (one per line, e.g. from `git diff --name-only <deployed> <new>`):
#   web  - only the website changed; the trading engine keeps running
#   all  - anything else (engine, shared packages, Docker, lockfile, ...)
# An empty list or a read failure prints `all`: when in doubt, restart both.
#
# Paths below never reach the engine: the engine imports no app code but its
# own, and the rest are docs or other deploy targets.

set -euo pipefail

web_only='^(apps/web/|apps/mobile/|apps/relay/|apps/harness/|docs/|artifacts/|demos/|brandkit/|\.github/|[^/]+\.md$)'

changed=$(grep -v '^$' || true)
if [ -z "$changed" ]; then
  echo all
elif grep -qvE "$web_only" <<<"$changed"; then
  echo all
else
  echo web
fi
