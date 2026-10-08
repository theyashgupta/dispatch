phase 2 RED attempt 1 2026-10-07T01:43:29Z (R-9 args spoof in tool_call record)
phase 3 RED attempt 1 2026-10-07T02:16:08Z (orchestrator-read-route.test.ts loaded the store before isolateEnv and wrote the live ~/.dispatch/board.db; fixed with a dynamic import)
phase 5 RED attempt 1 2026-10-07T03:38:11Z (R-20 stop_session overwrote usage_stop so resume_loop resumed a user stop; R-17 approve_roadmap missing the user stop refusal; P-R-25 parallel resume_loop not serialized)
phase 6 RED attempt 1 2026-10-07T04:39:05Z (R-22/R-23/G-12: an aborted wait records result null, not client-closed; tool() close listener records before the handler marks the call)
phase 9 RED attempt 1 2026-10-07T07:14:04Z (docs: add_comment 400 not producible, card id shared rule false for 4 fields, ARCHITECTURE says mcp-server.ts reads the env)
phase 11 RED attempt 1 2026-10-07T11:10:24Z gate full check: supervisor-actions.test.ts dangerous delete case timed out in keysSettled (3 s wait) under the parallel run; passes 3 of 3 alone; timing flake, one-line fix: wait 8 s
phase 11 RED attempt 2 2026-10-07T11:19:11Z gate full check: supervisor-limit.test.ts stop case read supervisor_gave_up (confirm timed out) under the parallel run at load average 11; passes 3 of 3 alone; timing flake (Unit 2 tmux test), no code change
