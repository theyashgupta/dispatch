#!/bin/sh
# This is a harness-only instrument: it is never installed, never placed on the
# developer's own PATH, and is only ever written into a sandbox bin directory that a
# test harness prepends to a CHILD process's PATH (never the parent shell's).
#
# Fakes `gh pr list` and `gh api rate_limit` so plans 98-07/98-08/98-09 can force every
# ProbeFailureCategory `gh.ts` classifies without a live GitHub or a real `gh` failure.
#
# Branching: on `$1 $2`.
#
#   pr list   Selects behaviour from GH_SHIM_MODE:
#     ok (default, also any unset/unknown mode): prints a JSON array of PR objects on
#       stdout (number, url, title, state, isDraft, statusCheckRollup), exit 0. Reads
#       GH_SHIM_PRS for a caller-supplied JSON array and echoes it verbatim when set,
#       else a one-element default array.
#     not-authenticated       : stderr "HTTP 401", exit 1
#     repo-not-accessible     : stderr "Could not resolve to a Repository", exit 1
#     pr-list-failed          : stderr an unrecognised message, exit 1
#     rate-limited            : stderr "API rate limit exceeded", exit 1
#     secondary-rate-limited  : stderr "secondary rate limit", exit 1
#
#   api rate_limit   Prints a rate-limit JSON body on stdout, exit 0. `remaining` comes
#     from GH_SHIM_REMAINING (default 10, deliberately under the breaker's 50
#     threshold), `reset` from GH_SHIM_RESET (default: now plus 60s). Both `core` and
#     `graphql` buckets carry the same numbers. When GH_SHIM_RATELIMIT_BODY=malformed,
#     stdout is not valid JSON (still exit 0), so a caller's breaker must refuse to
#     wedge on a parse failure rather than crash.
#
#   --version   Prints a fixed "gh version 2.98.0 (2026-08-20)" line, exit 0.
#
#   anything else   Exits 1 with a fixed stderr line naming the unhandled subcommand.
#
# GH_SHIM_DELAY_MS: when set and non-zero, sleeps that many milliseconds inside the
# `pr list` branch BEFORE producing output, letting a caller hold several invocations
# open at once to observe a concurrency cap.
#
# GH_SHIM_LOG: when set, appends (with >>, so ordering survives concurrent writers)
# exactly two lines per invocation to the named file: one on entry reading
# "start <subcommand-pair> <mode>", one immediately before exit reading
# "end <subcommand-pair> <mode>". A reader computes peak concurrency as the maximum
# running value of (starts seen minus ends seen) walking the file top to bottom, no
# clock or timestamp needed. The log NEVER carries $@, $PWD, or the --head value: a
# branch name or a repo path is exactly what the closed ProbeFailureCategory union
# exists to keep out of a record (T-98-01).
#
# Two categories this script cannot force, by design, because gh.ts discriminates them
# on `.code` being a string plus existsSync(repoPath), never on stderr text:
#   gh unavailable      : plant NO `gh` binary at all on the sandbox PATH.
#   repo path missing   : point a fixture repo's cwd at a nonexistent directory.

set -eu

SUB1="${1:-}"
SUB2="${2:-}"
MODE="${GH_SHIM_MODE:-ok}"
PAIR="$SUB1${SUB2:+ $SUB2}"

log_start() {
  if [ -n "${GH_SHIM_LOG:-}" ]; then
    printf 'start %s %s\n' "$PAIR" "$MODE" >> "$GH_SHIM_LOG"
  fi
}

log_end() {
  if [ -n "${GH_SHIM_LOG:-}" ]; then
    printf 'end %s %s\n' "$PAIR" "$MODE" >> "$GH_SHIM_LOG"
  fi
}

log_start

case "$SUB1" in
  --version)
    echo "gh version 2.98.0 (2026-08-20)"
    log_end
    exit 0
    ;;
  pr)
    if [ "$SUB2" != "list" ]; then
      echo "gh-shim-98: unhandled subcommand: $PAIR" >&2
      log_end
      exit 1
    fi
    if [ -n "${GH_SHIM_DELAY_MS:-}" ] && [ "${GH_SHIM_DELAY_MS:-0}" != "0" ]; then
      sleep "$(awk -v ms="$GH_SHIM_DELAY_MS" 'BEGIN { printf "%.3f", ms/1000 }')"
    fi
    case "$MODE" in
      not-authenticated)
        echo "HTTP 401" >&2
        log_end
        exit 1
        ;;
      repo-not-accessible)
        echo "Could not resolve to a Repository" >&2
        log_end
        exit 1
        ;;
      pr-list-failed)
        echo "gh: unexpected error talking to github.com" >&2
        log_end
        exit 1
        ;;
      rate-limited)
        echo "API rate limit exceeded" >&2
        log_end
        exit 1
        ;;
      secondary-rate-limited)
        echo "secondary rate limit" >&2
        log_end
        exit 1
        ;;
      *)
        if [ -n "${GH_SHIM_PRS:-}" ]; then
          printf '%s\n' "$GH_SHIM_PRS"
        else
          printf '[{"number":1,"url":"https://github.com/example/repo/pull/1","title":"stub pr","state":"OPEN","isDraft":false,"statusCheckRollup":[]}]\n'
        fi
        log_end
        exit 0
        ;;
    esac
    ;;
  api)
    if [ "$SUB2" != "rate_limit" ]; then
      echo "gh-shim-98: unhandled subcommand: $PAIR" >&2
      log_end
      exit 1
    fi
    REMAINING="${GH_SHIM_REMAINING:-10}"
    if [ -n "${GH_SHIM_RESET:-}" ]; then
      RESET="$GH_SHIM_RESET"
    else
      RESET=$(( $(date +%s) + 60 ))
    fi
    if [ "${GH_SHIM_RATELIMIT_BODY:-}" = "malformed" ]; then
      printf '{not valid json'
    else
      printf '{"resources":{"core":{"limit":5000,"used":4990,"remaining":%s,"reset":%s},"graphql":{"limit":5000,"used":4990,"remaining":%s,"reset":%s}}}\n' \
        "$REMAINING" "$RESET" "$REMAINING" "$RESET"
    fi
    log_end
    exit 0
    ;;
  *)
    echo "gh-shim-98: unhandled subcommand: $PAIR" >&2
    log_end
    exit 1
    ;;
esac
