# Orchestration Design Records

Status: accepted. Date: 2026-10-05. Ticket: LOCAL-83. Evidence: `docs/research/orchestration-research.md` (cited as "research" with a section, an action `A<n>` or a failure `F<n>`).

These records govern the tickets LOCAL-84 to LOCAL-93. A later ticket follows the record. A change to a record is a new dated entry in this file, not an edit of the old text.

## Key rules

- A board is one project: a key, a name, a workspace root, its repositories, its policy and its cards. There is no project level above a board (D-1).
- On a new board, a card id is `<KEY>-<n>`: `<KEY>` is the board key, and `<n>` comes from one counter per key. The default board keeps `LOCAL-n` for tickets and `GROUP-n` for groups (D-2).
- The supervisor restarts a stopped loop. The orchestrator does not restart a stopped loop. It calls `resume_loop` only for a loop that it stopped with `stop_session`, or for a loop that stays at `needs_input` after the supervisor tried once. Only the user resumes a loop that the `stop` usage policy or the budget stopped (D-3, D-4).
- The orchestrator sends input to a loop with the `send_input` tool. The tool calls an orchestrator route, and the route calls the one confirmed send function of the supervisor (D-4).
- Unit progress comes from the server reader of the loop files. A loop report only records a gate event and starts a new read (D-5).

## Glossary

- **Board:** one project. It has a key, a name, a workspace root, a list of repositories with a base branch each, a policy, its cards and its events (D-1).
- **Default board:** the board with the key `LOCAL`. The migration creates it and gives it every existing card, event and archive row.
- **Card:** a ticket or a group on one board. Its id is its identifier (D-2).
- **Group:** a card with `source` set to `group`. It has member tickets and one session that runs a loop.
- **Orchestrator:** a Claude session that belongs to one board. It makes judgment calls through tools. It writes no product code (D-3, D-9).
- **Supervisor:** deterministic server code. It watches each live session, detects typed states and does the actions that need no judgment (D-3).
- **Loop:** one group session that runs the Roadmap Loop playbook over a roadmap.
- **Unit:** one roadmap entry, usually one ticket. A unit has one PRD and one stacked branch.
- **Phase:** one numbered step of a unit PRD. A phase ends at a gate.
- **Gate:** a script result that marks a phase or a unit as passed. Only the gate script writes a pass line.
- **Policy:** the per-board settings that limit the orchestrator and the supervisor (D-6).
- **Decision item:** a question that the orchestrator raises for the user. It shows in the attention queue with options and a recommended option.

Term rule: in this codebase, "orchestration" also names the session start saga (`services/orchestration/`, the ARCHITECTURE section "Orchestration Saga"). The saga keeps its name. New text says "orchestrator" for the Claude session and "supervisor" for the server code. D-3 sets where the new code goes.

## Decision records

### D-1: Board model

**Date:** 2026-10-05

**Status:** accepted

**Decision:** A board is the project. No project level holds boards. A board row has these fields: `key` (also the board id, set at creation, never changed), `name`, `workspaceRoot`, `repositories` (each a path, a base branch and a check command, default `npm run check`, which the server runs with `NODE_ENV` unset as in SI:18), `linearTeamKeys` (optional), `lastUsedFolder`, `policy` (D-6), `orchestrators` (D-7), `createdAt`, `archived`. The default board takes its workspace root and repositories from the `Config` fields `workspaceRoot`, `repoPaths` and `baseBranches`, as today. So `Config` and `config.json` keep every field ("Do Not Change" contract items 1 and 4). An edit of the default board writes these `Config` fields. A new board stores these values on its own row. Cards, events and archive rows carry the board key. These stay global: Claude accounts, the vault, connections, the inbox sources and their items, playbooks, push subscriptions, and the settings that are not a board field. An inbox item has no board. When the user promotes an item, the new card goes to the selected board. The Inbox page shows the global items plus the Inbox-column cards of the selected board. The Linear poller puts a new card on the board whose `linearTeamKeys` holds the team key of the issue, else on the default board. The `Card` type and the `BoardSnapshot` gain the board key. That is a deliberate change of the "Do Not Change" contract item 1, and the ticket that makes it updates the contract text in the same change.

**Reason:** the manual run was one project per board in practice (each group payload had one `folder` and one `repos` entry, H25:96-104), and one level keeps every route, query key and URL to one scope parameter.

**Rejected:**

- A project that holds several boards: no action of the manual run needs two boards in one project (research section 3.1), and it adds a second scope to each route.
- Boards as a tag filter on one board: a tag cannot own a workspace root, a policy or a concurrency cap.
- An opaque board id beside the key: the key is unique and fixed, so a second id only adds a mapping.
- Accounts, vault or connections per board: one person owns them for the whole machine, and a copy per board splits secrets.
- A board id on inbox items: an item from Slack, Gmail or Calendar has no project until the user promotes it.

**Governs:** LOCAL-85, LOCAL-86, LOCAL-87, LOCAL-92

**Evidence:** research section 2 (no board id exists; Inbox rows are items plus Inbox-column cards, `web/features/inbox/InboxView.tsx:110` at the time, now `web/modules/inbox/`; the snapshot is a "Do Not Change" contract); the group payload at H25:96-104.

**Amendment, 2026-10-06 (LOCAL-84):** the `Config` fields `repoPaths` and `baseBranches` are retired today: the config loader drops them and logs that they are no longer used (`server/bootstrap/config.ts:360`, `:472-476`). So the default board reads `workspaceRoot` from `Config`, and its repositories from the workspace folders in the store (`workspaceFolders`, Settings, Workspaces), as today. The default board has no stored base branch: the start picks it, as today. Its check command is `npm run check`. An edit of the default board writes `workspaceRoot` to `Config` and the folder list to `workspaceFolders`. A new board stores these values on its own row, as above.

### D-2: Card identifiers

**Date:** 2026-10-05

**Status:** accepted

**Decision:** A card id is `<KEY>-<n>`. On a new board, tickets and groups take `<n>` from one counter for that key. The default board keeps `LOCAL-n` for tickets and `GROUP-n` for groups, with the counters of today. The counters stay in the one global counter map that is keyed by prefix (`identifierCounters`). A board key matches `^[A-Z][A-Z0-9]{1,5}$`. Board creation rejects a key that is `LOCAL`, `GROUP`, the key of another board, or a Linear team key that the store or the Linear team list knows at that time. When a Linear team with an equal key appears later, the board shows a warning, and the poller skips each issue whose identifier is already a card id. The tmux session is `dsp-<id>`, the branch is `<id>`, the session folder is `<workspaceRoot of the board>/<id>`, and each worktree is `<session folder>/<repository folder name>` ("Do Not Change" contract item 8). A second session of a card is `<id>-<ordinal>`, as today. Group detection stays on `card.source`.

**Reason:** five validators accept only `^[A-Za-z0-9]+-\d+$`, and the second session appends `-<ordinal>`, so one hyphen before the number keeps every id, tmux name, branch and folder valid with no validator change.

**Rejected:**

- `<KEY>-GROUP-n` for groups: it fails the five validators and collides with the `-<ordinal>` suffix of a second session.
- `LOCAL-n` and `GROUP-n` on every board: the id must show the board in tmux lists, branch names and PR titles across repositories.
- A counter row per board: the prefix map already keeps ids unique, because each key is unique.
- Random ids such as UUIDs: they fail the validators and a person cannot read them.

**Governs:** LOCAL-85, LOCAL-86, LOCAL-87

**Evidence:** research section 2 (validators at `server/services/orchestration/steps.ts:56`, `server/routes/cards.route.ts:253`, `:310`, `:344`, `server/services/orchestration/linear-sync.ts:26`; the counter map at `server/store/board-db.ts:78`; `sessionName` drives tmux, branch and folder at `server/services/orchestration/steps.ts:108-112`; group detection at `server/services/infra/kickoff.ts:257`).

### D-3: Supervisor and orchestrator duties

**Date:** 2026-10-05

**Status:** accepted

**Decision:** The supervisor owns each duty that needs no judgment. The orchestrator owns each duty that needs judgment. The supervisor restarts a stopped loop. The orchestrator never polls; it waits on events with the `wait_for_event` tool.

