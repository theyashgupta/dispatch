#!/bin/bash
# Serialises full checks across every worktree on this machine: one eslint plus
# tsc program in memory at a time instead of three. The lock is a mkdir under
# TMPDIR with the owner pid inside, so a crashed holder is detected and reclaimed.
# Usage: scripts/check-lock.sh <command...>
set -u
LOCK="${TMPDIR:-/tmp}/dispatch-check.lock"
WAIT_SECONDS=5400
waited=0
while ! mkdir "$LOCK" 2>/dev/null; do
  owner=$(cat "$LOCK/pid" 2>/dev/null || echo "")
  if [ -z "$owner" ] || ! kill -0 "$owner" 2>/dev/null; then
    rm -rf "$LOCK"
    continue
  fi
  if [ "$waited" -ge "$WAIT_SECONDS" ]; then
    echo "check-lock: gave up after ${WAIT_SECONDS}s waiting for pid $owner" >&2
    exit 75
  fi
  [ "$waited" -eq 0 ] && echo "check-lock: waiting for pid $owner ($LOCK)" >&2
  sleep 10
  waited=$((waited + 10))
done
echo $$ >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT INT TERM
"$@"
