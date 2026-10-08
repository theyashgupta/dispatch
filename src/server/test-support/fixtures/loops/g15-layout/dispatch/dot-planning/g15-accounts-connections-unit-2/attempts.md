- 2026-10-06 unit-2 phase 2 attempt 1 RED (QA R4): wrong-typed stored setting became live after an update (updater merged the raw disk block). Fixed: merge from the loaded, type filtered block; test added.
- 2026-10-06 unit-2 phase 2 gate attempt 1 RED: harness, fake-sandbox.sh kept the first port in config.json so the 48792 probe never answered; script now writes the port on each start and stop requires the pid to listen on the port.
phase 4 RED attempt 1 2026-10-06T01:35:06Z (QA: R8 a read between reset and return timer cancels the return; G5 stale limit surface after reset re-limits the account and blocks the exhausted continue; edge: continue decision uses plan-time turn)
phase 4 RED attempt 2 2026-10-06T02:25:01Z (gate harness: grep -q closed the pipe early, p4-reprobe.sh got SIGPIPE, exit 141 under pipefail; fixed to grep >/dev/null)
phase 7 RED attempt 1 2026-10-06T02:27:51Z (doc fact: exhausted re-check sentence wrong for autoMove false and for the in-use account selected; 13 WARN wording gaps)
phase 8 RED attempt 1 2026-10-06T03:32:32Z (doc recheck: study said Switch to usage does not match CREDITS_OPTION, stale since the Phase 4 regex change; fixed with 4 wording WARNs)
phase 8 RED attempt 2 2026-10-06T04:14:06Z (readiness BUG rows: reset failover feed text, U2-14 reason missing trigger and count, second failover in one busy turn strands a queued session)
phase 9 RED attempt 1 2026-10-06T13:31:04Z (REAL lane R05: harness collision, BE setup wiped the real workspace folder workspaces-p9)
phase 9 RED attempt 2 2026-10-06T13:33:14Z (BE batch 1 B16: an empty settings patch wrote claudeAccounts {} into config.json; fixed in updateClaudeAccountsSettings, R-28(3) known small fix)
