#!/bin/sh
# SIM-03: does a fresh install actually reach the setup screen on this box?
#
# "Reached the setup screen" is asserted as the real GET /api/setup JSON — not an HTTP 200 alone and
# not a log line — because that body carries the container's own Node version, which is what makes
# the Node 22 and Node 24 rows prove different things instead of the same thing twice.
set -u
. /opt/sim/lib.sh

boot_dispatch
wait_for_boot

HTML_STATUS=none
HTML_ROOT=no
HTML_TITLE=no
if [ "$SETUP_STATUS" != "none" ]; then
  if http_get "$SIM_BASE/" > /tmp/html.out 2>/dev/null; then
    HTML_STATUS=$(sed -n 1p /tmp/html.out)
    if grep -q 'id="root"' /tmp/html.out; then HTML_ROOT=yes; fi
    if grep -q '<title>Dispatch</title>' /tmp/html.out; then HTML_TITLE=yes; fi
  fi
fi

stop_dispatch

echo "SIM_SETUP_STATUS=$SETUP_STATUS"
echo "SIM_SETUP_BODY=$SETUP_BODY"
echo "SIM_HTML_STATUS=$HTML_STATUS"
echo "SIM_HTML_ROOT=$HTML_ROOT"
echo "SIM_HTML_TITLE=$HTML_TITLE"
echo "SIM_BOOT_EXIT=$BOOT_EXIT"
dump_boot_log
