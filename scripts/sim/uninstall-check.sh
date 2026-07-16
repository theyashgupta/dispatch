#!/bin/sh
# SIM-05: `dispatch uninstall --yes` leaves a clean box — its own footprint gone, the user's board
# data kept, and a second run a harmless no-op.
#
# The footprint is seeded by BOOTING the real app rather than by touching files: config.json, hook.sh
# and hook-settings.json are then the exact artifacts the product writes, and SIM_FOOTPRINT_BEFORE
# proves there was something to remove — "footprint gone" on a box where it never existed is the
# emptiest false green available here.
set -u
. /opt/sim/lib.sh

footprint_list() {
  out=
  for f in config.json hook.sh hook-settings.json; do
    if [ -e "$SIM_DISPATCH_DIR/$f" ]; then out="$out $f"; fi
  done
  if [ -z "$out" ]; then echo none; else echo "${out# }"; fi
}

# Read the "Removed N file(s)" count out of ONE run's own log, before the two logs are concatenated.
# Per-run tokens are the point: the host greps the combined transcript, so a substring check for
# "Removed 3" and "Removed 0" cannot tell the correct run order from a regression that swapped them.
# "none" on no match, so a reworded product line fails the row loudly instead of matching absence.
removed_count() {
  line=$(grep -o 'Removed [0-9]* file(s)' "$1" 2> /dev/null | head -n 1)
  if [ -z "$line" ]; then
    echo none
  else
    echo "$line" | sed 's/^Removed \([0-9]*\) file(s)$/\1/'
  fi
}

seed_store
make_backup_slot "$SIM_DB.bak.1"

echo "SIM_FOOTPRINT_BEFORE=$(footprint_list)"

dispatch uninstall --yes > /tmp/uninstall1.log 2>&1
UNINSTALL_EXIT=$?

echo "SIM_UNINSTALL_EXIT=$UNINSTALL_EXIT"
echo "SIM_REMOVED_1=$(removed_count /tmp/uninstall1.log)"
echo "SIM_FOOTPRINT_AFTER=$(footprint_list)"
echo "SIM_BOARD_DB_EXISTS=$(yes_no "$SIM_DB")"
echo "SIM_BAK1_EXISTS=$(yes_no "$SIM_DB.bak.1")"
echo "SIM_DISPATCH_DIR_EXISTS=$(yes_no "$SIM_DISPATCH_DIR")"

dispatch uninstall --yes > /tmp/uninstall2.log 2>&1
SECOND_EXIT=$?
echo "SIM_SECOND_RUN_EXIT=$SECOND_EXIT"
echo "SIM_REMOVED_2=$(removed_count /tmp/uninstall2.log)"

echo "--- uninstall run 1 ---"
cat /tmp/uninstall1.log
echo "--- uninstall run 2 ---"
cat /tmp/uninstall2.log
echo "--- end uninstall output ---"
