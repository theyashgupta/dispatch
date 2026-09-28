#!/bin/sh
# Harness-only: written into a sandbox bin directory on a child process's PATH, never installed.
# Answers `gh auth token` with a fake token so the GitHub source can run against
# scripts/fake-github.mjs; every other gh call fails.
if [ "$1 $2" = "auth token" ]; then echo "g5-fake-gh-$(printf token)"; exit 0; fi
exit 1
