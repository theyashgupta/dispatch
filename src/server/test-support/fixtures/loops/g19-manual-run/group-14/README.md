# g19-manual-run/group-14

Source folder: /Users/yash/dispatch-workspaces/GROUP-14 (slug `g13-modules-b`). Shape: a shipped loop. All four roadmap units say `built, awaiting /ship` and the ledger says `committed` for each.

Copied at 2026-10-07T17:32:53Z (roadmap, ledger and engine file) and 2026-10-07T17:33:04Z (unit PRDs, state and attempts files). Every file was read with `cp` only. The source has no live engine file, so the state is a snapshot of a closed loop.

Changes from the source:

- ROADMAP.md is stored as `unit-plan.md`. It is the full file (under 30 KB, so no section was dropped) with the text clean-up below.
- `.roadmap/g13-modules-b/progress.md` keeps the first line and the units table (four rows). The absolute path prefix of the first line was removed, so it reads `Roadmap: ROADMAP.md, slug ...`. Every other section of the ledger is dropped.
- `.claude/ralph-loop.local.md` does not exist in the source. The source holds only `ralph-loop.local.md.done`, so the fixture holds `dot-claude/ralph-loop.local.md.done` and the reader reads it as a closed engine. The front matter is unchanged. In the prompt body the absolute path prefix `/Users/yash/dispatch-workspaces/GROUP-14/` was removed.
- Each of the four PRDs holds only the title line, every `### Phase` heading line and the `- **Retry budget:**` line under each phase. The default retry budget line before Phase 1 is dropped because it is not under a phase. Phase counts: 12, 7, 8 and 9.
- The `state.md` and `attempts.md` files of all four units are the real files with the text clean-up below.
- Text clean-up: no em dash was present. Seven roadmap lines had a double hyphen in a command flag (the full-subagent, qa-subagent, is-ancestor and production flags) and now have a single hyphen. The `---` fences of the engine front matter stay because the parser needs them.
- Names that git ignores are stored under neutral names: `dot-planning`, `dot-claude`, `dot-roadmap`, `unit-plan.md` and `state.gate-lines` stand for the real folder and file names, and the test helper maps them back at test time.
- No token, secret, email address, session transcript or path under the `.dispatch` data folder was copied.
