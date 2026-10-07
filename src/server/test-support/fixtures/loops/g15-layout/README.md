# g15-layout

Source folder: /Users/yash/dispatch-workspaces/GROUP-15 (slug `g15-accounts-connections`).

Changes from the source:

- ROADMAP.md, `.roadmap/g15-accounts-connections/progress.md` and `.claude/ralph-loop.local.md` are copied whole.
- The five PRDs hold only the title line and the `### Phase` headings.
- The Unit 1 and Unit 2 `state.md` and `attempts.md` files are the real files.
- The progress table layout is `Unit | Ticket | Branch | Status | Current phase | Reopen rounds`.
- Phase pass lines are stored as `state.gate-lines` and the test helper restores the real file name at test time.
- Names that git ignores are stored under neutral names: `dot-planning`, `dot-claude`, `dot-roadmap` and `unit-plan.md` stand for the real folder and file names, and the test helper maps them back at test time.
