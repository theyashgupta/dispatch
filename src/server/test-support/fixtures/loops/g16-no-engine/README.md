# g16-no-engine

Source folder: /Users/yash/dispatch-workspaces/GROUP-16 (slug `g16-orch-design`).

Changes from the source:

- ROADMAP.md and `.roadmap/g16-orch-design/progress.md` are copied whole.
- The two PRDs hold only the title line and the `### Phase` headings.
- The Unit 1 and Unit 2 `state.md` and `attempts.md` files are the real files.
- There is no `.claude` folder, so the engine is absent.
- Double hyphens in command line flags and in table separator rows became single hyphens.
- Phase pass lines are stored as `state.gate-lines` and the test helper restores the real file name at test time.
- Names that git ignores are stored under neutral names: `dot-planning`, `dot-claude`, `dot-roadmap` and `unit-plan.md` stand for the real folder and file names, and the test helper maps them back at test time.
