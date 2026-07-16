#!/bin/sh
# SIM-04, negative direction — the row this milestone exists for. v1.7 destroyed a user's board by
# treating a non-corruption open failure as corruption; this proves it cannot happen again: an
# unreadable board.db must fail LOUD, quarantine nothing, and leave the primary and every backup
# byte-for-byte identical (SAFE-02/SAFE-03).
#
# This script is only valid when it runs as a NON-ROOT user. Root ignores chmod 000, so the open
# would silently succeed and the row would pass for the wrong reason — the exact false green that
# would hide the bug this exists to catch. The host runs it with --user node -e HOME=/home/node.
set -u
. /opt/sim/lib.sh

seed_store
make_backup_slot "$SIM_DB.bak.1"
rm -f "$SIM_DB-wal" "$SIM_DB-shm"

echo "SIM_WHOAMI=$(id -u)"
echo "SIM_DB_SHA_BEFORE=$(sha256sum "$SIM_DB" | cut -d' ' -f1)"
echo "SIM_BAK_SHA_BEFORE=$(sha256sum "$SIM_DB.bak.1" | cut -d' ' -f1)"

chmod 000 "$SIM_DB"
boot_dispatch
wait_for_boot
stop_dispatch

echo "SIM_BOOT_EXIT=$BOOT_EXIT"
echo "SIM_SETUP_STATUS=$SETUP_STATUS"
echo "SIM_CORRUPT_MARKER=$(yes_no "$SIM_DB.corrupt")"
echo "SIM_DB_EXISTS=$(yes_no "$SIM_DB")"

# Restoring readability to hash the file does not alter its contents — the digest below is of the
# same bytes the denied boot saw.
chmod 600 "$SIM_DB"
echo "SIM_DB_SHA_AFTER=$(sha256sum "$SIM_DB" | cut -d' ' -f1)"
echo "SIM_BAK_SHA_AFTER=$(sha256sum "$SIM_DB.bak.1" | cut -d' ' -f1)"
dump_boot_log
