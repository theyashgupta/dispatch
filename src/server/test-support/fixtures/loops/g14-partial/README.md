# g14-partial

Source folder: /Users/yash/dispatch-workspaces/GROUP-14 (slug `g13-modules-b`).

Changes from the source:

- ROADMAP.md keeps the title and the slug line, drops every other section, and holds three units. Unit 1 is the real Unit 1 block with status `built, awaiting /ship`. Unit 2 is the real Unit 4 block renamed `### Unit 2` with status `in progress` and the PRD path `dispatch/.planning/prds/g13-modules-b-unit-2.md`. Unit 3 is the real Unit 3 block with status `not started` and the PRD path unchanged.
- `.roadmap/g13-modules-b/progress.md` keeps the real first line and the real table header, drops the other sections, and has three rows: Unit 1 `committed 27c26d4`, Unit 2 `in progress` on the real Unit 4 branch, Unit 3 `pending` on the real Unit 3 branch.
- `.claude/ralph-loop.local.md` is the real file, unchanged.
- The three PRDs hold only the title line and the `### Phase` headings. The Unit 2 PRD is the real Unit 4 PRD (9 phases), and its title still says Unit 4.
- The Unit 1 `state.md` and `attempts.md` are the real files, unchanged.
- The Unit 2 `state.md` has four invented pass lines for phases 1 to 4, and the Unit 2 `attempts.md` has one invented RED line for phase 2.
- There is no Unit 3 phase folder.
- Double hyphens in command line flags became single hyphens. The `---` fences of the engine front matter stay because the parser needs them.
- Phase pass lines are stored as `state.gate-lines` and the test helper restores the real file name at test time.
- Names that git ignores are stored under neutral names: `dot-planning`, `dot-claude`, `dot-roadmap` and `unit-plan.md` stand for the real folder and file names, and the test helper maps them back at test time.
