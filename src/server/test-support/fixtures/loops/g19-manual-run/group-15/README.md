# g19-manual-run/group-15

Source folder: /Users/yash/dispatch-workspaces/GROUP-15 (slug `g15-accounts-connections`). Shape: a running loop. Units 1, 2 and 5 are `built, awaiting /ship`, Unit 3 is `in progress` (Phases 1 to 5, 7 and 8 passed, Phase 6 not passed) and Unit 4 is `not started`.

Copied at 2026-10-07T17:32:53Z (roadmap, ledger and engine file) and 2026-10-07T17:33:04Z (unit PRDs, state and attempts files). Every file was read with `cp` only, while the loop kept running, so the state is a snapshot.

Changes from the source:

- ROADMAP.md is stored as `unit-plan.md`. It is the full file (under 30 KB, so no section was dropped), unchanged: it had no em dash and no double hyphen.
- `.roadmap/g15-accounts-connections/progress.md` keeps the first line and the units table (five rows, six columns with `Current phase`). The absolute path prefix of the first line was removed, so it reads `Roadmap: ROADMAP.md, slug g15-accounts-connections`. Every other section of the ledger is dropped.
- `.claude/ralph-loop.local.md` is the real file. The front matter is unchanged (`session_id: awaiting-input`). In the prompt body the absolute path prefixes `/Users/yash/dispatch-workspaces/GROUP-15/` were removed.
- Each of the five PRDs holds only the title line, every `### Phase` heading line and the `- **Retry budget:**` line under each phase. The default retry budget line before Phase 1 is dropped because it is not under a phase. Phase counts: 9, 9, 9, 9 and 5.
- Unit 4 has no `state.md` and no `attempts.md` in the source, and Unit 5 has no `attempts.md`, so the fixture has none of those files.
- The other `state.md` and `attempts.md` files are the real files, unchanged. Some attempts lines start with `- 2026-10-06` and are not RED attempt lines the parser counts; they stay as they are.
- Text clean-up: no em dash and no double hyphen was present in the copied files. The `---` fences of the engine front matter stay because the parser needs them.
- Names that git ignores are stored under neutral names: `dot-planning`, `dot-claude`, `dot-roadmap`, `unit-plan.md` and `state.gate-lines` stand for the real folder and file names, and the test helper maps them back at test time.
- No token, secret, email address, session transcript or path under the `.dispatch` data folder was copied.