| Duty                                                | Owner        | Trigger and rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Watch each live session                             | Supervisor   | One watcher per tmux session in one registry. A second start for the same session does nothing (F5). It extends the marker watcher tick.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Detect the state                                    | Supervisor   | States: `working`, `idle`, `needs_input`, `permission_prompt`, `handoff_ready`, `roadmap_complete`, `usage_limit_dialog`, `usage_limit_wait`, `api_error`, `stale`, `lost`, `shell_prompt`. Sources: the pane, the transcript growth and the engine file. A state that a pane text match finds is confirmed by a second source before an action, for example `handoff_ready` needs the engine file at `handoff-pending`. A question is `needs_input` with no marker: the last assistant message in the transcript ends with a question, or the pane shows a choice prompt (F1, F15, F20, F22, F24).                                                                                                                                                                                                                                             |
| Idle                                                | Supervisor   | The pane is unchanged for two polls in a row (three equal reads 60 s apart, 120 s) while the pane shows no busy sign (`watch-loops.zsh` rule, F1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Stale                                               | Supervisor   | No transcript growth for 15 minutes while the state is `working` (F1, F8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Send input                                          | Supervisor   | One function: clear the input line, type the text with `send-keys -l` after the end of options separator (a trailing semicolon gets a backslash before it), wait 1.5 s, send `Enter` as a separate key, then find the text in the newest transcript. If it is not there, send `Enter` once more and check again. Then report `confirmed` or `unconfirmed`. While the session shows "warming up", it waits for the ready state for up to 60 s, else it reports `unconfirmed`. A pane whose input box row (the first row between its last two rule lines) is not the prompt line, such as a box left in bash, memory or background mode, is not ready. Text longer than 500 characters (half of the smallest size seen to fail, about 1000) goes to a file in the session folder, and the send is a one-line pointer to that file (F6, F14, F19). |
| Restart a stopped loop                              | Supervisor   | A loop at `idle` with an active engine file, no marker and no question gets one continue prompt that points at its `progress.md` and `resume.md`. A second stop in the same phase becomes `needs_input`. A loop at `needs_input` gets no continue prompt; it goes to the orchestrator. A `lost` session (tmux gone) or a `shell_prompt` session (Claude exited and the pane is at a shell prompt, `paneAtPrompt`) is resumed through the resume saga with the loop `resume.md` prompt. If that resume fails, the session goes to the attention queue.                                                                                                                                                                                                                                                                                           |
| Context handoff                                     | Supervisor   | At `handoffPercent` on the status line, send the handoff request; the loop hands off at its next phase boundary. At `handoffHardPercent`, if the loop has not handed off, send a hard request; the loop writes `progress.md` and hands off at once. Both thresholds use the stored status-line percent, never a self estimate (F4). On `handoff_ready` with the engine file at `handoff-pending`: clear, wait for ready, send the resume prompt (it restates the marker rule and tells the new session to write its own id into the engine file, as in the manual run, HR:5, RL:11), then confirm the new id in the engine file. Then cancel a repeated handoff request if one arrives. `request_handoff` from the orchestrator runs this duty now, below the threshold. (F4, F11, F20).                                                        |
| Usage limit                                         | Supervisor   | At the dialog, select the wait option. Usage credits are never selected. With `usageLimit` `stop` (D-6), mark the session `needs_input` and send nothing. With `wait`: if the engine file is `handoff-pending`, cancel the automatic continue once and resume a fresh session after the reset; else send one continue prompt at the reset time plus 2 minutes (F3, F10, F12). The account chain of LOCAL-94 plugs in at this step.                                                                                                                                                                                                                                                                                                                                                                                                              |
| API error or a sleep cut                            | Supervisor   | One continue prompt, then `needs_input` (F2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Permission prompt                                   | Supervisor   | Decline the dangerous delete prompt and record the command. Deny the held peer message dialog and record it. Each other prompt becomes `permission_prompt` in the attention queue for the user (F8, F9, F18).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Keep the machine awake                              | Supervisor   | Hold one `caffeinate -is` child (the manual fix, H05:54) while at least one session runs; stop it when none runs; record a wake after a sleep (F2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Close a finished loop                               | Supervisor   | On `roadmap_complete`: the pane shows the completion promise and each unit row of the roadmap says `built, awaiting /ship`. If the engine file is still active, rename it to `.done` (F21). D-8 needs this before a ship. The group card stays in its column until the ship flow ends, because a move to Done starts the worktree cleanup timer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PR and merge events                                 | Supervisor   | Watch the PRs of each group with `gh` and record state changes, including a merge that the user makes by hand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Dependency hold                                     | Supervisor   | A group with `dependsOn` (set by `create_group`) starts only after each named group is merged. The concurrency cap also applies (A15, F23).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Budget                                              | Supervisor   | When the cost of a group reaches `budgetPerGroup`, mark the session `needs_input` with the reason `budget` at the next gate event (A19).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Tickets, directions, base branches, groups          | Orchestrator | A1 to A4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Roadmap approval                                    | Orchestrator | Per the approval level of the policy (A5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Answers to loop questions and rulings on hard stops | Orchestrator | A6, A7. A ruling that changes the policy is a decision item for the user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| When to ship, and the PR text                       | Orchestrator | Starts the ship flow of D-8 with the title and body of each PR (A16).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Escalation                                          | Orchestrator | Creates a decision item when the policy or the playbook says a person decides.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

New server code goes in the existing layers: supervisor files in `services/orchestration/` with the name prefix `supervisor-`, pure state detection in `services/domain/`, orchestrator routes in `routes/orchestrator.route.ts`, and the MCP server as the `dispatch mcp` subcommand of the existing bin. The supervisor is a producer. It writes board state only through store mutations in the one store queue. It acts only through adapters: the tmux adapter (pane reads, keys and text), the exec adapter (`gh`, and the long-lived `caffeinate` child, which LOCAL-89 adds to the named exceptions of backend rule 7 in `code-review-rules.md`), and file access to the loop files (reads, the rename of the engine file, the pointer file). With `supervisor` off, no supervisor duty runs, and the board cannot start an orchestrator, because `send_input` and `wait_for_event` need the supervisor.

**Reason:** 16 of the 27 manual actions need no judgment, and 23 of the 25 failures have a rule that code can apply; F13 and the subagent brief of F18 are rules that the playbook states (research section 3); a model that polls pays tokens for each check and loses its watcher every 30 minutes (F7, F16).

**Rejected:**

- The orchestrator model watches and restarts loops by polling: it costs tokens per check, and its wait tools expire (F7, F16).
- A separate daemon process beside the server: it is a second writer, which "Do Not Change" contract item 9 forbids.
- A watcher inside each loop session: it stops when the session stops, which is the case it must detect.
- A new service folder for the supervisor: the backend standard has three service folders, and the term rule covers the name clash.

**Governs:** LOCAL-88, LOCAL-89, LOCAL-90, LOCAL-91, LOCAL-92

**Evidence:** research section 3.1 (A8 to A14, A17, A18 (the engine file part; the Done move is in D-8) and A22 go to the supervisor; A15 becomes the dependency hold; A21 becomes the dashboard (D-5 progress, D-6 budget); A26 is not needed, because the policy (D-6) and the playbook hold the rulings; for A27, LOCAL-89 adds `crossSessionInbound: refuse` to the generated hook settings (`server/bootstrap/hook-setup.ts`, H30:26), and no `.roadmap` link is needed, because the link served the resume script (H30:33) and the reader reads `.roadmap` at the session root; A4 and A6 are deterministic too, but they stay with the orchestrator because they carry out its own calls A2, A3 and A5), section 3.2 (F1 to F25), section 2 (the marker watcher reads the pane at `server/adapters/markers/watcher.ts:150`; the start saga already answers dialogs at `server/services/orchestration/steps.ts:387-408`); research section 6 (Composio settle window, Operator silence threshold).

### D-4: Control surface

**Date:** 2026-10-05

**Status:** accepted

**Decision:** The orchestrator acts through HTTP routes under `/api/orchestrator/` plus an MCP tool server. The MCP server is the `dispatch mcp` subcommand of the existing bin, runs over stdio, and only calls those routes. The orchestrator session loads it through `--mcp-config` at launch. Each orchestrator session gets one token from a registry like the hook token registry. The token names one board and one orchestrator, and it reaches the MCP server through the launch environment. A call for another board returns 403. The board routes of today take an optional `board` query parameter (the board key) on each collection route: the snapshot, the stream, card and group creation, search, events, the archive list and workspace routes. A card route looks up the board key that is stored on the card; it never parses the id prefix. `GET /api/events` gains a `since` cursor for `list_events` and `wait_for_event`, and the contract item 3 text changes in the same ticket. A request with no `board` parameter uses the default board, so each client, hook and script of today keeps its behaviour. The tool list is in "Tool reference" below. The orchestrator sends input to a loop with `send_input`: the tool calls `POST /api/orchestrator/sessions/:id/input`, the route calls the supervisor send function of D-3, and the tool returns `confirmed` or `unconfirmed`. The route rejects input while the session state is `permission_prompt`, `usage_limit_dialog`, `usage_limit_wait` or `shell_prompt`, so no tool can answer a permission prompt or a usage limit dialog, or type text into a shell. `stop_session` is new, because Dispatch has no session stop today. It sends one `Escape` key with one tmux `send-keys` call and no transcript check, and marks the session `needs_input`. It rejects the call in the same four states as the send route, because there `Escape` declines a prompt or cancels a continue. It leaves the tmux session, the Claude process and the worktree in place. It never kills a process. The supervisor holds `needs_input` until new input arrives, so the restart duty does not continue the loop. `resume_loop` restarts only a loop that the orchestrator stopped with `stop_session`, or a loop that stays at `needs_input` after the supervisor tried once. Only the user resumes a loop that the `stop` usage policy or the budget stopped; the route rejects `resume_loop` for those, and the orchestrator raises a decision item. A session state of `needs_input` moves the card to the `needs_input` column, as the `NEEDS_INPUT` marker does today.

**Reason:** a schema per tool lets the server check each call against the board and the policy before it acts, and the routes keep one code path for the UI, the tools and tests.

**Rejected:**

- A CLI for the orchestrator: it needs shell rights in the session, its text output needs parsing, and it has no schema per action.
- An MCP server with its own logic: it is a second code path and a second writer.
- Raw HTTP calls with `curl` from the model: no schema, and the token sits in the prompt.
- A path prefix per board (`/api/boards/:key/...`) on every route: it duplicates each route and breaks the paths of "Do Not Change" contract item 3.

**Governs:** LOCAL-86, LOCAL-90, LOCAL-91

**Evidence:** research section 2 (no route sends free text to a running session; `GET /events` has no cursor; the hook token registry at `server/services/orchestration/hook-tokens.ts:46`; the bin at `package.json:36-37`); research section 6 (Vibe Kanban MCP tools); research A14, F6.

### D-5: Loop progress protocol

**Date:** 2026-10-05

**Status:** accepted

**Decision:** Unit progress comes from the server reader of the loop files. The reader is the one source of truth. It reads, for each group card: the roadmap file at the session root (units, `Status:` lines, PRD paths), `.roadmap/<slug>/progress.md` (the current unit and phase), each unit PRD (the phase count and names from the `### Phase <N>:` headings), the `state.md` and `attempts.md` files of the current unit (pass lines and failed attempts), and the engine file `.claude/ralph-loop.local.md` (active, iteration, session id, `handoff-pending`). The session root is the workspace path of the group card. For a group with more than one repository, the reader uses the repository folder whose `.planning/` holds the PRD that the roadmap names. The value of a `Status:` line is its text before the first opening parenthesis. The reader is read-only and tolerant: a missing or malformed file gives a partial result and a warning. It runs on a file change and every 60 s. The last good result is stored on the group card and sent in the snapshot. The reader writes the card only when the result changes. The loop also calls `POST /api/loops/report` at each phase gate and unit gate, with its `x-dispatch-token` header (the session already has `DISPATCH_HOOK_TOKEN`, `DISPATCH_HOOK_PORT` and `DISPATCH_CARD_ID`). The report records a gate event and starts a new read. It never writes a progress field. One status-line parser on the marker watcher tick reads the context percent, the model, the cost and the usage meters from the pane of every session, whatever the `supervisor` value, and stores them on the session. The parser reads the status line format of this machine (WL:39); a session with another format gets empty meters. The supervisor reads the stored context percent for its handoff rule. New fields under "Do Not Change" contract item 1: `boardKey` on `Card` and `BoardSnapshot` (D-1), `ownerOrchestrator` and `loopProgress` on a group card (D-7, this record), `dependsOn` on a group card (D-3), and `state`, `stateReason` (for example `usage_stop`, `budget`, `stop_session`, `supervisor_gave_up`), `stateSince`, `contextPercent`, `model`, `cost` and `usage` on the persisted `Session` record (D-3), which the card holds in `sessions`. LOCAL-88 extends the session projection so the card mirrors them for the active session. `SessionFields`, the saga input, does not change. The ticket that adds a field updates the contract item 1 text in the same change.

**Reason:** a loop that forgets to report still shows correct progress, and only one writer produces the progress fields.

**Rejected:**

- The report alone: a loop that skips a report shows stale progress, which is the lag that agent teams report (research section 6).
- The reader alone: progress lags a gate by up to 60 s, and no gate event exists for the activity log.
- Progress fields written by the loop into the store: the model becomes a second source of truth.

**Governs:** LOCAL-88, LOCAL-92

**Evidence:** research section 2 (loop file layout; the hook token variables at `server/services/domain/claude-launch.ts:32-34`); research A8, A15, F4, F15.

### D-6: Policy per board

**Date:** 2026-10-05

**Status:** accepted

**Decision:** Each board has one policy. Only the user changes it, in the UI. No tool changes it.

| Field                | Values                                                                                                                                                                          | Default                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `roadmapApproval`    | `ask` (ask the user for each roadmap), `rules` (approve when the roadmap passes the rules of the playbook, else ask), `all` (approve each roadmap with no question to the user) | `ask`                                           |
| `concurrencyCap`     | number of loops that run at once on this board                                                                                                                                  | 3                                               |
| `loopModel`          | the model and effort for group sessions                                                                                                                                         | the session settings of today                   |
| `orchestratorModel`  | the model for the orchestrator session                                                                                                                                          | Opus                                            |
| `handoffPercent`     | context percent on the status line that starts a handoff                                                                                                                        | 50                                              |
| `handoffHardPercent` | context percent at which the supervisor sends a hard handoff request (D-3)                                                                                                      | 80                                              |
| `usageLimit`         | `wait` (wait for the reset, then continue) or `stop` (mark needs input)                                                                                                         | `wait`                                          |
| `shipRights`         | `none`, `open_prs`, `merge`                                                                                                                                                     | `none`                                          |
| `budgetPerGroup`     | a cost limit per group, or none                                                                                                                                                 | none                                            |
| `supervisor`         | `on` or `off`                                                                                                                                                                   | `off` on the default board, `on` on a new board |

Usage credits are not a value of any field. With `supervisor` off, the board behaves as today, and it cannot start an orchestrator (D-3).

**Reason:** the manual run changed four of these values by a user rule (model, cap, handoff and the usage rule, research A20), and a board with no policy change must behave as today.

**Rejected:**

- One global policy: projects differ in risk and in repository count.
- A policy per group: it multiplies the settings, and the manual run set each rule for all loops at once (A20).
- A cap of 2: three loops on the 8 GB machine gave load 9 to 10 and test timeouts, and the user set the cap of 2 on 2026-09-30 (research F23, FLS:8). The user raised it to 3 on 2026-10-05 (H05:42), and three loops run now. The default follows the latest user rule. The user can set 2 on a small machine.
- A usage credits option: the user rule forbids it (H05:44, RR:2).

**Governs:** LOCAL-89, LOCAL-90, LOCAL-91, LOCAL-92

**Evidence:** research A20 (H30:23, H30:24, H05:42, H05:43), F10, F23, research section 6 (Operator cap, Devin and Agent SDK budgets).

### D-7: More than one orchestrator on a board

**Date:** 2026-10-05

**Status:** accepted

**Decision:** A board has at most one main orchestrator. The user can add extra orchestrators. An extra orchestrator needs a main orchestrator on the same board. The board row holds `orchestrators`: for each, an id, a main flag, a scope, a policy override and its session name. Each extra has an explicit scope: a list of group ids or ticket ids. The scope is the one source of ownership: the owner of a group or ticket is the extra whose scope holds it, else the main orchestrator. A group card also holds `ownerOrchestrator`, the orchestrator that created it, as provenance only. A group or ticket that an extra creates joins its scope. Each group has exactly one owner orchestrator. Only the user moves ownership. A tool call on a card outside the scope of the caller returns 403. Only the main orchestrator ships. The concurrency cap counts all loops on the board, from all orchestrators. An extra can have a policy override that only narrows the board policy. Narrow means a lower `concurrencyCap`, `budgetPerGroup` or `shipRights`, `ask` in place of `rules` or `all`, `rules` in place of `all`, and `stop` in place of `wait`. The model fields have no override. A decision item goes to the owner of its group and shows in the board attention queue. The user answers it, and the answer reaches the owner orchestrator as an event.

**Reason:** one owner per group means two orchestrators never send input to the same loop or ship the same branch.

**Rejected:**

- Peer orchestrators with no main: no owner for the ship order and for the shared cap.
- A lock per tool call: it serialises calls but still lets two orchestrators steer one loop between calls.
- One orchestrator per board only: a large board fills one context; LOCAL-91 asks for extras.

**Governs:** LOCAL-91, LOCAL-92

**Evidence:** research section 6 (agent teams have one fixed lead; Claude Code Projects have one coordinator); research A16 (ship order needs one owner).

### D-8: Stacked branch ship flow

**Date:** 2026-10-05

**Status:** accepted

**Decision:** Shipping is server behaviour. The main orchestrator starts it with `start_ship`, which gives the branches of one group in stack order (unit branches first, then the specs branch if one exists) and the PR title and What/Why/How body for each. The flow needs `shipRights` of `open_prs` or `merge`. Preconditions: the loop is finished (each unit is `built, awaiting /ship`), the supervisor has closed its engine file (F21), and each earlier group in the order is merged. For each branch, in order:

1. Check out the branch in the group worktree and merge origin/main against the old stack tip, so git takes the side of main for the units that are already squashed. Never rebase.
2. Check that the diff against origin/main holds only this branch. For the Dispatch repository, check that no added prose line in docs, src, scripts, `.claude` and `CLAUDE.md` has an em dash or a double hyphen. Code spans and table delimiter rows are exempt.
3. Run the check command of the repository entry (D-1).
4. Push and open the PR with the given title and body.
5. Wait for the checks.
6. With `merge` rights: squash merge with the subject `<title> (#<n>)` and an empty body. If the signature rule blocks, merge again with `--admin` and record it. With `open_prs` rights: wait for the user to merge.
7. Fetch, then check that the author of the new main tip is the identity that the repository `user.name` and `user.email` gave at ship start, and that the commit has no Co-Authored-By line.

Each branch has a ship state: `queued`, `merging_main`, `checking`, `pushing`, `waiting_checks`, `waiting_merge` (with `open_prs` rights), `merging`, `verifying`, `merged` or `failed`. The flow state is `running`, `stopped` or `done`. `get_ship_state` returns, for each branch, the name, the ship state, the PR number, the check state and the identity result, plus the failed step and reason when the flow stopped. The flow stops at the first failure and creates a decision item. The flow never edits code. With `merge` rights, after the last branch merges, the flow moves the group card to Done (A18). With `open_prs` rights, the user moves it. With `open_prs` or `merge` rights, this flow replaces the user rule that only `/ship` pushes (SI:19, H05:44). With `none`, the default, that rule stands. To fix a failed check, the orchestrator sends an instruction to the group session with `send_input` and then resumes the flow. Every git and gh call goes through the exec adapter.

**Reason:** the manual ship flow was the same steps for each group that shipped from a ship file, from G10 on (research section 3.3, A16), and an identity check that a model can forget belongs in code.

**Rejected:**

- The orchestrator runs `/ship` in a session: the model does deterministic work and can skip the identity check.
- One PR for the whole group: each unit is one reviewable squash PR, the way G1 shipped.
- A rebase of the stack onto main: the rule is never rebase, and later branches share the unsquashed commits.
- Automatic known fixes inside the flow: a fix is a code edit, and the flow never edits code.

**Governs:** LOCAL-90, LOCAL-92, LOCAL-93

**Evidence:** research section 3.3 (SI:12 to SI:32), A16, A17, F17, F21; research section 5 (no surveyed tool has this flow).

### D-9: What an orchestrator must never do

**Date:** 2026-10-05

**Status:** accepted

**Decision:** An orchestrator never:

1. Writes or edits product code or any file in a repository.
2. Commits, pushes, merges or rebases outside the ship flow of D-8.
3. Selects usage credits.
4. Reads the vault or an env file.
5. Changes a policy, its own or another one.
6. Kills a process or a port holder.
7. Starts a loop above the concurrency cap.
8. Acts on another board, or on a card outside its scope (D-7).
9. Answers its own decision item, or approves a permission prompt.
10. Deletes a branch, a worktree or a card that it did not create.

The server enforces items 1 to 9 and the Done part of item 10: no tool exists for 1, 3, 4 and 6 (`stop_session` interrupts the turn and leaves the process alive, D-4, and the send route rejects input at a permission prompt, a usage limit dialog or a shell prompt, D-4); the routes reject 2, 5, 7, 8 and 9. `move_card` rejects a move to Done for a card that the orchestrator did not create, because a Done card gets a worktree cleanup after the cleanup delay. The playbook states all ten. The tool list of D-4 has no tool that allows an item of this list.

**Reason:** the lead of agent teams "may finish early or start implementing tasks itself" (research section 4, Claude Code agent teams), so the limits must be in the server, not only in the prompt.

**Rejected:**

- Limits in the playbook text only: a model can ignore text.
- A full shell for the orchestrator with a deny list: a deny list misses new commands.

**Governs:** LOCAL-90, LOCAL-91

**Evidence:** research section 6 (pitfalls), F9, F18, H05:44.

### D-10: Ship gate for a group with no loop progress

**Date:** 2026-10-09

**Status:** accepted

**Decision:** A group has no loop progress when its card has no `loopProgress` or when `loopProgress` has zero units. This record amends the D-8 precondition for such a group. D-8 keeps its text. One engine rule applies to every group, whatever its unit count: when `loopProgress.engine` is active and not closed, `start_ship` answers 409 `engine-not-closed`. A group with loop progress also keeps `loop-not-finished`, with no other change. For a group with no loop progress, `start_ship` checks these conditions in this order, after the source, main-only, ship rights and repository checks:

1. The group card is in Agent done. Else the call answers 409 `card-not-done`. Member tickets mirror the column of their group, so this check also covers the members.
2. Each named branch is the session branch of the group. This is the `branch` of the card. When the card has no `branch`, it is the card identifier. A branch of an older session is refused, because that branch lives in another worktree. Else the call answers 400 `invalid-branch-name` with `branch`. The names `main`, `master` and `HEAD`, a name that starts with `refs/` and the repository base stay refused for every group.
3. Each dependency of the group is merged, and no flow runs on the board, as in D-8.
4. The session root of the group, which is the workspace path of the card, has no engine file `.claude/ralph-loop.local.md`. A roadmap loop in planning has this file before the reader sees a roadmap. Else the call answers 409 `engine-not-closed`. A card with no workspace path answers 409 `no-workspace` first.
5. Each named branch exists as a local branch, as in D-8.
6. Each named branch has at least one commit that its base branch does not have. The session branch is cut from `origin/<base>`, so the server resolves the base once. The base is `refs/remotes/origin/<base>` when that ref exists, else `refs/heads/<base>`. A base that is empty, starts with a hyphen, is not a plain branch name or resolves to neither ref answers 409 `unknown-base` with `branch`. The server counts the commits with `git rev-list --count --end-of-options <ref>..refs/heads/<name>` in the group worktree. A count of 0 answers 409 `branch-not-ahead` with `branch`. A count that is not a number, or a failed git call, answers 409 `no-workspace`.
7. The group worktree has no uncommitted change. `git status --porcelain` prints nothing. Else the call answers 409 `worktree-dirty`. A failed `git status` call answers 409 `no-workspace`.

The checks 1 to 3 use no git call. The check 4 reads one file and runs before any git call. The checks 5 to 7 run before the git identity is read and before any write, so a refused call stores no flow.

**Reason:** in the G19 Unit 2 real run, group RUN-4 built and tested its code on Sonnet 5.5 for 0.25 USD and left commit 948b54c. `start_ship` refused the group twice with `loop-not-finished`, because no seeded playbook runs a roadmap loop and the group had no loop progress. The gate had no rule for a group of this kind. A review of the first version found a loop in planning with zero units and an active engine, a stale local base and a base that reached the git option parser. The engine rule, check 4 and check 6 close these cases.

**Rejected:**

- Every group runs a roadmap loop: a roadmap loop needs a person for planning and costs more.
- Run the check command in the gate: ship step 3 runs it on the pinned commit.
- A separate check that the members are done: the members mirror the group column.

**Governs:** LOCAL-95

**Evidence:** the G19 real run report, Unit 2 (group RUN-4, commit 948b54c).

## Tool reference

This section is the reference for the 26 tools. Each tool calls one route under `/api/orchestrator/`. Each call is checked against the board scope and, for a write, the policy (D-6), and is recorded as a `tool_call` row in `orchestration_events`. A tool call on a card that another orchestrator owns (D-7) returns 403 `other-owner`.

| Family    | Tools                                                                                                                                 | Notes                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Read      | `list_cards`, `get_card`, `list_sessions`, `get_group_progress`, `read_pane_tail`, `list_events`, `get_policy`, `get_board_workspace` | `list_events` takes a `since` cursor                                                     |
| Tickets   | `create_ticket`, `update_ticket`, `move_card`, `add_comment`                                                                          | `update_ticket` closes F25                                                               |
| Groups    | `create_base_branch`, `create_group`, `start_group`                                                                                   | `create_group` takes members, optional repos, playbook, direction and `dependsOn`        |
| Sessions  | `send_input`, `approve_roadmap`, `request_handoff`, `resume_loop`, `stop_session`                                                     | `send_input` returns `confirmed` or `unconfirmed` (D-4); `resume_loop` per Key rules     |
| Ship      | `start_ship`, `get_ship_state`                                                                                                        | D-8                                                                                      |
| Decisions | `create_decision_item`                                                                                                                | the user answers; the answer returns as an event                                         |
| Wait      | `wait_for_event`                                                                                                                      | blocks until an event matches a filter or a time limit passes                            |
| State     | `read_state`, `write_state`                                                                                                           | the orchestrator keeps its state in the store, because it has no file write tool (U4-05) |

Every route sits under `/api/orchestrator/`, and the paths below are relative to it. Each tool is one entry of `src/server/bootstrap/mcp-tools.ts`, and each route is declared in `src/server/routes/orchestrator.route.ts`, its handler is in `src/server/routes/orchestrator.handlers.ts` and its zod schema is in `src/server/routes/orchestrator-schemas.ts`. These rules hold for every route, so the entries do not repeat them:

- A call with no `x-orchestrator-token` header answers 401 `orchestrator-token-required`. A token that is unknown or revoked answers 401 `orchestrator-token-invalid`.
- A card that is on another board answers 403 `other-board`.
- A route that names a card also answers 400 `invalid-card-id` for an empty id or an id of more than 200 characters, and 404 `unknown-card` for an id that the store does not hold.
- A value that fails its schema answers 400, and `error` holds the code of the field. A policy refusal answers 403 `policy-refused`, and `reason` holds the text.
- Each error body is `{ error, ...details }`. The 404 `unknown-board` body also holds `code` with the same text. Each call that reaches a route writes one `tool_call` event, accepted or refused.
- The MCP server checks each input against the tool schema first. An input that it refuses writes no `tool_call` event. The path card ids (`id`, `cardId`) take a string of 1 to 200 characters in both the MCP schema and the route, so a Linear card id (a UUID) passes. Three more fields use the same rule: `create_group.dependsOn`, `create_decision_item.cardId` and `wait_for_event.cardIds`. `create_group.memberIds` takes any string in both, and the route refuses a card that is unknown or not eligible. The limits that the two schemas share are in `src/shared/orchestrator-limits.ts`, and `src/server/bootstrap/mcp-contract.test.ts` checks the tool table against the route schemas.

### `list_cards`

- Route: `GET /cards`.
- Input: `column` (optional, one of `todo`, `in_progress`, `needs_input`, `agent_done`, `in_review`, `parked`, `done`, `inbox`), `source` (optional string, 1 character or more), `text` (optional string, 1 character or more).
- Description: "List the cards on your board. You can filter by column, source or text."
- Refusals: 400 `invalid-column`, `invalid-source`, `invalid-text`.

### `get_card`

- Route: `GET /cards/:id`.
- Input: `id` (card id).
- Description: "Get one card with its members. A card outside your board is refused."
- Refusals: none beyond the rules above.

### `list_sessions`

- Route: `GET /sessions`.
- Input: `live` (optional boolean, sent as `true` or `false`).
- Description: "List the sessions on your board. Set live to true to list only the running sessions."
- Refusals: 400 `invalid-live`.

### `get_group_progress`

- Route: `GET /groups/:id/progress`.
- Input: `id` (card id).
- Description: "Get the progress of one group card. A card outside your board is refused."
- Refusals: 400 `not-group-card`.

### `read_pane_tail`

- Route: `GET /sessions/:cardId/pane`.
- Input: `cardId` (card id), `lines` (optional integer, 1 to 200, default 50).
- Description: "Read the last lines of the terminal of a session. The line count is 1 to 200, and the default is 50."
- Refusals: 400 `invalid-lines`. 409 `no-live-session` when the card has no active tmux session or a provisioning step, or when the pane cannot be captured.

### `list_events`

- Route: `GET /events`.
- Input: `since` (optional integer, 0 or more, default 0), `limit` (optional integer, 1 to 200, default 200).
- Description: "List the events of your board after an event id. The limit is 1 to 200."
- Result: the events of every kind, including `group_state`.
- Refusals: 400 `invalid-since`, `invalid-limit`.

### `get_policy`

- Route: `GET /policy`.
- Input: none.
- Description: "Read the board limits and the count of running loops. This tool changes nothing."
- Answer: the policy (with `groupPlaybook`), `runningLoops`, `concurrencyCap`, `groups`, and `playbooks`, the sorted names of the playbooks that exist.
- Refusals: none beyond the rules above.

### `get_board_workspace`

- Route: `GET /board-workspace`.
- Input: none.
- Description: "Read the board workspace: the folder, the repositories with their base branch and check command, the playbook names and the group playbook. This tool changes nothing."
- Answer: `folder` (the workspace folder of the board, or null), `repos` (each repository of the board as `{ path, base, checkCommand }`, and `base` is null when the repository has no base branch), `playbooks` (the sorted names of the playbooks that exist) and `groupPlaybook` (from the policy of the caller, or null).
- Refusals: none beyond the rules above.

### `create_ticket`

- Route: `POST /tickets`. It answers 201 with `{ card }`.
- Input: `proposalItemId` (id of a `ticket_proposal` decision item), `index` (integer, 0 or more: the position of one ticket in the proposal). A `title` or `description` field is refused.
- Description: "Create a local ticket from one entry of a ticket proposal that the user approved. A proposal that is open, rejected or unknown, and an entry that is already used, are refused."
- Refusals: 400 `invalid-proposal-item`, `invalid-index` (also an index outside the list), `unknown-field`, `not-a-proposal` (the item is not a `ticket_proposal`). 403 `other-owner` (another orchestrator raised the item). 404 `unknown-proposal` (the id is unknown or the item is on another board), `unknown-board`. 409 `proposal-open`, `proposal-rejected` (the user answered `reject`), `proposal-index-used`, `board-archived`.
- The ticket title and description come from the proposal entry. The store marks the index used in one guarded write before the ticket is created, so two calls at the same time create one ticket. If the create fails, the index is free again. The card keeps `createdByOrchestrator`.

### `update_ticket`

- Route: `PATCH /tickets/:id`.
- Input: `id` (card id), `title` (optional, as for `create_ticket`), `description` (optional, as for `create_ticket`).
- Description: "Change the title or the description of a ticket. Text that holds the status marker is refused."
- Refusals: 400 `empty-ticket-patch` (neither field given), `invalid-title`, `invalid-description`, and the marker text of `create_ticket`. 409 `not-a-ticket` for a group card. 409 `linear-card` with `reason` `linear card: edit in Linear` for any card that is not local.

### `move_card`

- Route: `POST /tickets/:id/move`.
- Input: `id` (card id), `column` (one of `todo`, `in_progress`, `needs_input`, `agent_done`, `in_review`, `parked`, `done`, `inbox`).
- Description: "Move a card to a column. A move that the board rules do not allow is refused."
- Refusals: 400 `invalid column; must be one of: todo, in_progress, needs_input, agent_done, in_review, parked, done, inbox`. 403 `done-not-own-card` with `reason` `move to Done: card was not created by this orchestrator`. 409 `group-done-by-ship` for a move of a group card to Done (the ship flow with `merge` rights or the user moves it). 409 with the board rule as `error`: `card is grouped under <group id>, act on the group card`; `inbox cards can only be promoted to To Do`; `only To Do cards can be moved to Inbox`; `a start is in flight for this card`; `cards with session history cannot be moved to Inbox`; `Agent Done is set automatically by a real agent completion signal. It is never a manual move target`; `starting a To Do card requires the start flow: drag it to In Progress (or use Start) rather than posting a bare move`; `moving <from> → <to> is not an allowed manual transition`.

### `add_comment`

- Route: `POST /tickets/:id/comments`.
- Input: `id` (card id), `body` (string, 1 to 20000 characters).
- Description: "Add a comment to a card. A comment that is empty or holds the status marker is refused."
- Refusals: 400 `Comment is empty.`, `Comment is longer than 20000 characters.`, `Comment cannot contain DISPATCH_STATUS:.`. For a card that is not local the comment goes to Linear, and the route answers the outbound status with its text: 404 `unknown card id: <id>`, 409 `source cannot comment` (a group card, or Linear not connected) or 502 with the Linear error copy. A local card answers 201 `{ comment }`, and a Linear comment answers 201 `{ ok: true }`.

### `create_base_branch`

- Route: `POST /base-branches`.
- Input: `repository` (string, a repository path of the board), `name` (string, `base/` followed by a name that matches `[a-z0-9][a-z0-9._/-]{0,60}`), `startPoint` (string, 1 to 200 characters).
- Description: "Create a base branch in a repository from a start point. A repository that is not known is refused."
- Refusals: 400 `unknown-repository` (a missing value or a path that is not a repository of the board; on the default board the workspace folders are its repositories for `create_group`, `create_base_branch` and `start_ship`), `invalid-branch-name` (the pattern, a `..`, a trailing `/` or `.lock`, or a name that `git check-ref-format` refuses), `unknown-start-point` (a start point that starts with `-` or is not a commit). 404 `unknown-board`. 409 `branch-exists`.

### `create_group`

- Route: `POST /groups`.
- Input: `title` (string, 1 to 300 characters after trimming), `memberIds` (array of 2 or more distinct card ids), `repos` (optional array of 1 or more `{ path, base }`, both strings of 1 character or more; when omitted, the group uses every repository of the board with its base branch, and `get_board_workspace` lists them), `playbook` (optional string, 1 character or more; when omitted, the `groupPlaybook` of the board policy applies when a playbook with that name exists, else the group has no playbook), `direction` (optional string, at most 10000 characters), `dependsOn` (optional array of at most 50 group card ids).
- Description: "Create a group card from 2 or more cards. Omit repos to use the board repositories with their base branch; get_board_workspace lists them. A repository with no base branch is refused with missing-base; then pass repos with a base. Omit playbook to use the board group playbook; get_policy lists the playbook names. Text that holds the status marker is refused."
- Refusals: 400 `invalid-title`, `invalid-member-ids`, `invalid-repos` (also for an omitted `repos` on a board with no repository), `missing-base` with `path` (an omitted `repos` and a board repository with no base branch), `invalid-playbook`, `invalid-direction`, `invalid-dependency` (a bad id, or a card that is not a group on your board), `unknown-repository` (a repo path that is not a repository of the board), and `content contains the DISPATCH_STATUS marker` for a title or a direction that holds the status marker. 400 with a text as `error`: `unknown playbook`, `invalid base branch` (a base that starts with `-`), `Can't start: a selected repo is missing`, `orchestration config is not loaded`. 403 `other-owner` (a member outside your scope, that another orchestrator owns). A group that an extra creates joins its scope. 404 `unknown-board`. 409 `some selected cards are no longer eligible to be grouped` with `ineligibleIds` (a card that is unknown, on another board, not in To Do, already grouped, itself a group or an orchestrator session card). 409 `board-archived`.

### `start_group`

- Route: `POST /groups/:id/start`. It answers 202 with `{ started: true }` after the session start ends, or with `{ queued: true, waitingOn }` at once when a dependency is not done. The cap check and the start run in one tick, so two calls at the same time cannot both take the last slot.
- Input: `id` (card id).
- Description: "Start the session of a group card. A group that is already started is refused."
- Refusals: 400 `not-group-card`, `orchestration config is not loaded` (before the queue flag changes). 403 `policy-refused` with `reason` `concurrency cap reached: <running> of <cap> loops running` or `budget reached: cost <cost> of <budget>`. 404 `unknown-board`. 409 `already-started` when the group runs or has a live session. 409 `start-failed` with `reason` `start failed at <step>` or `start failed` when the session start fails; the queue flag goes back to its value before the call and one `supervisor_action` event with `action` `start_group_failed` is recorded. A held start that the supervisor pass makes and that fails goes back in the queue with the same event.

### `send_input`

- Route: `POST /sessions/:cardId/input`. It answers 200 with `{ result }`, and `result` is `confirmed` or `unconfirmed`.
- Input: `cardId` (card id), `text` (string, 1 to 20000 characters with at least one character that is not a space).
- Description: "Type text into a running session. A session that stopped on budget or usage is refused."
- Refusals: 400 `invalid-text`, also with `reason` `text starts with a mode character` when the first character of the typed line is `!`, `/`, `#`, `&` or `@`, or `text is empty after control characters are removed` when the typed line is empty. The typed line is the text with each run of control characters replaced by a space and the ends trimmed, the line that `sendConfirmed` types; the check runs on it also for a text over 500 characters that goes through a pointer file. 403 `policy-refused` with `reason` `user must resume` (the session stopped on `budget` or `usage_stop`) or `budget reached: cost <cost> of <budget>`. 404 `unknown-board`. 409 `ship-running` (the ship flow of the card runs), `no-live-session`, `session-busy` (another session tool runs on the card), `session-state-refused` with `reason` `session is at <state>` for `permission_prompt`, `usage_limit_dialog`, `usage_limit_wait` or `shell_prompt`.
- The budget cost is the running total of the group (U2-22): a cost meter that drops after a claude relaunch adds to the earlier cost. The same total applies to `start_group`, `resume_loop` and the cost that `get_policy` shows.

### `approve_roadmap`

- Route: `POST /groups/:cardId/approve-roadmap`. It answers 200 with `{ result }`.
- Input: `cardId` (card id), `decisionIds` (array of 1 to 50 strings, each 1 to 40 characters of letters, digits and `-`).
- Description: "Approve the plan of a group card. When the board asks the user to approve, decisionIds must name an answered approve item of this group, else the request is refused."
- Refusals: 400 `invalid-decision-ids`, `not-group-card`. 403 `policy-refused` with `reason` `user must resume`, or `roadmap approval needs an answered approve item from the user` when the board policy is `roadmapApproval: ask` and no answered `roadmap_approval` item of this card that `decisionIds` names holds the option `approve` and is unused. An approval under `ask` marks the item used (`consumedAt`) in one store write, so one answer approves one plan. With `all` and `rules` the ids are not checked. 404 `unknown-board`. 409 `ship-running`, `no-live-session`, `session-busy`, `session-state-refused` (as for `send_input`).

### `request_handoff`

- Route: `POST /sessions/:cardId/handoff`. It answers 202 with `{ result }`.
- Input: `cardId` (card id), `hard` (optional boolean).
- Description: "Ask a session to write a handoff. Set hard to true for a hard handoff."
- Refusals: 400 `invalid-hard`. 403 `policy-refused` with `reason` `user must resume`. 409 `ship-running`, `no-live-session`, `no-loop` (the card has no loop progress), `session-busy`, `session-state-refused` (as for `send_input`).

### `resume_loop`

- Route: `POST /sessions/:cardId/resume`. It answers 200 with `{ result }`.
- Input: `cardId` (card id).
- Description: "Resume the loop of a session that stopped. A session that stopped on budget or usage is refused."
- Refusals: 403 `policy-refused` with `reason` `user must resume`, `concurrency cap reached: <running> of <cap> loops running` or `budget reached: cost <cost> of <budget>`. 404 `unknown-board`. 409 `ship-running`, `no-live-session`, `session-busy`, `not-resumable` with `reason` `session is not stopped by stop_session or a supervisor give-up`.

### `stop_session`

- Route: `POST /sessions/:cardId/stop`. It answers 200 with `{ stopped: true }`.
- Input: `cardId` (card id).
- Description: "Stop the session of a card. A card outside your board is refused."
- Refusals: 403 `policy-refused` with `reason` `user must resume`. 409 `ship-running`, `no-live-session`, `session-busy`, `session-state-refused` (as for `send_input`).

### `start_ship`

- Route: `POST /groups/:cardId/ship`. It answers 202 with `{ flow }`.
- Input: `cardId` (card id), `repository` (string, a repository path of the group workspace), `branches` (array of 1 to 10 distinct `{ name, title, body }`: `name` 1 to 100 characters that match `[A-Za-z0-9][A-Za-z0-9._/-]{0,99}` with no `..`, `title` 1 to 200 characters after trimming, `body` 1 to 20000 characters after trimming).
- Description: "Start the ship steps of a finished group card for its branches in stack order. A board with no ship rights is refused."
- Refusals: 400 `not-group-card`, `unknown-repository` (also a repository with no board repository entry; an entry with an empty `checkCommand` skips step 3), `invalid-branches` (also a repeated branch name), `invalid-branch-name` (also with `branch`: a name that is not the `branch` of a loop unit or `test/<slug>-specs` or, for a group with no loop progress, a name that is not the `branch` of the card (else its identifier), a name `main`, `master` or `HEAD`, a name that starts with `refs/`, the repository base branch, or a name with no local `refs/heads/<name>`), `invalid-title`, `invalid-body`, and `content contains the DISPATCH_STATUS marker` for a title or body that holds the status marker. 403 `policy-refused` with `reason` `ship rights are none`. 404 `unknown-board`. 409 `loop-not-finished` (a group with loop progress and a unit that is not `built, awaiting /ship` or `shipped`), `engine-not-closed` (the engine of any group is active and not closed, or a group with no loop progress holds the engine file `.claude/ralph-loop.local.md` in its session root), `card-not-done` (a group with no loop progress that is not in Agent done), `dependency-not-merged` with `reason` the ids that wait, `ship-flow-running` (a flow runs on the board), `no-workspace` (no workspace path, or no worktree for the repository, checked before any git call; also a failed git call of the ahead or clean check, or a count that is not a number), `branch-not-ahead` with `branch` (a group with no loop progress: the branch has no commit that `origin/<base>`, else the local base, lacks), `unknown-base` with `branch` (the base is empty, starts with a hyphen, is not a plain branch name, or resolves to neither `refs/remotes/origin/<base>` nor `refs/heads/<base>`), `worktree-dirty` (a group with no loop progress: the worktree has an uncommitted or untracked file), `no-git-identity` (a failed or empty `user.name` or `user.email`).
- Flow stops: the runner reads the board policy before each step and each poll. `shipRights: none` stops the flow with `reason` `ship rights were removed`, and `open_prs` makes the flow wait for the user merge in place of `merging`. A worktree with uncommitted changes stops `merging_main` with `reason` `worktree has uncommitted changes`. Five failed PR polls in a row stop the flow. An empty check rollup is pending for 3 polls and then counts as passed; a completed check with a conclusion outside `SUCCESS`, `NEUTRAL` and `SKIPPED` is failed. A branch reuses an open PR in place of `gh pr create` only when the PR is from the same repository, into `main`, and its head commit is the checked commit.
- Commit pinning: after `merging_main` the flow records the merged commit (`checked` on the branch). The check runs on it, the push sends `<checked>:refs/heads/<name>`, and the merge passes gh's match head commit option with it. A resumed flow at `checking` or later stops with `reason` `branch moved since the check` when HEAD is not that commit. Every gh call passes gh's repo option with the owner and name of the `origin` remote, read once at the start and stored as `repo` on the flow; an origin whose host is not `github.com` or `ssh.github.com` (an SSH host alias, another host) or a local path gives `repo` null and no repo option. The signature retry of step 6 runs only when every violation clause of the merge error (lines split on sentence ends, commas and semicolons) matches `must have verified signatures`.
- More stops: a diff hunk under a header that names no file stops `checking` with `reason` `unparsed diff header`. A resumed flow on a card with no workspace path stops with `reason` `group has no workspace`. A runner whose card is gone stops with no write and no decision item; the runner reads the policy of the board it started on. A refused move to Done after the last merge keeps the flow `done` and raises one `ship_failure` item that asks the user to move the group by hand.

### `get_ship_state`

- Route: `GET /groups/:cardId/ship`. It answers 200 with `{ flow }`.
- Input: `cardId` (card id).
- Description: "Get the state of the ship steps of a group card. A card outside your board is refused."
- Refusals: 404 `no-ship-flow`.

### `create_decision_item`

- Route: `POST /decisions`. It answers 201 with `{ item }`.
- Input: `cardId` (optional, nullable card id), `kind` (one of `roadmap_approval`, `ruling`, `ship_failure`, `ticket_proposal`, `other`), `question` (string, 1 to 2000 characters), `options` (array of 2 to 8 `{ id, label }`: `id` matches `[a-z0-9_-]{1,40}` and is distinct, `label` is 1 to 200 characters), `recommendedOptionId` (optional, one of the option ids), `tickets` (array of 1 to 20 `{ title, description }`; required for kind `ticket_proposal` and refused for any other kind). A ticket `title` and `description` follow the bounds and the status marker rule of a ticket (title 1 to 300 characters, description 1 to 20000 characters).
- Description: "Create a decision item for a person to answer. Give 2 to 8 options with distinct ids. For the kind ticket_proposal, give 1 to 20 tickets, each with a title and a description."
- Refusals: 400 `invalid-kind`, `invalid-question`, `invalid-options`, `invalid-recommended-option` (also an id that is not in `options`), `invalid-tickets` (also `tickets` on a kind other than `ticket_proposal`, or a `ticket_proposal` with no `tickets`), `invalid-title`, `invalid-description`, and `content contains the DISPATCH_STATUS marker`. The `cardId` rules above apply when `cardId` is set.
- For kind `roadmap_approval` the server sets the options (`approve` "Approve the roadmap", `reject` "Do not approve") and the recommended option `approve`, and ignores the caller options.
- For kind `ticket_proposal` the server sets the options (`approve` "Create these tickets", `reject` "Do not create") and the recommended option `approve`, and ignores the caller options. The stored item holds `proposal: { tickets, usedIndexes: [] }`. `create_ticket` creates a ticket from an entry of an approved proposal only.
- The item belongs to the owner orchestrator of its card (D-7), or to the caller when it has no card or the board has no owner rule. The `decision_raised` and `decision_answered` events carry that `orchestratorId`. The user answers in the panel (`POST /api/decisions/:id/answer`), and the answer returns as the `decision_answered` event.

### User routes for intake and sessions

A user route refuses a call that carries an orchestrator token (403 `orchestrator-token-on-user-route`).

- `POST /api/boards/:key/intake` takes `{ goal, requirements? }` (`goal` 1 to 2000 characters, `requirements` 65536 bytes or less). It appends an `intake_submitted` event for the main orchestrator and answers 202 with `{ eventId }`. The event data holds `orchestratorId`, `goal` and `requirements` (or `null`). It creates no ticket. A board with no main orchestrator answers 409 `no-main-orchestrator`.
- `POST /api/sessions/:cardId/input` takes `{ text }` (1 to 20000 characters), types it into the running session and answers 200 with `{ result }`: `confirmed` or `unconfirmed`. It refuses the four states with no keys (`permission_prompt`, `usage_limit_dialog`, `usage_limit_wait`, `shell_prompt`) with 409 `session-state-refused`, a text that is empty or starts with a mode character with 400 `invalid-text`, a card with no live session with 409 `no-live-session`, and a second call on the same card with 409 `session-busy`. It does not check the budget or a user stop, so the user can reply to a stopped loop.
- `POST /api/sessions/:cardId/resume-loop` sends the continue text to a session at `needs_input` for any `stateReason`, including `usage_stop` and `budget`. It runs no cap or budget check. It sets the session to `working` when the send is `confirmed` and answers 200 with `{ result }`. A session that is not at `needs_input` answers 409 `not-resumable`.

### `wait_for_event`

- Route: `POST /events/wait`. It answers 200 with `{ event }`, or with `{ timedOut: true, cursor }` when the time ends.
- Input: `since` (integer, 0 or more), `kinds` (optional array of 1 to 20 event kinds: `loop_gate`, `supervisor_state`, `supervisor_action`, `pr_state`, `machine_wake`, `tool_call`, `decision_raised`, `decision_answered`, `intake_submitted`, `group_state`), `cardIds` (optional array of 1 to 50 card ids), `timeoutSeconds` (optional integer, 1 to 55, default 55). The MCP tool sends 55 when the call omits it, because the MCP client cuts a tool call at 60 seconds; the route itself takes 1 to 540, default 240, for a direct client.
- Description: "Wait for the next board event after an event id. The wait is at most 55 seconds, and the default is 55. If no event comes, call it again to keep waiting."
- Refusals: 400 `invalid-since`, `invalid-kinds`, `invalid-card-ids`, `invalid-timeout`. A `tool_call` event ends the wait only when `kinds` names it.

### `read_state`

- Route: `GET /state`. It answers 200 with `{ markdown, updatedAt, handoffReady }`. Before the first write, `markdown` is an empty string, `updatedAt` is `null` and `handoffReady` is `false`.
- Input: none.
- Description: "Read your saved state: the markdown, the time it was written and the handoff flag. Call it first, before any action."
- Refusals: 404 `unknown-orchestrator` when the token names an orchestrator that has no record on its board. The call reads the record of the caller only.

### `write_state`

- Route: `PUT /state`. It answers 200 with `{ updatedAt, handoffReady }`. The call replaces the earlier state.
- Input: `markdown` (string, 65536 bytes or less in UTF-8), `handoffReady` (optional boolean; when it is absent, the flag becomes `false`).
- Description: "Save your state as markdown, 64 KiB at most. It replaces the earlier state. Set handoffReady to true only when you hand off."
- Refusals: 400 `invalid-markdown`, `invalid-handoff-ready`, `state-too-large` (the markdown is more than 65536 bytes; the stored state does not change). 404 `unknown-orchestrator` when the token names an orchestrator that has no record on its board. The call writes the record of the caller only.

When `handoffReady` is `true`, the supervisor reads the handoff as pending, as it reads `handoff-pending` in the engine file of a loop. When it sees the line `HANDOFF_READY <orchestratorId>`, it clears the session, sends the resume prompt, and sets `handoffReady` to `false` when the prompt is confirmed.

### Rules for the orchestrator session (Unit 4)

- The orchestrator session is launched with `--tools Read Glob Grep` (an allowlist of the read-only built-in tools, so no command or code running tool such as `Monitor`), `--allowedTools mcp__dispatch` (the board tools run without a permission dialog), `--permission-mode manual` (a user `defaultMode` cannot widen it) and `--disallowedTools Bash Write Edit NotebookEdit`, with every bypass flag stripped. The session then cannot reach the user routes by other means (U3-15, U4-04).
- The user card routes `POST /api/cards/:id/start` and `POST /api/cards/:id/run-claude` refuse a hidden orchestrator card with 409 `orchestrator-card` (reason "use the orchestrator panel"), so only the orchestrator routes start or relaunch it (U4-03).
- No tool and no route path holds push, merge, credit, vault or a policy change. `get_policy` is the one tool with `policy` in its name, and it only reads. A push and a merge exist only inside the ship flow, behind `shipRights` (U3-13).

## Scope changes

### LOCAL-84

Confirmed. Inputs from these records: the states of D-3, the policy fields of D-6, the decision items of D-3 and D-7, and the ship states of D-8.

### LOCAL-85

Change: inbox items get no board key (D-1). The counters stay in the global prefix map; there is no counter row per board (D-2). The board key is the board id. The board row holds the workspace root, the repositories, `linearTeamKeys` and the last used folder. The snapshot gains the board key, and the "Do Not Change" contract item 1 text changes in the same PR (D-1). Key validation includes known Linear team keys (D-2). The store keeps writing the legacy `localTicketCounter` and `groupTicketCounter` fields next to `identifierCounters` for the `LOCAL` and `GROUP` prefixes. `Config` keeps `workspaceRoot`, `repoPaths` and `baseBranches` as the source of the default board (D-1). The new fields follow contract item 1 (D-5).

Amendment, 2026-10-06 (LOCAL-84): `repoPaths` and `baseBranches` are retired. The default board reads `workspaceRoot` from `Config` and its repositories from the store `workspaceFolders` (D-1 amendment).

### LOCAL-86

Change: the board scope is an optional `board` query parameter on collection routes; card routes look up the board key that is stored on the card; no parameter means the default board (D-4). The "Do Not Change" contract item 3 text gains the parameter. The Linear poller places cards by `linearTeamKeys` (D-1).

### LOCAL-87

Change: the Inbox page shows the global items plus the Inbox-column cards of the selected board (D-1). The board create and edit form has the `linearTeamKeys` field (D-1). The board shows a warning when a Linear team key equals its key (D-2). The edit form shows the key read-only (D-1). The edit form of the default board writes the `Config` fields through the config holder (D-1).

Amendment, 2026-10-06 (LOCAL-84): the edit form of the default board writes `workspaceRoot` to `Config` and its repositories to the store `workspaceFolders` (D-1 amendment).

### LOCAL-88

Change: the report route only records a gate event and starts a new read; the reader is the one source of progress (D-5). The route uses the `x-dispatch-token` header of the session. The reader also reads each unit PRD for the phase count and names. One status-line parser on the marker watcher tick stores the meters on every session, whatever the `supervisor` value (D-5).

### LOCAL-89

Change: the code goes in the existing layers with the `supervisor-` prefix (D-3). The supervisor detects 12 states, not 10: the added states are `lost` (tmux gone) and `shell_prompt` (Claude exited) (D-3). It restarts a stopped loop: one continue prompt, then `needs_input`, and the resume saga for `lost` and `shell_prompt` (D-3). It holds a group until its dependencies merge, and it stops a group at its budget (D-3). It adds `crossSessionInbound: refuse` to the generated hook settings (A27, F9). It extends the ARCHITECTURE section "Tmux Invocations" and the SHELL-01 entry of `code-review-rules.md` for the new typed surface. It watches PR and merge events, and it closes a finished loop (D-3). The send function writes text longer than 500 characters to a file and sends a one-line pointer (D-3). Fixed values, not policy fields: idle after the pane is unchanged for two polls in a row, 60 s apart (120 s), stale after 15 minutes with no transcript growth, one continue prompt after an API error (D-3). At a usage limit with `handoff-pending`, the supervisor cancels the automatic continue and resumes a fresh session (D-3). At the usage limit dialog the supervisor always selects the wait option. The `stop` policy then marks the session `needs_input` (D-3, D-6). Prompts other than the dangerous delete and the peer message go to the user (D-3). The send function keeps the tmux argv of "Do Not Change" contract item 5. The default board starts with the supervisor off (D-6).

### LOCAL-90

Change: the tool reference lives in this document (Tool reference). The PR title and body come from the orchestrator (D-8). The events route gains a `since` cursor for `list_events` and `wait_for_event` (D-4). The MCP server is the `dispatch mcp` subcommand (D-4). With `open_prs` rights, the ship flow waits for the user to merge each PR before the next branch (D-8). `create_decision_item` is a tool (D-3). `stop_session` interrupts the turn and leaves the process alive (D-4). `move_card` rejects a move to Done for a card that the orchestrator did not create (D-9).

Amendment, 2026-10-07 (LOCAL-90): the orchestrator token registry stores only the SHA-256 hash of each token in a store table, and a user route mints the token (U3-02).

Amendment, 2026-10-07 (LOCAL-90): `list_events` and `wait_for_event` read the `orchestration_events` table with a `since` id, and `GET /api/events` also gains `since` (U3-05).

Amendment, 2026-10-07 (LOCAL-90): a base branch name must also pass a local `git check-ref-format --branch`, because the pattern alone accepts `base/a//b` (U3-07).

Amendment, 2026-10-07 (LOCAL-90): `create_group` refuses a direction that holds the status marker with 400 and the marker reason, as for ticket text (U3-07).

Amendment, 2026-10-07 (LOCAL-90): `start_group` answers 409 `already-started` only when the group runs or has a live session, so a group whose sessions are all lost or ended can start again and the budget refusal can fire (U3-07).

Amendment, 2026-10-07 (LOCAL-90): all five session tools refuse a `budget` or `usage_stop` session with 403 `user must resume`, a second session tool on a card while one runs answers 409 `session-busy`, and the `send_input` text must hold a character that is not a space (U3-08).

Amendment, 2026-10-07 (LOCAL-90): ship step 1 is `git fetch origin` and then `git merge --no-edit origin/main` on the branch. A conflict runs `git merge --abort` and stops the flow at `merging_main` with a `ship_failure` decision item, because the flow never edits code (U3-14).

Amendment, 2026-10-07 (LOCAL-90): ship step 2 passes when the files of `git diff --name-only origin/main HEAD` are a subset of the files that the branch changed itself, and else stops at `checking` with the extra files in the reason (U3-14).

Amendment, 2026-10-07 (LOCAL-90): a stopped or done flow has no resume step, and a new `start_ship` call lists the branches that are still to ship (U3-14).

Amendment, 2026-10-07 (LOCAL-90): `start_ship` also answers 409 `no-workspace` and 409 `no-git-identity`, and 400 `invalid-branches` for a repeated branch name. An empty repository `checkCommand` skips step 3, and a stopped flow also sets `finishedAt` (U3-14).

### LOCAL-91

Change: the concurrency cap default is 3 (D-6). The policy has the `supervisor` field (an orchestrator needs it on), the `usageLimit` value `stop` and the `handoffHardPercent` field (D-6). An extra orchestrator override can only narrow the policy (D-7). Only the user answers a decision item, and the orchestrator never approves a permission prompt (D-9).

### LOCAL-92

Change: the attention queue also lists `permission_prompt`, and a `lost` or `shell_prompt` session whose resume failed (D-3). The dashboard reads the states of D-3, the progress of D-5 and the ship state of D-8.

### LOCAL-93

Confirmed. The removal note names `watch-loops.zsh`, `resume-loop.zsh`, `resume-after-reset.zsh`, `handoff-request.md` and the `keepawake` tmux session.

### LOCAL-95

Change: `start_ship` ships a group with no loop progress when its card is in Agent done, its branch is the session branch of the group, each branch is ahead of its base and the worktree is clean (D-10). D-8 keeps its text for a group with loop progress. The policy gets one more D-6 field, `groupPlaybook` (a playbook name or null, default null): only the user sets it, and `create_group` uses it when no `playbook` is given and that playbook exists. A policy save that omits `groupPlaybook` keeps the stored value, and a save with `groupPlaybook` null clears it.

### LOCAL-96

Change: a new event kind `group_state` tells the orchestrator about an important change of a group. The event has the group card as `cardId`, and its data is `{ state, reason }`. `state` is one of `agent_done`, `needs_input`, `start_failed`, `shipped`, `ship_stopped`, `loop_error` and `usage_limit`. The server writes it in four places: the `status_agent_done` and `status_needs_input` activity events of a group card, the end of a ship flow (`shipped` or `ship_stopped`), a failed group start, and a supervisor state change of a group card to `api_error`, `stale`, `lost` or `shell_prompt` (`loop_error`) or to `usage_limit_dialog` or `usage_limit_wait` (`usage_limit`). The orchestrator card and a ticket card never write it. A state that repeats the last `group_state` event of the same card, with no other `group_state` event of that card in between and no `supervisor_state` event of that card to `working` after it, is not written. `wait_for_event` takes the kind in `kinds`, and `list_events` returns it.

Change: the Board Orchestrator playbook step 7 tells the orchestrator to end every turn with `wait_for_event` on `decision_answered`, `group_state` and `intake_submitted` with `timeoutSeconds` 55, and a new line says that a message that starts with "Dispatch wake:" comes from Dispatch. The supervisor types that wake line into an idle orchestrator pane (see ARCHITECTURE, Orchestrator Session). Reason: in the G19 real run the orchestrator ended its turn after each action and slept until a person typed.

### LOCAL-97

Change: a new read tool, `get_board_workspace`, answers the folder of the board, its repositories with their base branch and check command, the playbook names and the group playbook. The `repos` input of `create_group` is now optional. When `repos` is omitted, the group uses every repository of the board with its base branch. A repository with no base branch answers 400 `missing-base` with its `path`. The default board stores no base branch, so its repositories answer base null; there the orchestrator passes `repos` with a base, for example a branch that it makes with `create_base_branch`. On the default board the workspace folders are its repositories for `create_group`, `create_base_branch` and `start_ship`. A board with no repository answers 400 `invalid-repos`. Both refusals come before any write. An explicit `repos` keeps its checks. The Board Orchestrator playbook tells the orchestrator to call `get_board_workspace` first, to omit `repos` and to ship a group in Agent done when its `shipRights` allow it. The tool count is 26.

Reason: in the G19 real run the orchestrator asked the user for a repository path and a base branch that the board already held.
