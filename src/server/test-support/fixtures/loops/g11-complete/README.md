# g11-complete

Source folder: /Users/yash/dispatch-workspaces/GROUP-11 (slug `g14-backend`).

Changes from the source:

- ROADMAP.md and `.roadmap/g14-backend/progress.md` are copied whole.
- `.claude/ralph-loop.local.md.done` is the real closed engine file, unchanged.
- The two PRDs hold only the title line and the `### Phase` headings.
- The Unit 1 `state.md`, the Unit 2 `state.md` and the Unit 2 `attempts.md` are the real files. Unit 1 has no `attempts.md`.
- Double hyphens in command line flags became single hyphens.
- Phase pass lines are stored as `state.gate-lines` and the test helper restores the real file name at test time.
- Names that git ignores are stored under neutral names: `dot-planning`, `dot-claude`, `dot-roadmap` and `unit-plan.md` stand for the real folder and file names, and the test helper maps them back at test time.
