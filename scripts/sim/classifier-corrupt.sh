#!/bin/sh
# SIM-04, positive direction: a GENUINELY corrupt board.db is quarantined and recovered from the
# newest clean backup slot, and boot still reaches the setup screen (recovery is transparent, not a
# crash — STORE-04's DoS mitigation).
#
# The fixture is a whole-file garbage overwrite, never a single byte-flip: garbage/zeroed-header
# reliably yields NOTADB(26), while a flipped byte often lands somewhere SQLite never reads and the
# row would then prove nothing while looking green.
set -u
. /opt/sim/lib.sh

seed_store
make_backup_slot "$SIM_DB.bak.1"

# The sidecars belong to the db this fixture is about to destroy; leaving a WAL from the seed boot
# beside a garbage primary would make the open failure ambiguous.
rm -f "$SIM_DB-wal" "$SIM_DB-shm"
head -c 8192 /dev/urandom > "$SIM_DB"

boot_dispatch
wait_for_boot
stop_dispatch

DB_OPENS_CLEAN=no
if db_opens_clean "$SIM_DB"; then DB_OPENS_CLEAN=yes; fi

echo "SIM_SETUP_STATUS=$SETUP_STATUS"
echo "SIM_CORRUPT_MARKER=$(yes_no "$SIM_DB.corrupt")"
echo "SIM_BAK1_EXISTS=$(yes_no "$SIM_DB.bak.1")"
echo "SIM_DB_OPENS_CLEAN=$DB_OPENS_CLEAN"
dump_boot_log
