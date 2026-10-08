phase 2 RED attempt 1 2026-10-05T19:03:40Z (gate: eslint require-await in session-account-move.test.ts after the control byte fix)
phase 4 RED attempt 1 2026-10-05T20:01:22Z (QA G9: an identity read with no orgId counted as an organisation change; fixed in compareIdentity)
phase 6 RED attempt 1 2026-10-05T20:50:43Z (UI audit RED 5/11: splash in 6 screenshots (harness), list bullets and gap, same account pending copy)
phase 6 RED attempt 2 2026-10-05T20:57:37Z (gate harness: re-probe grep -q on the JS bundle broke the pipe under pipefail; switched to grep -c)
- 2026-10-06 phase 7 attempt 1 RED (QA): G3/R3 two FALSE doc claims on limit surface keys (Escape on surface a; wait option chosen when no stop option). Fixed wording; WARN gaps C14, C35 also closed.
- 2026-10-06 phase 7 attempt 2 RED (QA r2): S1b step order (account refusal placed before same). Fixed with QA wording; extra round 1 under R-28(3).
- 2026-10-06 phase 8 gate attempt 1 RED: GATE ERROR surface ui with no screenshot/ui-case check (harness gap, R-26(2) WARN); line added.
- 2026-10-06 unit sweep attempt 1: phases 2 and 3 reopened by gate re-probe test-data drift (Phase 9 U12 restarted LOCAL-1 onto Default; the P2/P3 probes read LOCAL-1 on account 645afefe). Restored LOCAL-1 to 645afefe through POST /cards/LOCAL-1/session/account (200 moved). R-26(2) WARN, no code change.
