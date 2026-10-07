# g14-missing-state

Source folder: g14-partial in this folder, itself copied from /Users/yash/dispatch-workspaces/GROUP-14.

Changes from g14-partial:

- The Unit 2 `state.md` is removed. The Unit 2 `attempts.md` stays, so phase 2 reads as `fail` with one attempt and every other Unit 2 phase reads as `pending`.
- This README replaces the g14-partial README.
- Phase pass lines are stored as `state.gate-lines` and the test helper restores the real file name at test time.
- Names that git ignores are stored under neutral names: `dot-planning`, `dot-claude`, `dot-roadmap` and `unit-plan.md` stand for the real folder and file names, and the test helper maps them back at test time.
