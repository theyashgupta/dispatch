# g19-manual-run/group-18

Source folder: /Users/yash/dispatch-workspaces/GROUP-18 (slug `g18-orch-runtime`). Shape: a loop parked at a gate. Units 1 to 3 are `built, awaiting /ship`, Unit 4 is `not started` (the ledger says `pending`, and the engine file waits on a handoff with `session_id: handoff-pending`).

Copied at 2026-10-07T17:32:53Z (roadmap, ledger and engine file) and 2026-10-07T17:33:04Z (unit PRDs, state and attempts files). Every file was read with `cp` only, while the loop kept running, so the state is a snapshot.

Changes from the source:

- ROADMAP.md is stored as `unit-plan.md`. It is the full file (under 30 KB, so no section was dropped) with the text clean-up below.
- `.roadmap/g18-orch-runtime/progress.md` keeps the first line and the units table (four rows). The absolute path prefix of the first line was removed, so it reads `Roadmap: ROADMAP.md, slug ...`. Every other section of the ledger is dropped.
- `.claude/ralph-loop.local.md` is the real file. The front matter is unchanged. In the prompt body the absolute path prefix `/Users/yash/dispatch-workspaces/GROUP-18/` was removed.
- Each of the four PRDs holds only the title line, every `### Phase` heading line and the `- **Retry budget:**` line under each phase. Phase counts: 8, 10, 11 and 10. These PRDs have no default retry budget line before Phase 1.
- Unit 4 has no `state.md` and no `attempts.md` in the source, so the fixture has none for Unit 4. Units 1 to 3 keep the real `state.md` and `attempts.md` files.
- Text clean-up: no em dash was present. Four roadmap lines and one Unit 1 attempts line had a double hyphen in a command flag (the qa-subagent, full-subagent and production flags) and now have a single hyphen. The `---` fences of the engine front matter stay because the parser needs them.
- Names that git ignores are stored under neutral names: `dot-planning`, `dot-claude`, `dot-roadmap`, `unit-plan.md` and `state.gate-lines` stand for the real folder and file names, and the test helper maps them back at test time.
- No token, secret, email address, session transcript or path under the `.dispatch` data folder was copied.
