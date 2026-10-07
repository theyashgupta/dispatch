# Orchestration Research Record

Date: 2026-10-05. Ticket: LOCAL-83. Decisions that use this record: `docs/standards/orchestration-design.md`.

This record has three parts. Part one states what Dispatch does today. Part two analyses the manual orchestration run of 2026-09-25 to 2026-10-05. Part three surveys 17 products that run more than one coding agent. The record ends with a comparison, the patterns to copy, the pitfalls, and the dashboard content in order of use.

## 1. Scope and sources

- Code facts come from the tree at commit `3912003` (origin/main at the start of 2026-10-05; main gained v4.1.0, #185, later that day). Paths in section 2 are relative to `src/`.
- Manual run facts come from files outside the repo. `W` is `/Users/yash/dispatch-workspaces`. `M` is the memory folder of the orchestrator session, `~/.claude/projects/-Users-yash-dispatch-workspaces-LOCAL-22/memory`. Each citation is `<code>:<line>` with the codes below. Each cited line was read again on 2026-10-05.
- Product facts come from public pages. Each link was opened on 2026-10-05 and answered with HTTP 2xx or 3xx. A field with no public source says "not found": the search found no public page that states it.
- The research record of 2026-10-02 (`W/research/orchestration-initiative-research.md`, code RES) is the start point. This record checks and extends it.

| Code | File                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------- |
| H25  | `W/LOCAL-22/2026-09-25-local-22-group-loops-session-handoff.md`                                   |
| H29  | `W/LOCAL-22/2026-09-29-local-22-releases-and-ui-revamp-session-handoff.md`                        |
| H30  | `W/LOCAL-22/2026-09-30-local-22-shadcn-migration-orchestration-session-handoff.md`                |
| H05  | `W/LOCAL-22/2026-10-05-local-22-orchestration-session-handoff.md`                                 |
| WL   | `W/watch-loops.zsh`                                                                               |
| RL   | `W/resume-loop.zsh`                                                                               |
| RR   | `W/resume-after-reset.zsh`                                                                        |
| HR   | `W/handoff-request.md`                                                                            |
| SI   | `W/GROUP-12/.roadmap/g11-skeleton/ship-instructions.md` (GROUP-10, 11 and 13 have the same steps) |
| P12  | `W/GROUP-12/.roadmap/g11-skeleton/progress.md`                                                    |
| P13  | `W/GROUP-13/.roadmap/g12-modules-a/progress.md`                                                   |
| P14  | `W/GROUP-14/.roadmap/g13-modules-b/progress.md`                                                   |
| RES  | `W/research/orchestration-initiative-research.md`                                                 |
| MI   | `M/watch-loop-idleness.md`                                                                        |
| MS   | `M/mac-idle-sleep-keepawake.md`                                                                   |
| MT   | `M/tmux-submit-pending-text.md`                                                                   |
| MC   | `M/usage-cache-miss-after-cap.md`                                                                 |
| MH   | `M/loop-context-handoff.md`                                                                       |
| GSP  | `M/group-ship-pattern.md`                                                                         |
| FLS  | `M/feedback-loop-speed-and-cost.md`                                                               |
| CSP  | `M/cross-session-peer-messages.md`                                                                |
| UR   | `M/ui-revamp-group.md`                                                                            |
| SMI  | `M/shadcn-migration-initiative.md`                                                                |

## 2. Dispatch today

| Fact                                                                                                                                                                                                                                                                                           | Verdict on the research record | Source                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No table or type has a board id or a project id.                                                                                                                                                                                                                                               | Confirmed                      | no hit for `board_id`, `boardId`, `projectId` in `server/` and `shared/`                                                                                                                          |
| The SQLite tables are cards, meta (one row), events, archive, push_subscriptions and items.                                                                                                                                                                                                    | Confirmed                      | `server/store/board-db.ts:475-512`                                                                                                                                                                |
| Identifier counters are a map keyed by prefix in the one meta row. `nextIdentifier(prefix)` mints `<prefix>-<n>`. A new prefix needs no schema change.                                                                                                                                         | Refined                        | `server/store/board-db.ts:78`, `server/store/board.store.ts:966-970`                                                                                                                              |
| A card id is its identifier. A Linear card uses the Linear identifier, which starts with the Linear team key.                                                                                                                                                                                  | Confirmed                      | `server/store/board.store.ts:3853`, `server/sources/linear/linear.source.ts:64`, `:300`                                                                                                           |
| A group is known by `card.source === "group"`, not by its id prefix.                                                                                                                                                                                                                           | New                            | `server/services/infra/kickoff.ts:257`                                                                                                                                                            |
| One session name drives the tmux name (`dsp-<name>`), the branch and the worktree folder. The first session name is the card identifier. A second session is `<identifier>-<ordinal>`.                                                                                                         | Confirmed                      | `server/services/orchestration/steps.ts:108-112`, `server/services/orchestration/start-session.ts:152`, `:173-174`                                                                                |
| Five validators accept an identifier only in the form `^[A-Za-z0-9]+-\d+$` (one hyphen, then digits).                                                                                                                                                                                          | New                            | `server/services/orchestration/steps.ts:56`, `:192`; `server/routes/cards.route.ts:253`, `:310`, `:344`; `server/services/orchestration/linear-sync.ts:26`                                        |
| An instance whose data folder is not `~/.dispatch` uses a private tmux server.                                                                                                                                                                                                                 | New                            | `server/adapters/tmux.ts:17-25`                                                                                                                                                                   |
| Config has one `workspaceRoot` and one `repoPaths` list.                                                                                                                                                                                                                                       | Confirmed                      | `shared/types.ts:1230`, `:1232`                                                                                                                                                                   |
| `GET /board` and the `/stream` SSE send the board snapshot, with the Done column limited by `doneLimit`.                                                                                                                                                                                       | Confirmed                      | `server/routes/board.route.ts:70`, `server/routes/sse.route.ts:80`, `:135`                                                                                                                        |
| No route lists cards or sessions with a column, session or board filter; `GET /search` matches text only. `GET /events` has `cardId` and `limit` but no cursor.                                                                                                                                | Refined                        | `server/routes/cards.route.ts:173`, `server/routes/events.route.ts:26-40`, `server/routes/board.route.ts:86`                                                                                      |
| `POST /cards/group` validates the members, creates the group card and starts the session.                                                                                                                                                                                                      | Confirmed                      | `server/routes/cards.route.ts:590`                                                                                                                                                                |
| Session status comes from the `DISPATCH_STATUS` marker in the pane and from Claude hooks. The marker watcher reads the pane but has no idle, stale or usage limit state.                                                                                                                       | Confirmed                      | `server/adapters/markers/watcher.ts:150`, `server/routes/hooks.route.ts:32-46`                                                                                                                    |
| The tmux adapter can send keys and paste text. The start saga uses it to answer the trust, bypass and resume dialogs and to type the launch line. `POST /cards/:id/run-claude` types the same fixed launch line into an idle shell pane. No route sends free text to a running Claude session. | Refined                        | `server/adapters/tmux.ts:518-593`, `server/services/orchestration/steps.ts:387-408`, `:570-572`, `:630-631`, `server/services/orchestration/run-claude.ts:59`, `server/routes/cards.route.ts:352` |
| A session gets `DISPATCH_HOOK_PORT`, `DISPATCH_HOOK_TOKEN` and `DISPATCH_CARD_ID`. The hook route reads the token from the `x-dispatch-token` header.                                                                                                                                          | New                            | `server/services/domain/claude-launch.ts:32-34`, `server/bootstrap/hook-setup.ts:35-42`, `server/services/orchestration/hook-tokens.ts:46`, `:82`                                                 |
| Inbox rows are the global items plus the cards in the Inbox column that are not group members.                                                                                                                                                                                                 | New                            | `web/features/inbox/InboxView.tsx:110`, `web/features/board/inbox-count.ts:12-21`                                                                                                                 |
| The package has one bin, `dispatch`.                                                                                                                                                                                                                                                           | New                            | `package.json:36-37`                                                                                                                                                                              |
| The usage poll exists. No code detects the usage limit dialog. No code keeps the machine awake. No MCP server exists for an agent.                                                                                                                                                             | Confirmed                      | `server/adapters/claude-usage.ts:76`; no hit for `caffeinate`, `pmset` or an orchestrator MCP server                                                                                              |
| The word "orchestration" names the session start saga today.                                                                                                                                                                                                                                   | New                            | `server/services/orchestration/`, `docs/ARCHITECTURE.md` "Orchestration Saga"                                                                                                                     |
| `BoardSnapshot` is the SSE payload and the on-disk shape. It is a "Do Not Change" contract.                                                                                                                                                                                                    | New                            | `docs/ARCHITECTURE.md` "Do Not Change Contracts", item 1                                                                                                                                          |

Loop progress exists only in files that the loop session writes. The layout of the GROUP-14 run:

- The roadmap: `<session root>/ROADMAP.md`. Each unit has a `Status:` line that starts with one of a fixed set of values, and free text can follow.
- The ledger: `<session root>/.roadmap/<slug>/progress.md`, with `decisions.md`, `changed-decisions.md`, `todo.md` and `resume.md`.
- The engine file: `<session root>/.claude/ralph-loop.local.md`, with the fields `active`, `iteration`, `session_id` (`handoff-pending` during a handoff), `max_iterations`, `completion_promise` and `started_at`.
- The phase files: `<session root>/<repo>/.planning/<slug>-unit-<n>/state.md` (one `phase <N> <name> GREEN <time> gate=pass` line per green phase) and `attempts.md` (one `phase <N> RED attempt <k> <time>` line per failed attempt).
- The PRDs: `<session root>/<repo>/.planning/prds/<slug>-unit-<n>.md`. Each `### Phase <N>:` heading is one phase.

## 3. The manual run

From 2026-09-25 to 2026-10-05 one Claude session (LOCAL-22) ran 16 group loops by hand. It filed 71 tickets. Main holds 64 squash PRs in the range #120 to #184 (#168 is not on main): 60 PRs for 13 groups, 2 PRs for LOCAL-54 (#161, #162) and 2 release PRs (#159, #160).

### 3.1 Actions

| ID  | Action                                                                                         | How often (basis)                                                                                                                      | Judgment                                                   | Source                                    |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| A1  | Write and file tickets on the board (`POST /api/cards`)                                        | 71 tickets: LOCAL-23 to 53, LOCAL-55 to 61, LOCAL-62 to 79, LOCAL-80 to 94                                                             | Yes: scope, cut and wording                                | H25:29, UR:12, H30:3, H05:25              |
| A2  | Write a direction for each group                                                               | At least 10: six files in the research folder (g10, g11, g12, g13, g15, g16), plus G3, G4, G8 and G9                                   | Yes: rules and order per group                             | H25:32, SMI:26, H05:26                    |
| A3  | Cut a base branch for a group that stacks on unshipped work                                    | Several, from G6 on (for example `base/g6-g2-plus-g4u1`, `base/g13`)                                                                   | Yes: which commit to stack on                              | H29:12, H30:37                            |
| A4  | Create and start a group (`POST /api/cards/group`)                                             | 16 group cards, GROUP-1 to GROUP-16                                                                                                    | No, after A2 and A3                                        | H25:96, H30:37                            |
| A5  | Review and approve a roadmap                                                                   | About one per group; the user approved some roadmaps directly                                                                          | Yes: unit order and scope drift                            | H25:39, H30:35, H05:32, P14:71            |
| A6  | Answer a grill question with the standing rule                                                 | Each time a loop asks                                                                                                                  | No: a fixed rule                                           | H25:40                                    |
| A7  | Rule on a hard stop of a loop                                                                  | 5 rulings in GROUP-14 (option A, R-25 to R-28)                                                                                         | Yes: policy for the loop                                   | P14:88, P14:92, P14:100, P14:102, P14:104 |
| A8  | Request a context handoff                                                                      | About once per long session, at 72 percent and later 50 percent; loops also handed off on their own (F4, P13:42)                       | No: a threshold on the status line                         | H30:33, H05:43, H05:52, P14:84            |
| A9  | Resume a released loop on a fresh session                                                      | Once per handoff                                                                                                                       | No: a script                                               | RL:8, RL:9, RL:11, H05:52                 |
| A10 | Resume loops after a usage limit                                                               | At least 5 usage limit stops in GROUP-13 and GROUP-14 (P13:52, P13:66, P14:78, P14:90, P14:109)                                        | No, except "never pick usage credits"                      | RR:2, RR:34, P13:52, P14:78               |
| A11 | Keep the Mac awake while loops run                                                             | Always, since 2026-10-01                                                                                                               | No                                                         | H05:27, H05:54                            |
| A12 | Watch the loops (pane, board, PRs)                                                             | Continuous; the Monitor is re-armed every 30 minutes                                                                                   | No                                                         | H30:31, H25:82                            |
| A13 | Decline the dangerous delete prompt and deny the held peer message                             | Each time it appears                                                                                                                   | No                                                         | WL:16, WL:23, H30:38                      |
| A14 | Send a line to a loop and confirm it in the transcript                                         | Many times per day                                                                                                                     | No                                                         | H05:51                                    |
| A15 | Wait for a dependency (a branch commit), then continue the loop                                | G5 to G7 after G4 Unit 1; G12 after the G11 router                                                                                     | No: a condition check                                      | H25:41, H30:51                            |
| A16 | Ship a group: one squash PR per unit branch in stack order                                     | 13 groups, PRs 120 to 184; for G2 to G8 the plan was that the user runs `/ship` or asks the orchestrator; ship files exist from G10 on | Partly: a merge conflict that needs judgment stops the run | H25:42, H30:36, SI:3, SI:24               |
| A17 | Check the author identity after each merge                                                     | After every squash merge                                                                                                               | No                                                         | SI:21, WL:49                              |
| A18 | Close a group: card to Done, engine file renamed to `.done`                                    | Once per shipped group                                                                                                                 | No                                                         | H30:36, H05:14                            |
| A19 | Park a loop to save weekly usage                                                               | Once (GROUP-14 at 96 percent weekly usage)                                                                                             | Yes: budget priority                                       | P14:123                                   |
| A20 | Set the run policy: model, concurrency cap, handoff threshold, usage rule                      | At least 5 changes: model by claudeArgs, cap 2 then 3, handoff 72 then 50 percent, the usage wrap-up rule                              | Yes: user rules                                            | H30:23, H30:24, H05:42, H05:43, P14:113   |
| A21 | Report time and spend per unit to the user                                                     | Per finished unit                                                                                                                      | No                                                         | H30:54                                    |
| A22 | Cancel a repeated handoff request in the new session                                           | After each resume, when it appears                                                                                                     | No                                                         | MH:27, H05:77                             |
| A23 | Accept a permission prompt after a check of its targets                                        | When a subagent chains `cd`, an edit and `rm -rf` on its own folders                                                                   | Yes: are the targets safe                                  | H05:79                                    |
| A24 | Cut releases (v3.8.0 and v4.0.0)                                                               | 2 releases in the tree at `3912003`; v4.1.0 followed                                                                                   | Yes: the release split                                     | H30:46, H29:79                            |
| A25 | Edit skills and agent definitions to change the loop behaviour                                 | Several on 2026-09-30                                                                                                                  | Yes: process design                                        | H30:25                                    |
| A26 | Copy rulings across groups and into new directions                                             | Each new ruling                                                                                                                        | No                                                         | H05:28                                    |
| A27 | Configure the environment for loops: refuse cross-session messages, add the `.roadmap` symlink | Once each                                                                                                                              | No                                                         | H30:26, H30:33                            |

Ten of 27 actions need judgment (A1, A2, A3, A5, A7, A19, A20, A23, A24, A25), and A16 needs it only on a conflict. The other 16 are deterministic. The design moves the deterministic actions that need no orchestrator call to server code (D-3).

### 3.2 Failures

| ID  | What happened                                                                                                         | Cause                                                                                                      | Requirement                                                                | Source                | Research item                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| F1  | The G2 ship run stopped on a question with no status marker, and the orchestrator did not see it for about 30 minutes | The monitor read only the board marker (root: F20)                                                         | Detect idle from the pane, not only from markers                           | MI:10                 | 1, Confirmed                                                                   |
| F2  | The Mac slept twice in one hour (08:50 and 10:07 IST) and cut GROUP-12 and GROUP-13 in the middle of a turn           | System sleep is 1 minute; only short `caffeinate` timers held it off                                       | Hold a power assertion while a session runs                                | MS:8, H05:54          | 2, Confirmed                                                                   |
| F3  | Two group sessions stayed at the usage limit dialog for 8 hours after the login changed                               | No actor answers the dialog; the login changed outside Dispatch                                            | Detect the limit dialog, wait for the reset, then continue                 | RES:12                | 3, reported by the orchestrator, no file record beyond the research record     |
| F4  | GROUP-13 handed off at 38 percent context on a wrong 116 percent estimate                                             | The loop's own context estimator over-reads                                                                | Read the context percent from the status line, never from a self estimate  | P13:7, P13:42         | 4, Confirmed                                                                   |
| F5  | Two watchers ran at the same time and sent each event twice                                                           | Two watcher processes for the same sessions                                                                | One watcher per session                                                    | RES:53                | 5, reported by the orchestrator, no file record beyond the research record     |
| F6  | Text typed into a loop sat in the input and was not submitted                                                         | Claude Code treats injected text as a paste; a later lone Enter does not submit                            | Clear, type, submit after a delay, confirm in the transcript, retry once   | MT:13, H30:32         | 6, Confirmed                                                                   |
| F7  | A loop's 2 hour poll hit the background time limit, and waits across a usage reset needed a detached tmux script      | A background shell has a 2 hour limit                                                                      | Waits belong to the server, not to a model shell                           | P13:32, H05:53        | 7, Refined: the limit hit a loop poll; the orchestrator used a detached script |
| F8  | Two review agents sat 51 minutes behind a hidden dangerous delete prompt                                              | The guard prompts even in bypass mode, and the agent row made the pane look busy                           | Detect a permission prompt as its own state                                | H29:71, MI:14         | new                                                                            |
| F9  | A held peer message dialog stopped loops and once swallowed a roadmap approval                                        | The claude-mem observer sent cross-session messages                                                        | Deny the dialog automatically and record it                                | H30:26, WL:16, CSP:12 | new                                                                            |
| F10 | After each 5-hour reset the meter jumped 10 to 14 percent in three minutes                                            | Loops auto-continued sessions of 400k to 740k tokens with an expired prompt cache                          | At a limit, release the session and resume fresh after the reset           | MC:8                  | new                                                                            |
| F11 | A handoff request queued while a loop was busy reached the new session after the resume                               | The input queue survives the clear                                                                         | Confirm or cancel queued input after a resume                              | MH:27, H05:77         | new                                                                            |
| F12 | The reset script sent Escape every 30 seconds for an hour                                                             | The cancelled auto-continue text stayed on screen                                                          | Act once per state change, not per poll                                    | H05:78                | new                                                                            |
| F13 | A Sonnet implementer died on the usage limit with partial edits in the tree                                           | The limit stops subagents too                                                                              | After a limit, check the working tree before a re-dispatch                 | P14:74, P13:40        | new                                                                            |
| F14 | A fresh session drops keys while its status bar says "warming up"                                                     | Input is not ready at start                                                                                | Wait for the ready state before a send                                     | H29:66, RL:10         | new                                                                            |
| F15 | The board showed a stale `lastMarker` after a loop resumed                                                            | The marker keeps the last text until the session prints a new one, and a cleared session prints none (F20) | Use typed states, not the last marker text                                 | H25:81, H25:38, MH:20 | new                                                                            |
| F16 | The Monitor tool expires after 30 minutes and must be re-armed                                                        | Tool limit of the orchestrator session                                                                     | The orchestrator waits on server events with no expiry                     | H25:82                | new                                                                            |
| F17 | Every squash merge needed `--admin`                                                                                   | The branch policy requires signatures that agents cannot make                                              | The ship flow handles the signature block and records it                   | H05:80                | new                                                                            |
| F18 | Loops stalled on permission prompts when a subagent chained `cd`, an edit and `rm -rf`                                | The dangerous delete guard prompts even in bypass mode                                                     | Detect the prompt; brief subagents to use a reset script                   | H05:79, MI:14         | new                                                                            |
| F19 | A long ship instruction (about 1000 characters) never reached the transcript                                          | Claude Code drops long injected text entirely                                                              | Send long text as a file and a one-line pointer; confirm in the transcript | MH:10, H29:65         | new                                                                            |
| F20 | After a `/clear`, sessions emitted no status markers, so their stops never reached the board                          | `/clear` drops the playbook copy of the marker rule                                                        | Detect states from the pane; each resume prompt restates the marker rule   | MH:20, HR:12          | new                                                                            |
| F21 | After ROADMAP COMPLETE the live engine file re-injected the roadmap prompt after every ship turn (G3, G4, G8)         | The engine file stayed active                                                                              | Close the engine file when a loop completes, before the ship flow          | GSP:16                | new                                                                            |
| F22 | The watcher reported HANDOFF-READY when a pane only quoted the word                                                   | A text match on the pane                                                                                   | Confirm a state with a second source (the engine file)                     | H05:50                | new                                                                            |
| F23 | Three loops at once gave load 9 to 10, test timeouts and RED retries; one loop idled 4 hours on a dependency          | 8 GB of RAM; a group waited on another group                                                               | A concurrency cap, and dependency order before start                       | FLS:11, FLS:8         | new                                                                            |
| F24 | A busy check in a monitor script never matched                                                                        | The shell `grep` is a ugrep wrapper that returns nothing on these patterns                                 | Detection runs in server code, not in shell scripts                        | MI:12, H29:67         | new                                                                            |
| F25 | The board API cannot edit a filed ticket, and it rejects text that contains the status marker                         | No edit route; marker text guard                                                                           | A tool to update a ticket; text checks that name the reason                | H05:56                | new                                                                            |

### 3.3 The ship flow as practised

1. Precondition: every earlier group is on main; no open PR except dependabot. The stack sits on unsquashed commits of the earlier group, so each branch merges origin/main against the old stack tip, and git takes the side of main for those files (SI:12).
2. For each branch in stack order (unit branches, then the specs branch): check it out and merge origin/main, never rebase; on a shared file conflict take the structure of main and re-apply the change (SI:16).
3. Confirm `git diff origin/main...HEAD` holds only this unit, and that no added line in docs, src, scripts, `.claude` and `CLAUDE.md` has an em dash or a double hyphen in prose (SI:17).
4. Run `env -u NODE_ENV npm run check` (SI:18).
5. Run `/ship` to push and open the PR with the What/Why/How description (SI:19).
6. Mark it ready and squash merge with the subject `<PR title> (#<n>)` and an empty body; add `--admin` when the signature rule blocks (SI:20).
7. Fetch and check that the author of the main tip is the canonical identity with no Co-Authored-By line (SI:21).
8. Stop on a failed check, a conflict that needs judgment or a failed identity check (SI:24). The ship session applies the known fixes (knip tags, spec copies, CodeQL patterns, a flaky test rerun) without a stop (SI:28 to SI:32).

## 4. Product survey

Fields per tool: hierarchy, lead agent and its tools, human approval points, progress views, ordering rules, stale or idle detection, concurrency limits, stacked branches or PRs, reported problems. A field with no public source says "not found".

### Claude Code agent view

- **Hierarchy:** a flat list of background sessions. Subagents and teammates are not rows. A supervisor service keeps a roster file and one state file per session (https://code.claude.com/docs/en/agent-view).
- **Lead agent:** not found. Each session is independent (https://code.claude.com/docs/en/agent-view).
- **Approval points:** a session that waits on a permission, a question or a dialog shows "Needs input". You can peek and reply; a reply to a working session joins its queue. Claude never pushes to main, force-pushes or merges (https://code.claude.com/docs/en/agent-view).
- **Progress views:** states Working, Needs input, Idle, Completed, Failed, Stopped. Groups Pinned, Ready for review, Needs input, Working, Completed. A small model rewrites each row summary at most every 15 seconds. PR labels show check, review and merge state by colour (https://code.claude.com/docs/en/agent-view).
- **Ordering:** not found. Each session that edits files gets its own worktree (https://code.claude.com/docs/en/agent-view).
- **Stale detection:** an unattached finished or waiting session stops after about an hour and resumes on reply. After a shutdown, sessions show as failed. Stuck-while-working detection: not found (https://code.claude.com/docs/en/agent-view).
- **Concurrency:** no cap. Ten agents use quota about ten times as fast (https://code.claude.com/docs/en/agent-view).
- **Stacked PRs:** not found. New worktrees branch from the default branch unless `worktree.baseRef` changes it (https://code.claude.com/docs/en/worktrees).
- **Problems:** research preview, local only, worktrees deleted with the session (https://code.claude.com/docs/en/agent-view). An attach sent "continue", which Claude read as an answer (https://github.com/anthropics/claude-code/issues/58259). An attach to an idle session crashed the worker (https://github.com/anthropics/claude-code/issues/73754).

### Claude Code agent teams

- **Hierarchy:** one team per session: a fixed lead, teammates, a shared task list and one mailbox per agent. No nested teams (https://code.claude.com/docs/en/agent-teams).
- **Lead agent:** the lead spawns teammates with the Agent tool, messages them with SendMessage, creates and assigns tasks. Experimental, off by default (https://code.claude.com/docs/en/agent-teams).
- **Approval points:** teammate permission prompts appear in the lead session. Claude Code approves a plan from a teammate in the lead session, without the lead reviewing it. A teammate launch needs no confirmation. Hooks TeammateIdle, TaskCreated and TaskCompleted can block (https://code.claude.com/docs/en/agent-teams).
- **Progress views:** an agent panel, a task list with pending, in progress and completed, and split panes (https://code.claude.com/docs/en/agent-teams).
- **Ordering:** tasks can depend on tasks. A blocked task cannot be claimed. Completion unblocks dependents (https://code.claude.com/docs/en/agent-teams).
- **Stale detection:** an idle or failed teammate notifies the lead. No stuck detection; task status can lag (https://code.claude.com/docs/en/agent-teams).
- **Concurrency:** no hard cap; start with 3 to 5 teammates (https://code.claude.com/docs/en/agent-teams).
- **Stacked PRs:** not found. Teammates share one checkout (https://code.claude.com/docs/en/agents).
- **Problems:** no teammate restore on resume, task status lag, slow shutdown, and "the lead may finish early or start implementing tasks itself" (https://code.claude.com/docs/en/agent-teams). A message to a busy teammate arrives only after its turn (https://github.com/anthropics/claude-code/issues/98998). One spawn made up to 151 duplicate teammates (https://github.com/anthropics/claude-code/issues/55586).

### Claude Projects

- **Hierarchy:** in claude.ai, a project holds chats, a knowledge base and instructions (https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects). In Claude Code (public beta), a project is one coordinating conversation plus the threads it starts; each thread is a session on its own branch (https://code.claude.com/docs/en/claude-projects).
- **Lead agent:** the project conversation decides what becomes a thread and sees what threads report. Thread actions include Resolve conflicts, Fix CI, Merge it and Create PR (https://code.claude.com/docs/en/claude-projects).
- **Approval points:** a thread that needs approval waits inside that thread. You can tell the coordinator to propose threads first or to run only a few; these are preferences, not settings (https://code.claude.com/docs/en/claude-projects).
- **Progress views:** groups Ready for review, Waiting on you (failed threads included), Working, Landing, Idle, Resolved. Desktop notifications on a post, an error or a need for input (https://code.claude.com/docs/en/claude-projects).
- **Ordering:** threads run in parallel. Dependency rules: not found (https://code.claude.com/docs/en/claude-projects).
- **Stale detection:** a thread with no activity for a week becomes Resolved. An idle thread wakes on a CI failure or a review comment (https://code.claude.com/docs/en/claude-projects).
- **Concurrency:** no fixed cap; 200 new threads per day. A thread at the usage limit waits and continues after the reset (https://code.claude.com/docs/en/claude-projects).
- **Stacked PRs:** not found. Threads branch from the default branch (https://code.claude.com/docs/en/claude-projects).
- **Problems:** one owner per project, a local session cannot be added to a project, two local threads in one folder can overwrite each other, a cloud sandbox can lose uncommitted work (https://code.claude.com/docs/en/claude-projects).

### Claude Agent SDK

- **Hierarchy:** a session is the stored conversation. Subagents are child agents with their own context; only the final message returns. Default nesting depth 3 (https://code.claude.com/docs/en/agent-sdk/subagents, https://code.claude.com/docs/en/agent-sdk/sessions).
- **Lead agent:** the main agent spawns subagents through the Agent tool and can resume one by its id. For many agents, a Workflow tool moves the orchestration into a script (https://code.claude.com/docs/en/agent-sdk/subagents).
- **Approval points:** tools in `allowedTools` run with no prompt (https://code.claude.com/docs/en/agent-sdk/subagents). Background subagent prompts surface in the main session (https://code.claude.com/docs/en/sub-agents).
- **Progress views:** no UI. Message types `task_started`, `task_progress`, `task_notification`; `listSessions` and `getSessionInfo` (https://code.claude.com/docs/en/agent-sdk/typescript, https://code.claude.com/docs/en/agent-sdk/sessions).
- **Ordering:** Claude decides. Subagents run in the background by default. A dependency graph: not found (https://code.claude.com/docs/en/agent-sdk/subagents).
- **Stale detection:** not found. Guards are `maxTurns` and `maxBudgetUsd` (https://code.claude.com/docs/en/agent-sdk/subagents). A background subagent stalled with no notice (https://github.com/anthropics/claude-code/issues/98846).
- **Concurrency:** `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` defaults to 20; spawn depth defaults to 3 (https://code.claude.com/docs/en/agent-sdk/subagents).
- **Stacked PRs:** not found. A subagent worktree branches from the default branch (https://code.claude.com/docs/en/worktrees).
- **Problems:** session files are local to one machine (https://code.claude.com/docs/en/agent-sdk/sessions). Ten background tasks stuck "Running" for 34 hours (https://github.com/anthropics/claude-code/issues/75314). Nested agents looped for 6.5 hours and could not be stopped (https://github.com/anthropics/claude-code/issues/73829).

### Factory Missions

- **Hierarchy:** a mission holds features in milestones. Workers run features; validation workers run at the end of each milestone (https://docs.factory.com/missions/overview, https://docs.factory.com/missions/planning).
- **Lead agent:** an orchestrator you can talk to (https://docs.factory.com/missions/overview). It can add fix features during a run (https://docs.factory.com/missions/planning). Its tool list: not found (https://docs.factory.com/missions/reference).
- **Approval points:** the user approves the plan before the run. During the run you can pause the orchestrator, ask it to re-plan and resume (https://docs.factory.com/missions/overview, https://docs.factory.com/missions/running-app).
- **Progress views:** a live log of each worker and milestone, elapsed time and credits (https://docs.factory.com/missions/running-app). Named states: not found.
- **Ordering:** planning fixes the features, the order, the milestones and the validation (https://docs.factory.com/missions/planning).
- **Stale detection:** no detector. The user pauses the orchestrator and asks it to recover (https://docs.factory.com/missions/overview).
- **Concurrency:** not found.
- **Stacked PRs:** not found.
- **Problems:** error accumulation in long plans is open; heavy local stacks slow the mission (https://docs.factory.com/missions/overview, https://docs.factory.com/missions/planning).

### Devin managed sessions

- **Hierarchy:** a parent session coordinates child sessions, each in its own VM. The API has `parent_session_id` and `child_session_ids` (https://docs.devin.ai/work-with-devin/advanced-capabilities, https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions).
- **Lead agent:** the coordinator launches children with prompts, playbooks and compute limits, messages them, tracks the compute of each, stops stuck children and sets reminders to check back (https://docs.devin.ai/work-with-devin/advanced-capabilities). It can read the full trajectory of a child (https://cognition.com/blog/devin-can-now-manage-devins).
- **Approval points:** "Auto-approve child sessions" is on by default; off, you review each batch before launch (https://docs.devin.ai/work-with-devin/advanced-capabilities).
- **Progress views:** session status new, claimed, running, exit, error, suspended, resuming; while running: working, waiting_for_user, waiting_for_approval, finished (https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions). The sidebar groups Working, Ready, Blocked, Inactive (https://docs.devin.ai/release-notes/2026).
- **Ordering:** not found for managed sessions. Dynamic workflows have `parallel` and `pipeline` (https://docs.devin.ai/work-with-devin/dynamic-workflows).
- **Stale detection:** a session sleeps after 30 minutes of inactivity (https://docs.devin.ai/admin/billing/usage); a suspended session carries a reason (https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions). No automatic stuck-child detector.
- **Concurrency:** depends on the plan, numbers not given (https://docs.devin.ai/admin/billing/usage); a per-session compute limit exists (https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions).
- **Stacked PRs:** not found. Archiving a parent closes the open PRs of its children (https://docs.devin.ai/release-notes/2026).
- **Problems:** a vendor note asks users to report a session "stuck on the same action" (https://docs.devin.ai/release-notes/2024).

### GitHub Copilot mission control

- **Hierarchy:** one task works in one repository on one branch and opens one PR. No parent and child agents (https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent).
- **Lead agent:** not found; one agent per task (https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent).
- **Approval points:** you can steer a session (https://github.blog/changelog/2025-10-28-a-mission-control-to-assign-steer-and-track-copilot-coding-agent-tasks/) or stop it (https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/track-copilot-sessions); you review and merge the PR (https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management).
- **Progress views:** a session log with progress, token use and length; states active and stopped (https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/track-copilot-sessions).
- **Ordering:** not found for separate tasks. The Copilot app has stacked sessions where each builds on the last (https://github.blog/ai-and-ml/github-copilot/stacked-sessions-and-pull-requests-in-the-github-copilot-app/).
- **Stale detection:** not found; a hard 59 minute limit per session (https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent).
- **Concurrency:** no cap stated (https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management).
- **Stacked PRs:** in the Copilot app, each PR targets the branch of the PR below it (https://github.blog/ai-and-ml/github-copilot/stacked-sessions-and-pull-requests-in-the-github-copilot-app/).
- **Problems:** sessions blocked by a ruleset stay Queued with no cancel (https://github.com/orgs/community/discussions/188644). The agent times out on long pre-commit checks and retries in a loop (https://github.com/orgs/community/discussions/178998).

### Linear agent sessions

- **Hierarchy:** workspace and team guidance, then issue, session and activity. A session tracks one agent run (https://linear.app/developers/agent-interaction).
- **Lead agent:** not found; Linear hosts third-party agents. Activities are thought, elicitation, action, response and error. A session plan is a checklist (https://linear.app/developers/agent-interaction).
- **Approval points:** an `elicitation` asks for input; a `select` signal offers options; a `stop` signal halts the agent (https://linear.app/developers/agent-signals).
- **Progress views:** states pending, active, error, awaitingInput, complete, stale, derived from the last activity (https://linear.app/developers/agent-interaction).
- **Ordering:** not found.
- **Stale detection:** the first activity must arrive within 10 seconds or the agent shows as unresponsive. Follow-up activities can be sent for up to 30 minutes after the first response, then the session is stale (https://linear.app/developers/agent-interaction, https://linear.app/developers/agent-best-practices).
- **Concurrency:** not found.
- **Stacked PRs:** not found (https://linear.app/docs/coding-sessions).
- **Problems:** issue comments are editable and not reliable to read; agents rebuild history from frozen activities (https://linear.app/developers/agent-best-practices).

### OpenAI Codex cloud tasks

- **Hierarchy:** environments hold repositories and settings; each task runs in its own workspace (https://learn.chatgpt.com/docs/cloud).
- **Lead agent:** not found.
- **Approval points:** after a task, you inspect the changes, ask for follow-ups, and commit or open a PR (https://learn.chatgpt.com/docs/cloud).
- **Progress views:** setup, execution and review stages; granular states not found (https://learn.chatgpt.com/docs/cloud).
- **Ordering:** not found. A user issue says there is no task queue or dependency support (https://github.com/openai/codex/issues/45264).
- **Stale detection:** not found.
- **Concurrency:** not found.
- **Stacked PRs:** not found.
- **Problems:** little execution visibility, lost background process state, no view of context use, no per-task usage (https://github.com/openai/codex/issues/45264).

### Cursor cloud agents

- **Hierarchy:** an agent with runs; one active run per agent, a second returns `409 agent_busy` (https://cursor.com/docs/background-agent/api/overview). Subagents are two levels deep (https://cursor.com/docs/subagents).
- **Lead agent:** the main agent delegates to subagents that inherit its tools (https://cursor.com/docs/subagents).
- **Approval points:** no gate for subagents. A user can take over the remote desktop (https://cursor.com/docs/cloud-agent).
- **Progress views:** agent states ACTIVE, IDLE, ARCHIVED; run states include CREATING and RUNNING; SSE per run (https://cursor.com/docs/background-agent/api/overview).
- **Ordering:** foreground or background subagents (https://cursor.com/docs/subagents). Parallel agents on one repo conflict over the snapshot (https://forum.cursor.com/t/cloud-agent-is-stuck/153798).
- **Stale detection:** not found.
- **Concurrency:** the docs say no limit (https://cursor.com/docs/cloud-agent); staff state 8 running agents on Pro (https://forum.cursor.com/t/cloud-agents-simultaneous-limit-what-are-the-actual-numbers-per-plan/154013).
- **Stacked PRs:** not found. Each agent pushes to a new branch (https://cursor.com/docs/background-agent/api/overview).
- **Problems:** agents stuck at "Setting up repository" (https://forum.cursor.com/t/cloud-agent-is-stuck/153798); finished agents counted toward the limit, since fixed (https://forum.cursor.com/t/limit-on-concurrent-cloud-agents/159540).

### Composio Agent Orchestrator

- **Hierarchy:** projects, sessions, conversations; each worker session has its own worktree (https://github.com/OrchestratorInc/agent-orchestrator/blob/main/docs/architecture.md). The ComposioHQ repository page now links to OrchestratorInc (https://github.com/ComposioHQ/agent-orchestrator).
- **Lead agent:** a persistent project orchestrator plans, spawns workers, passes context and tracks workers, PRs and CI. "The orchestrator owns planning and delegation; workers own implementation, tests, commits, and pull requests." CLI: `ao spawn`, `ao send`, `ao report`, `ao pr merge` (https://github.com/ComposioHQ/agent-orchestrator, https://docs.orchestrator.inc/cli/).
- **Approval points:** a merge is a deliberate user decision (https://docs.orchestrator.inc/faq/). A Blocked session waits on an approval, and automation does not inject input (https://docs.orchestrator.inc/dashboard/).
- **Progress views:** a kanban with Working, Needs you, In review, Ready to merge (https://github.com/ComposioHQ/agent-orchestrator). Status is derived from durable facts, not stored labels (https://docs.orchestrator.inc/dashboard/).
- **Ordering:** not found.
- **Stale detection:** states active, idle, waiting_input, blocked, exited. Work is complete only after repeated idle observations across a settle window. A failed probe is not proof of death (https://github.com/OrchestratorInc/agent-orchestrator/blob/main/docs/architecture.md).
- **Concurrency:** not found; one controller per session (https://docs.orchestrator.inc/faq/).
- **Stacked PRs:** not found.
- **Problems:** open issues on session switching and permission hooks (https://github.com/ComposioHQ/agent-orchestrator/issues).

### Vibe Kanban

- **Hierarchy:** issues, workspaces (a branch, terminals, dev servers), sessions (https://github.com/BloopAI/vibe-kanban, https://vibekanban.com/docs/workspaces/sessions.md).
- **Lead agent:** not found. An MCP server gives an agent `create_issue`, `start_workspace` and `run_session_prompt` (https://vibekanban.com/docs/integrations/vibe-kanban-mcp-server.md). A third-party MCP server adds `send_message` with a queue (https://github.com/yigitkonur/mcp-better-vibe-kanban).
- **Approval points:** inline diff comments go to the agent; "Needs Attention" marks a wait for approval (https://github.com/BloopAI/vibe-kanban, https://vibekanban.com/docs/workspaces/sessions.md).
- **Progress views:** columns To do, In progress, In review, Done (https://vibekanban.com/docs/cloud/kanban-board.md); session states Running, Idle, Needs Attention (https://vibekanban.com/docs/workspaces/sessions.md).
- **Ordering:** relations "blocking, related, duplicate" exist in the MCP tools, but enforcement is not documented (https://vibekanban.com/docs/integrations/vibe-kanban-mcp-server.md).
- **Stale detection:** status indicators only (https://vibekanban.com/docs/workspaces/index.md).
- **Concurrency:** none documented (https://vibekanban.com/docs/workspaces/index.md).
- **Stacked PRs:** not found; one PR per repo (https://vibekanban.com/docs/workspaces/git-operations.md).
- **Problems:** the vendor shut down on 2026-04-10 and the project is community maintained (https://www.vibekanban.com/blog/shutdown). An issue reports repository data loss after a workspace deletion (https://github.com/BloopAI/vibe-kanban/issues).

### Conductor

- **Hierarchy:** project, repository, workspace (one branch and one worktree), sessions (https://www.conductor.build/docs/concepts/workspaces-and-branches).
- **Lead agent:** not found. The API lets one session plan while others implement (https://www.conductor.build/docs/api).
- **Approval points:** plan mode approval, diff review, a checks tab, a user merge (https://www.conductor.build/docs/concepts/agent-modes, https://www.conductor.build/docs/reference/checks).
- **Progress views:** workspaces grouped backlog, in progress, in review, done; session states idle, working, errored (https://www.conductor.build/changelog/0.35.0-workspace-status, https://www.conductor.build/docs/api).
- **Ordering:** independent pieces, one workspace each (https://www.conductor.build/docs/concepts/workflow); a branch in one workspace only (https://www.conductor.build/docs/concepts/workspaces-and-branches).
- **Stale detection:** not found; API clients poll (https://www.conductor.build/docs/api).
- **Concurrency:** not found.
- **Stacked PRs:** yes. Version 0.80.0 shows a PR stack and whether it is ready to merge, with the `gh stack` extension (https://www.conductor.build/changelog/0.80.0-stacks).
- **Problems:** not found; no public issue tracker. macOS only (https://www.developersdigest.tech/tools/conductor).

### Operator

- **Hierarchy:** tickets in `queue/`, `in-progress/` and `completed/` (https://operator.untra.io/getting-started/tickets/).
- **Lead agent:** not found; one agent per ticket (https://github.com/untra/operator).
- **Approval points:** confirmation flags gate autonomous and paired launches; "Awaiting input" marks a pause (https://github.com/untra/operator).
- **Progress views:** a dashboard with queue, in progress with elapsed time, and done (https://github.com/untra/operator).
- **Ordering:** agents pull work when capacity opens, by type, then priority, then age (https://operator.untra.io/getting-started/concepts/kanban/).
- **Stale detection:** a 30 second silence threshold marks awaiting input; a 30 second health check; a 1800 second step timeout (https://operator.untra.io/configuration/).
- **Concurrency:** `max_parallel = 5`, `cores_reserved = 1`, one agent per repo unless worktrees are on (https://operator.untra.io/configuration/).
- **Stacked PRs:** not found.
- **Problems:** alpha software (https://github.com/untra/operator).

### Claude Squad

- **Hierarchy:** flat; one tmux session and one worktree per instance (https://github.com/smtg-ai/claude-squad).
- **Lead agent:** not found.
- **Approval points:** an experimental flag accepts all prompts (https://raw.githubusercontent.com/smtg-ai/claude-squad/main/README.md).
- **Progress views:** a terminal UI with a session list, preview, diff, and states active and paused (https://github.com/smtg-ai/claude-squad).
- **Ordering:** not found.
- **Stale detection:** not found. A readiness check misses some agents (https://github.com/smtg-ai/claude-squad/issues/266).
- **Concurrency:** not found.
- **Stacked PRs:** not found.
- **Problems:** a prompt sent before the CLI is ready is lost (https://github.com/smtg-ai/claude-squad/issues/266).

### Superset

- **Hierarchy:** projects, workspaces (one worktree each), sessions (https://docs.superset.sh).
- **Lead agent:** not found (https://github.com/superset-sh/superset).
- **Approval points:** a diff viewer with comments; PR line feedback goes to an agent (https://github.com/superset-sh/superset).
- **Progress views:** working indicators, chimes and dock badges when an agent needs attention (https://github.com/superset-sh/superset).
- **Ordering:** not found.
- **Stale detection:** not found.
- **Concurrency:** no cap stated (https://github.com/superset-sh/superset).
- **Stacked PRs:** the docs index names stacked PRs; details not read (https://docs.superset.sh).
- **Problems:** a nested session clears the parent status; status drops to review while a subagent runs (https://github.com/superset-sh/superset/issues).

### Parallel Code

- **Hierarchy:** flat; one task per worktree in tiled panels (https://github.com/johannesjo/parallel-code).
- **Lead agent:** not found.
- **Approval points:** a diff viewer and an explicit merge action (https://github.com/johannesjo/parallel-code).
- **Progress views:** a "Needs input" state with desktop and phone notices (https://github.com/johannesjo/parallel-code).
- **Ordering:** not found.
- **Stale detection:** not found.
- **Concurrency:** not found.
- **Stacked PRs:** not found.
- **Problems:** the "waiting for you" tray does not appear with Claude Code (https://github.com/johannesjo/parallel-code/issues).

## 5. Comparison

"Yes" means the public docs state the feature. "No" means the docs state its absence or a search found nothing. "Partly" means the docs state a weaker form, named in brackets. "Unclear" means a page names the feature with no detail.

| Tool                           | Lead agent that writes no code               | Plan approval                 | Needs-input state | Stale or idle state             | Concurrency cap     | Budget per child                    | Task dependencies     | Stacked PRs       |
| ------------------------------ | -------------------------------------------- | ----------------------------- | ----------------- | ------------------------------- | ------------------- | ----------------------------------- | --------------------- | ----------------- |
| Claude Code agent view         | No                                           | No                            | Yes               | Partly (idle stop after 1 hour) | No                  | No                                  | No                    | No                |
| Claude Code agent teams        | Partly (lead may implement)                  | Partly (auto approved)        | No                | Partly (idle notice)            | No (3 to 5 advised) | No                                  | Yes                   | No                |
| Claude Code Projects           | Partly (coordinator; code policy not stated) | Partly (a preference)         | Yes               | Partly (Resolved after a week)  | No                  | No                                  | No                    | No                |
| Claude Agent SDK               | No                                           | No                            | No                | No                              | Yes (20)            | Partly (total budget, maxBudgetUsd) | No                    | No                |
| Factory Missions               | Partly (coordinator; code policy not stated) | Yes                           | No                | No                              | No                  | No                                  | Partly (plan order)   | No                |
| Devin managed sessions         | Partly (coordinator; code policy not stated) | Partly (launch review toggle) | Yes               | Partly (sleep at 30 minutes)    | Partly (plan)       | Yes                                 | No                    | No                |
| GitHub Copilot mission control | No                                           | No                            | No                | No (59 minute limit)            | No                  | No                                  | No                    | Partly (app only) |
| Linear agent sessions          | No                                           | No                            | Yes               | Yes (stale)                     | No                  | No                                  | No                    | No                |
| OpenAI Codex cloud             | No                                           | No                            | No                | No                              | No                  | No                                  | No                    | No                |
| Cursor cloud agents            | No                                           | No                            | No                | No                              | Partly (plan)       | No                                  | No                    | No                |
| Composio Agent Orchestrator    | Yes                                          | No                            | Yes               | Yes (settle window)             | No                  | No                                  | No                    | No                |
| Vibe Kanban                    | No                                           | No                            | Yes               | No                              | No                  | No                                  | Partly (not enforced) | No                |
| Conductor                      | No                                           | Yes (plan mode)               | No                | No                              | No                  | No                                  | No                    | Yes               |
| Operator                       | No                                           | Partly (launch confirmation)  | Yes               | Yes (30 s silence)              | Yes (5)             | No                                  | No                    | No                |
| Claude Squad                   | No                                           | No                            | No                | No                              | No                  | No                                  | No                    | No                |
| Superset                       | No                                           | No                            | Yes               | No                              | No                  | No                                  | No                    | Unclear           |
| Parallel Code                  | No                                           | No                            | Yes               | No                              | No                  | No                                  | No                    | No                |

No tool has all of these. No tool has a stacked branch ship flow with a merge of main per unit and an identity check. Dispatch designs that part itself (D-8).

## 6. Patterns to copy and pitfalls

### Patterns

| Pattern                                                                              | Seen in                                                                             | Dispatch failure it prevents       |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------- |
| One persistent lead per project that plans and writes no code                        | Composio; a lead that coordinates: Factory, Claude Code Projects, Devin             | A7, A19 need one owner of judgment |
| Propose, then approve, then run                                                      | Factory, Devin toggle, Conductor plan mode                                          | A5                                 |
| Typed session states with an explicit needs-input state and a stale state            | Linear, Devin, Claude Code agent view, Composio                                     | F1, F8, F15                        |
| Status derived from durable facts, with a settle window; a failed probe is not death | Composio                                                                            | F4, F15                            |
| A separate needs-input group or column (Dispatch puts it first, section 7)           | Claude Code agent view, Composio "Needs you", Claude Code Projects "Waiting on you" | F1                                 |
| A silence threshold for "awaiting input" and a health check interval                 | Operator (30 s and 30 s)                                                            | F1, F8                             |
| A hard concurrency cap with reserved cores                                           | Operator (5 and 1), Agent SDK (20)                                                  | F23                                |
| A budget per child session                                                           | Devin (the Agent SDK has a total budget only)                                       | F10, A19                           |
| A validation gate per milestone                                                      | Factory                                                                             | A5, A16                            |
| A board tool surface for agents through MCP                                          | Vibe Kanban                                                                         | A1, A4, A14                        |
| A wait primitive in place of a poll                                                  | Devin reminders, Agent SDK task notices                                             | F7, F16                            |

### Pitfalls

| Pitfall                                             | Seen in                                         | Design answer                                          |
| --------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| The lead stops early or does the work itself        | Claude Code agent teams                         | D-9 forbids code edits by the orchestrator             |
| A message to a busy agent arrives late or is lost   | Claude Code issue 98998, Claude Squad issue 266 | D-3: one confirmed send in the supervisor (F6, F14)    |
| A background agent stalls with no signal            | Agent SDK issues 98846, 75314                   | D-3: stale state from transcript growth (F1)           |
| Status lags the work                                | Claude Code agent teams                         | D-5: progress read from the loop files                 |
| No restore after a resume                           | Claude Code agent teams                         | State lives in the store and in files                  |
| Cost multiplies with parallel agents                | Claude Code agent view                          | D-6: cap and budget                                    |
| Queued sessions with no cancel                      | GitHub Copilot discussion 188644                | Every wait has a time limit and a stop                 |
| Data loss when a workspace is deleted               | Vibe Kanban issue list                          | D-9: never delete what the orchestrator did not create |
| A dependency on a vendor service that can shut down | Vibe Kanban                                     | Local server and files only                            |

## 7. Dashboard content by usefulness

| Rank | Content                                                                                                                       | Reason                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1    | Attention queue with inline reply: decision items, needs input, stale, permission prompt, usage limit stop, failed gate       | F1, F3 and F8 cost 30 minutes to 8 hours each because no one saw the stop |
| 2    | Progress per group: units done of the total, the current unit, its phase of its phases, the last gate result, context percent | A12 watched these every few minutes; A8 and A15 depended on them          |
| 3    | Tickets by column, with the cards the orchestrator created                                                                    | A1 and A18                                                                |
| 4    | Activity log of orchestrator tool calls and supervisor actions                                                                | A7 rulings and F12 repeated actions must be visible after the fact        |
| 5    | PRs and merge order with check state and the identity check result                                                            | A16, A17                                                                  |
| 6    | Cost and usage against the budget, with reset times                                                                           | F10, A19                                                                  |
| 7    | Counters (running sessions, open groups)                                                                                      | Low: the first two ranks carry the same signal                            |
