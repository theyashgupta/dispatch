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

**Evidence:** research section 2 (no board id exists; Inbox rows are items plus Inbox-column cards, `web/features/inbox/InboxView.tsx:110`; the snapshot is a "Do Not Change" contract); the group payload at H25:96-104.

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

| Duty                                                | Owner        | Trigger and rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Watch each live session                             | Supervisor   | One watcher per tmux session in one registry. A second start for the same session does nothing (F5). It extends the marker watcher tick.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Detect the state                                    | Supervisor   | States: `working`, `idle`, `needs_input`, `permission_prompt`, `handoff_ready`, `roadmap_complete`, `usage_limit_dialog`, `usage_limit_wait`, `api_error`, `stale`, `lost`, `shell_prompt`. Sources: the pane, the transcript growth and the engine file. A state that a pane text match finds is confirmed by a second source before an action, for example `handoff_ready` needs the engine file at `handoff-pending`. A question is `needs_input` with no marker: the last assistant message in the transcript ends with a question, or the pane shows a choice prompt (F1, F15, F20, F22, F24).                                                                                                                                                                                      |
| Idle                                                | Supervisor   | The pane is unchanged for two polls in a row (three equal reads 60 s apart, 120 s) while the pane shows no busy sign (`watch-loops.zsh` rule, F1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Stale                                               | Supervisor   | No transcript growth for 15 minutes while the state is `working` (F1, F8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Send input                                          | Supervisor   | One function: clear the input line, type the text with `send-keys -l`, wait 1.5 s, send `Enter` as a separate key, then find the text in the newest transcript. If it is not there, send `Enter` once more and check again. Then report `confirmed` or `unconfirmed`. While the session shows "warming up", it waits for the ready state for up to 60 s, else it reports `unconfirmed`. Text longer than 500 characters (half of the smallest size seen to fail, about 1000) goes to a file in the session folder, and the send is a one-line pointer to that file (F6, F14, F19).                                                                                                                                                                                                       |
| Restart a stopped loop                              | Supervisor   | A loop at `idle` with an active engine file, no marker and no question gets one continue prompt that points at its `progress.md` and `resume.md`. A second stop in the same phase becomes `needs_input`. A loop at `needs_input` gets no continue prompt; it goes to the orchestrator. A `lost` session (tmux gone) or a `shell_prompt` session (Claude exited and the pane is at a shell prompt, `paneAtPrompt`) is resumed through the resume saga with the loop `resume.md` prompt. If that resume fails, the session goes to the attention queue.                                                                                                                                                                                                                                    |
| Context handoff                                     | Supervisor   | At `handoffPercent` on the status line, send the handoff request; the loop hands off at its next phase boundary. At `handoffHardPercent`, if the loop has not handed off, send a hard request; the loop writes `progress.md` and hands off at once. Both thresholds use the stored status-line percent, never a self estimate (F4). On `handoff_ready` with the engine file at `handoff-pending`: clear, wait for ready, send the resume prompt (it restates the marker rule and tells the new session to write its own id into the engine file, as in the manual run, HR:5, RL:11), then confirm the new id in the engine file. Then cancel a repeated handoff request if one arrives. `request_handoff` from the orchestrator runs this duty now, below the threshold. (F4, F11, F20). |
| Usage limit                                         | Supervisor   | At the dialog, select the wait option. Usage credits are never selected. With `usageLimit` `stop` (D-6), mark the session `needs_input` and send nothing. With `wait`: if the engine file is `handoff-pending`, cancel the automatic continue once and resume a fresh session after the reset; else send one continue prompt at the reset time plus 2 minutes (F3, F10, F12). The account chain of LOCAL-94 plugs in at this step.                                                                                                                                                                                                                                                                                                                                                       |
| API error or a sleep cut                            | Supervisor   | One continue prompt, then `needs_input` (F2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Permission prompt                                   | Supervisor   | Decline the dangerous delete prompt and record the command. Deny the held peer message dialog and record it. Each other prompt becomes `permission_prompt` in the attention queue for the user (F8, F9, F18).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Keep the machine awake                              | Supervisor   | Hold one `caffeinate -is` child (the manual fix, H05:54) while at least one session runs; stop it when none runs; record a wake after a sleep (F2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Close a finished loop                               | Supervisor   | On `roadmap_complete`: the pane shows the completion promise and each unit row of the roadmap says `built, awaiting /ship`. If the engine file is still active, rename it to `.done` (F21). D-8 needs this before a ship. The group card stays in its column until the ship flow ends, because a move to Done starts the worktree cleanup timer.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PR and merge events                                 | Supervisor   | Watch the PRs of each group with `gh` and record state changes, including a merge that the user makes by hand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Dependency hold                                     | Supervisor   | A group with `dependsOn` (set by `create_group`) starts only after each named group is merged. The concurrency cap also applies (A15, F23).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Budget                                              | Supervisor   | When the cost of a group reaches `budgetPerGroup`, mark the session `needs_input` with the reason `budget` at the next gate event (A19).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Tickets, directions, base branches, groups          | Orchestrator | A1 to A4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Roadmap approval                                    | Orchestrator | Per the approval level of the policy (A5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Answers to loop questions and rulings on hard stops | Orchestrator | A6, A7. A ruling that changes the policy is a decision item for the user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| When to ship, and the PR text                       | Orchestrator | Starts the ship flow of D-8 with the title and body of each PR (A16).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Escalation                                          | Orchestrator | Creates a decision item when the policy or the playbook says a person decides.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

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

**Decision:** A board has at most one main orchestrator. The user can add extra orchestrators. An extra orchestrator needs a main orchestrator on the same board. The board row holds `orchestrators`: for each, an id, a main flag, a scope, a policy override and its session name. A group card holds `ownerOrchestrator`. Each extra has an explicit scope: a list of group ids or ticket ids. Each group has exactly one owner orchestrator. The main orchestrator owns each group that no extra owns. Only the user moves ownership. A tool call on a card outside the scope of the caller returns 403. Only the main orchestrator ships. The concurrency cap counts all loops on the board, from all orchestrators. An extra can have a policy override that only narrows the board policy. Narrow means a lower `concurrencyCap`, `budgetPerGroup` or `shipRights`, `ask` in place of `rules` or `all`, `rules` in place of `all`, and `stop` in place of `wait`. The model fields have no override. A decision item goes to the owner of its group and shows in the board attention queue. The user answers it, and the answer reaches the owner orchestrator as an event.

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

## Tool reference

LOCAL-90 adds the zod schema and the strict description of each tool here. Each tool calls one route under `/api/orchestrator/`. Each write is checked against the board scope, the owner scope (D-7) and the policy (D-6), and is recorded as an activity event.

| Family    | Tools                                                                                                          | Notes                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Read      | `list_cards`, `get_card`, `list_sessions`, `get_group_progress`, `read_pane_tail`, `list_events`, `get_policy` | `list_events` takes a `since` cursor                                                 |
| Tickets   | `create_ticket`, `update_ticket`, `move_card`, `add_comment`                                                   | `update_ticket` closes F25                                                           |
| Groups    | `create_base_branch`, `create_group`, `start_group`                                                            | `create_group` takes members, base, playbook, direction and `dependsOn`              |
| Sessions  | `send_input`, `approve_roadmap`, `request_handoff`, `resume_loop`, `stop_session`                              | `send_input` returns `confirmed` or `unconfirmed` (D-4); `resume_loop` per Key rules |
| Ship      | `start_ship`, `get_ship_state`                                                                                 | D-8                                                                                  |
| Decisions | `create_decision_item`                                                                                         | the user answers; the answer returns as an event                                     |
| Wait      | `wait_for_event`                                                                                               | blocks until an event matches a filter or a time limit passes                        |

## Scope changes

### LOCAL-84

Confirmed. Inputs from these records: the states of D-3, the policy fields of D-6, the decision items of D-3 and D-7, and the ship states of D-8.

### LOCAL-85

Change: inbox items get no board key (D-1). The counters stay in the global prefix map; there is no counter row per board (D-2). The board key is the board id. The board row holds the workspace root, the repositories, `linearTeamKeys` and the last used folder. The snapshot gains the board key, and the "Do Not Change" contract item 1 text changes in the same PR (D-1). Key validation includes known Linear team keys (D-2). The store keeps writing the legacy `localTicketCounter` and `groupTicketCounter` fields next to `identifierCounters` for the `LOCAL` and `GROUP` prefixes. `Config` keeps `workspaceRoot`, `repoPaths` and `baseBranches` as the source of the default board (D-1). The new fields follow contract item 1 (D-5).

### LOCAL-86

Change: the board scope is an optional `board` query parameter on collection routes; card routes look up the board key that is stored on the card; no parameter means the default board (D-4). The "Do Not Change" contract item 3 text gains the parameter. The Linear poller places cards by `linearTeamKeys` (D-1).

### LOCAL-87

Change: the Inbox page shows the global items plus the Inbox-column cards of the selected board (D-1). The board create and edit form has the `linearTeamKeys` field (D-1). The board shows a warning when a Linear team key equals its key (D-2). The edit form shows the key read-only (D-1). The edit form of the default board writes the `Config` fields through the config holder (D-1).

### LOCAL-88

Change: the report route only records a gate event and starts a new read; the reader is the one source of progress (D-5). The route uses the `x-dispatch-token` header of the session. The reader also reads each unit PRD for the phase count and names. One status-line parser on the marker watcher tick stores the meters on every session, whatever the `supervisor` value (D-5).

### LOCAL-89

Change: the code goes in the existing layers with the `supervisor-` prefix (D-3). The supervisor detects 12 states, not 10: the added states are `lost` (tmux gone) and `shell_prompt` (Claude exited) (D-3). It restarts a stopped loop: one continue prompt, then `needs_input`, and the resume saga for `lost` and `shell_prompt` (D-3). It holds a group until its dependencies merge, and it stops a group at its budget (D-3). It adds `crossSessionInbound: refuse` to the generated hook settings (A27, F9). It extends the ARCHITECTURE section "Tmux Invocations" and the SHELL-01 entry of `code-review-rules.md` for the new typed surface. It watches PR and merge events, and it closes a finished loop (D-3). The send function writes text longer than 500 characters to a file and sends a one-line pointer (D-3). Fixed values, not policy fields: idle after the pane is unchanged for two polls in a row, 60 s apart (120 s), stale after 15 minutes with no transcript growth, one continue prompt after an API error (D-3). At a usage limit with `handoff-pending`, the supervisor cancels the automatic continue and resumes a fresh session (D-3). At the usage limit dialog the supervisor always selects the wait option. The `stop` policy then marks the session `needs_input` (D-3, D-6). Prompts other than the dangerous delete and the peer message go to the user (D-3). The send function keeps the tmux argv of "Do Not Change" contract item 5. The default board starts with the supervisor off (D-6).

### LOCAL-90

Change: the tool reference lives in this document (Tool reference). The PR title and body come from the orchestrator (D-8). The events route gains a `since` cursor for `list_events` and `wait_for_event` (D-4). The MCP server is the `dispatch mcp` subcommand (D-4). With `open_prs` rights, the ship flow waits for the user to merge each PR before the next branch (D-8). `create_decision_item` is a tool (D-3). `stop_session` interrupts the turn and leaves the process alive (D-4). `move_card` rejects a move to Done for a card that the orchestrator did not create (D-9).

### LOCAL-91

Change: the concurrency cap default is 3 (D-6). The policy has the `supervisor` field (an orchestrator needs it on), the `usageLimit` value `stop` and the `handoffHardPercent` field (D-6). An extra orchestrator override can only narrow the policy (D-7). Only the user answers a decision item, and the orchestrator never approves a permission prompt (D-9).

### LOCAL-92

Change: the attention queue also lists `permission_prompt`, and a `lost` or `shell_prompt` session whose resume failed (D-3). The dashboard reads the states of D-3, the progress of D-5 and the ship state of D-8.

### LOCAL-93

Confirmed. The removal note names `watch-loops.zsh`, `resume-loop.zsh`, `resume-after-reset.zsh`, `handoff-request.md` and the `keepawake` tmux session.
