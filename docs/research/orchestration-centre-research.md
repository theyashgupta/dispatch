# Orchestration Centre Research

Status: accepted. Date: 2026-10-11. Ticket: LOCAL-104. Input to: `docs/standards/orchestration-ui-spec.md` Screen 6.

## Scope and sources

This document compares the centre views of tools that run several coding agents at the same time. It answers four questions for each tool:

1. What does the main screen show?
2. How does a person comment or steer?
3. How does the tool draw sessions, sub-agents and branches?
4. What does the tool do at phone width?

The survey used public product pages, documentation and changelogs, read on 2026-10-11. This document holds descriptions and links only. It holds no third party screenshot. A claim that the sources did not confirm is marked "not documented".

Other inputs:

- `docs/research/orchestration-research.md` section 6 (patterns and pitfalls, G16).
- The G16 sketches in `docs/research/sketches/` (boards, dashboard, orchestrator panel, switcher, board with no orchestrator).
- The LOCAL-106 pattern list for the dashboard: a status sentence header, a milestone track with a current node, state styled tiles, a needs-you rail, uppercase eyebrows, tabular numerals and a dot grid surface.
- The user requirement of 2026-10-10: one centre with one orchestrator where the user comments, and branches from it to every ticket that works the board.

Tools that the survey left out: Vibe Kanban (its company closed on 2026-04-10, see https://vibekanban.com/shutdown), and Devin, Codex app, Jules, Sculptor, Terragon and Claude Squad (the sources gave no usable detail about their centre view).

## Survey

### Claude Code agent view

Source: https://code.claude.com/docs/en/agent-view

- **Centre view:** a list of background sessions in the terminal. A header shows the counts of sessions that wait, work and are complete. A dispatch input is at the bottom.
- **Steering:** Space opens a peek panel with a reply field. Enter attaches to the full session.
- **Sessions:** rows in groups: Pinned, Ready for review, Needs input, Working, Completed. Each row shows a state icon, a name, a one line activity summary, an age and a PR label. Sub-agents have no rows of their own.
- **Needs input:** the session moves to the top group. The peek panel shows the options or a text field. A permission dialog needs a full attach.
- **Phone width:** not documented.
- **Pattern to copy:** group the work by "who waits on me", and answer inline from the list.

### Composio Agent Orchestrator

Source: https://github.com/ComposioHQ/agent-orchestrator

- **Centre view:** a live kanban with four columns: Working, Needs you, In review, Ready to merge. The column comes from the session, PR, CI and review state.
- **Steering:** a structured chat for each worker, or the native terminal of the worker. A persistent project orchestrator agent has its own conversation view. It sees all workers and PRs and can start or redirect workers.
- **Sessions:** cards with the task, agent, branch, activity, PR and status.
- **Needs input:** the card goes to the "Needs you" column.
- **Phone width:** not documented.
- **Pattern to copy:** one persistent orchestrator agent with its own conversation, above the workers.

### Factory Missions

Source: https://docs.factory.com/missions/running-app.md

- **Centre view:** the active milestone in the main pane, with the validation criteria and commits of the selected feature. A top bar shows the elapsed time and the credits.
- **Steering:** pause the orchestrator, tell it to assess again or plan again, then resume. No message field is documented.
- **Sessions:** a left sidebar lists the workers. A worker shows its terminal output and its sub-tasks. A right sidebar is a live progress log.
- **Needs input:** not documented.
- **Phone width:** not documented.
- **Pattern to copy:** the orchestrator and its milestone at the centre, the workers on a rail beside it.

### GitHub Copilot coding agent, Agents tab

Sources: https://github.blog/changelog/2025-11-27-a-mission-control-to-assign-steer-and-track-copilot-coding-agent-tasks/ and https://github.blog/changelog/2026-01-26-introducing-the-agents-tab-in-your-repository

- **Centre view:** a repository Agents tab with a session list. A task opens its session log beside the Overview and Files changed tabs.
- **Steering:** a chat input, or a comment on the changed files. The agent reads it after its current tool call.
- **Sessions:** a list with a link to the PR of each session.
- **Needs input:** the view marks a session that needs input. No more detail is documented.
- **Phone width:** GitHub Mobile can create tasks. Monitoring on the phone is not documented.
- **Pattern to copy:** the session log, the diff and the PR link on one screen.

### Cursor Agents Window

Source: https://cursor.com/docs/agent/agents-window

- **Centre view:** a sidebar of agents (local, worktree, remote, cloud) and the active agent.
- **Steering:** a chat for each agent.
- **Sessions:** the sidebar groups agents by Today, Last 7 days and Older. Failed agents are in an Error group.
- **Needs input:** a dot on the agents control and a mark on the row of a sub-agent that asks a question. The mark moves up from the child to the parent.
- **Phone width:** agents that start on the phone show in the window. The phone layout is not documented.
- **Pattern to copy:** a state mark that rolls up from a child to its parent.

### Superset

Source: https://superset.sh/

- **Centre view:** a sidebar of workspaces in groups by where they run, with counts. The main area has a file tree, a changes pane, a terminal and a task field.
- **Steering:** a terminal and a task field for each workspace. The review pane approves or comments, then opens a PR.
- **Sessions:** each workspace shows its name, agent and diff size. A spinner marks a running workspace and a check marks a ready one.
- **Needs input:** the status shows the workspaces that wait on the user.
- **Phone width:** an iPhone and iPad app lists the workspaces, with a chat for each agent and a diff review.
- **Pattern to copy:** on the phone, one plain list with a chat behind each row.

### Conductor

Sources: https://www.conductor.build/docs/ and https://www.conductor.build/changelog

- **Centre view:** one workspace for each task, each with its own branch, files, terminal and diff. The layout is not documented.
- **Steering:** chat and diff review.
- **Sessions:** a sidebar (0.44.0) and a workspace status (0.35.0). Their content is not documented.
- **Needs input:** not documented.
- **Phone width:** an iOS app shipped on 2026-10-02 (0.90.0). Its layout is not documented.
- **Pattern to copy:** one workspace for each task, with no more detail confirmed.

### Warp agent management and the Oz web app

Source: https://docs.warp.dev/agent-platform/cloud-agents/managing-cloud-agents

- **Centre view:** a list of agent runs with filters for source, day, creator and status.
- **Steering:** follow-up messages in a session. A separate steering control is not documented.
- **Sessions:** each row shows the source, the status, the duration and the credits. Child runs show as pills above the parent, or as rows under the parent in the web app.
- **Needs input:** a Blocked state.
- **Phone width:** the web app runs list works on a phone.
- **Pattern to copy:** a parent state must not hide a failed child.

### Omnara

Sources: https://apps.apple.com/app/omnara-ai-command-center/id6748426727 and https://pypi.org/project/omnara/

- **Centre view:** a session list in a phone and web command centre. The terminal, web and phone views of a session stay in sync.
- **Steering:** chat, a terminal view and voice.
- **Sessions:** pin, delete and mark complete. The state columns are not documented.
- **Needs input:** the main purpose of the product. The agent stops and asks, the phone gets a notification, and the user answers in the app.
- **Phone width:** a native iOS app.
- **Pattern to copy:** each question of an agent becomes an item with an inline answer.

### GraphCode and LangGraph Studio

Sources: https://openorchestrators.org/players/graphcode/ and https://docs.langchain.com/langsmith/studio

- **Centre view:** GraphCode draws a graph where each node is a live terminal and each edge has a type (hand-off, message, start). LangGraph Studio draws the nodes that a run passed through, with their state.
- **Steering:** GraphCode opens a node to correct its session. LangGraph Studio has a chat mode for message graphs.
- **Sessions:** nodes and typed edges.
- **Needs input:** not documented.
- **Phone width:** not documented.
- **Pattern to copy:** a node opens its live session, and an edge carries a meaning.

## Comparison

| Tool                 | Centre view                | Steering                  | Branch drawing         | Needs input          | Phone          |
| -------------------- | -------------------------- | ------------------------- | ---------------------- | -------------------- | -------------- |
| Claude Code agent    | Grouped session list       | Peek reply, attach        | Rows in state groups   | Top group, inline    | Not documented |
| Composio             | Kanban by attention state  | Orchestrator chat, worker | Cards in columns       | "Needs you" column   | Not documented |
| Factory Missions     | Orchestrator and milestone | Pause, plan again         | Worker rail            | Not documented       | Not documented |
| GitHub Copilot       | Session list and log       | Chat, diff comments       | List rows              | Mark on the session  | Create only    |
| Cursor Agents Window | Agent sidebar and chat     | Chat per agent            | Sidebar groups by time | Dot that rolls up    | Not documented |
| Superset             | Workspace sidebar          | Terminal, task, review    | Sidebar rows           | Status "waiting"     | Native list    |
| Conductor            | Workspace per task         | Chat, diff                | Not documented         | Not documented       | iOS app        |
| Warp and Oz          | Run list                   | Follow-up messages        | Parent and child rows  | Blocked state        | Web list       |
| Omnara               | Session list               | Chat, terminal, voice     | List rows              | Notification, answer | Native app     |
| GraphCode, LangGraph | Node graph                 | Open the node             | Nodes and typed edges  | Not documented       | Not documented |

The survey shows four layout types:

1. **Session list and detail:** Claude Code agent view, Cursor, GitHub Copilot, Warp, Omnara.
2. **Kanban by attention state:** Composio, Superset.
3. **Orchestrator hub with a worker rail:** Factory, and the Composio orchestrator agent.
4. **Node graph:** GraphCode, LangGraph Studio.

Findings that apply to Dispatch:

- **F-1:** every tool that lets a person steer puts a chat or a reply field next to the work. No tool makes the raw terminal the only steering path, and the tools that keep a terminal keep it one action away (Claude Code attach, Composio, Superset).
- **F-2:** the tools that handle needs input well put the waiting work first and answer it inline (Claude Code agent view, Composio, Omnara).
- **F-3:** an orchestrator that has its own conversation above the workers is the closest match to the user requirement (Composio, Factory).
- **F-4:** a graph is rare in coding tools. The graph tools draw a small number of nodes. No graph tool documents a phone layout.
- **F-5:** on the phone, every documented tool shows a plain list with a chat behind each item (Superset, Omnara, Warp).
- **F-6:** a parent state must not hide a child state (Cursor, Warp).

## Candidate layouts

Each sketch shows the same sample board (key CEN) at 1440 px and 390 px, in the light and dark themes. Open a sketch with `?theme=light` or `?theme=dark`. The screenshots are in `docs/research/sketches/screenshots/` with the names `centre-<a|b|c>-<width>-<theme>.png`.

### Layout A: Hub and spoke (`sketches/centre-a.html`)

The orchestrator node is in the middle of a canvas. The branches go out from it on all sides. The conversation pane is on the right. At 390 px, a tab bar holds Branches and Conversation, and the branches are a grouped list.

- Matches the words of the requirement most closely: one centre with branches.
- A new branch moves the angle of every other branch, so the layout shifts on each live update.
- The space around the centre holds about 10 nodes before nodes overlap. A board with an intake of 20 tickets does not fit.
- The keyboard order around a circle has no natural direction.
- The waiting work has no fixed place, so F-2 is lost.

### Layout B: Orchestrator tree (`sketches/centre-b.html`)

The orchestrator node is at the left edge of the canvas. The branches go to the right into one vertical stack of nodes, with elbow edges. The stack is in bands with eyebrow headings: Needs you, Running, Planned, Done, Shipped. The conversation pane is on the right with the tabs Conversation (default) and Terminal. At 390 px, the bands become a grouped list under a compact orchestrator header, and the conversation is a second tab.

- Keeps the requirement: one centre node with a branch to each ticket and group.
- A new branch goes into its band. The other branches keep their place, so the layout does not shift (F-6 rollup stays in the orchestrator node line "9 branches, 3 need you").
- The stack grows down, so 20 or more branches fit with a page scroll.
- The Needs you band is first, with the inline answers (F-2).
- The keyboard order is top to bottom, the same as the list. The 390 px list is the same bands with no graph, so the screen reader list and the phone list are one structure (F-5).
- The conversation is beside the graph and the Terminal is one click away (F-1, F-3).

### Layout C: Attention board with orchestrator chat (`sketches/centre-c.html`)

The conversation is a full height column on the left. The orchestrator is a header strip. The branches are columns by attention state: Needs you, Running, Planned, Done. At 390 px, the chat is on top and the columns become stacked sections.

- Strong for needs input (F-2), the same as Composio.
- Has no centre node and no branches, so it does not meet the requirement.
- Repeats the kanban. The ticket says that the kanban stays the board.

## Chosen layout

**Layout B, the orchestrator tree.**

Reasons:

1. It is the only candidate that meets the user requirement and stays usable at 20 or more branches: one orchestrator node, one branch to each ticket and group, and a conversation where the user comments.
2. It has no layout shift on live updates. A branch changes its band or its content; the other branches keep their slots. Layout A fails this.
3. It puts the work that needs the user first and answers it inline, which the best tools for needs input do (F-2).
4. The keyboard order, the screen reader list and the 390 px list are one structure: the bands in order. The graph adds edges and the orchestrator node at wide widths only (F-5).
5. The conversation is the default view of the pane, and the Terminal is one click away and stays a full terminal (F-1). This keeps the Terminal first class and makes the conversation the place to comment.
6. It uses the LOCAL-106 visual language: eyebrows for the bands, state styled tiles, a dot grid canvas, tabular numerals, and a glow on the current node only. The centre and the dashboard read as one system.

Rejected: Layout A, because of the layout shift, the limit of about 10 nodes and no fixed place for the waiting work. Layout C, because it has no centre node and repeats the kanban.

Dependency: none. The graph is an SVG module component with token colours, in the shape of the existing flow stage SVG. The research gives no reason for a charting dependency, so no decision record is needed.

The screen contract is Screen 6 in `docs/standards/orchestration-ui-spec.md`.
