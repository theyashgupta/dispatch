#!/bin/sh
# Shared in-container helpers for the scenario scripts (dev/ops tooling, not shipped and not test
# code). Sourced, never executed. POSIX sh only — the images have no bash guarantee.
#
# Two rules hold in every scenario script. Scripts are COPYed into the image and invoked as a static
# /opt/sim/<name>.sh argv, so no host value is ever interpolated into a container command (T-41-05).
# And the VERDICT is never decided here: these scripts only observe and print SIM_* tokens, so the
# host grades from data rather than from prose log-scraping, and a script that cannot run at all is
# the only reason for a non-zero exit.

SIM_PORT=4700
SIM_BASE="http://127.0.0.1:4700"
SIM_DISPATCH_DIR="$HOME/.dispatch"
SIM_DB="$HOME/.dispatch/board.db"

# GET a URL, printing "<status>\n<body-on-one-line>". Exit 1 when the server is unreachable, which
# is what the boot poll below treats as "not up yet". node -e with global fetch because
# node:*-bookworm-slim ships neither curl nor wget.
http_get() {
  node --no-warnings -e '
    fetch(process.argv[1])
      .then(async (r) => {
        const body = (await r.text()).replace(/[\r\n]+/g, " ");
        process.stdout.write(r.status + "\n" + body + "\n");
      })
      .catch(() => process.exit(1));
  ' "$1"
}

# Start dispatch in the background on a known port. Backgrounded rather than run in the foreground
# because a healthy boot never returns — it serves until killed.
boot_dispatch() {
  rm -f /tmp/boot.log
  dispatch --no-open --port "$SIM_PORT" > /tmp/boot.log 2>&1 &
  BOOT_PID=$!
}

# Wait for the boot to resolve one way or the other, bounded to ~20s: either /api/setup answers
# (SETUP_STATUS/SETUP_BODY set) or the process dies (BOOT_EXIT set to its code). BOOT_EXIT stays
# "running" when neither happened, so a hung boot fails its row on a token the host can read instead
# of burning the whole matrix timeout.
wait_for_boot() {
  SETUP_STATUS=none
  SETUP_BODY=
  BOOT_EXIT=running
  i=0
  while [ "$i" -lt 40 ]; do
    if http_get "$SIM_BASE/api/setup" > /tmp/setup.out 2>/dev/null; then
      SETUP_STATUS=$(sed -n 1p /tmp/setup.out)
      SETUP_BODY=$(sed -n 2p /tmp/setup.out)
      return 0
    fi
    if ! kill -0 "$BOOT_PID" 2>/dev/null; then
      wait "$BOOT_PID"
      BOOT_EXIT=$?
      return 0
    fi
    i=$((i + 1))
    sleep 0.5
  done
  return 0
}

stop_dispatch() {
  if kill -0 "$BOOT_PID" 2>/dev/null; then
    kill "$BOOT_PID" 2>/dev/null
    wait "$BOOT_PID" 2>/dev/null
  fi
}

# Boot once and stop, so the box holds a REAL store + footprint: board.db with the live schema,
# config.json, hook.sh, hook-settings.json. Seeding by hand would prove less — a fixture db is not
# the file the product actually writes.
seed_store() {
  boot_dispatch
  wait_for_boot
  stop_dispatch
}

# Snapshot board.db into a backup slot exactly as backupTick does: VACUUM INTO, never cp. A copy
# taken while a -wal sidecar exists is not guaranteed WAL-consistent, and a row that fails because
# its own fixture was subtly broken would be indistinguishable from a real classifier defect.
make_backup_slot() {
  node --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    db.prepare("VACUUM INTO ?").run(process.argv[2]);
    db.close();
  ' "$SIM_DB" "$1"
}

# Does a database open and pass PRAGMA integrity_check? Opened read-write on purpose: a read-only
# open of a WAL database needs a writable -shm, so the readOnly probe the product uses would report
# a false negative here after a killed boot left its sidecars behind.
db_opens_clean() {
  node --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    try {
      const db = new DatabaseSync(process.argv[1]);
      const row = db.prepare("PRAGMA integrity_check").get();
      db.close();
      process.exit(row && row.integrity_check === "ok" ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "$1"
}

yes_no() {
  if [ -e "$1" ]; then echo yes; else echo no; fi
}

dump_boot_log() {
  echo "--- boot log ---"
  cat /tmp/boot.log 2>/dev/null
  echo "--- end boot log ---"
}
