# Dispatch user guide

This guide explains the orchestration feature of Dispatch. It covers boards, the orchestrated board setup, the orchestrator, loops, the dashboard, the attention queue, budgets, usage limits, handoff and the ship flow. It also lists the seeded playbooks and the manual scripts that Dispatch replaces.

## What the orchestration feature does

Dispatch runs Claude sessions in tmux. The orchestration feature adds four parts on top of these sessions.

- **Boards.** A board holds the tickets, the repositories and the policy of one project.
- **Orchestrator.** An orchestrator is a Claude session that coordinates the work of one board. It uses the Dispatch tools. It cannot write code and it cannot change the policy.
- **Supervisor.** The supervisor is part of the Dispatch server. It watches every live session of a board. It sends the fixed prompts that need no judgment, such as a continue prompt, a handoff request or a resume.
- **Dashboard.** The dashboard shows what needs you now and how each loop progresses.

A group is one session that works on several tickets. A loop is a roadmap that a group session runs unit by unit. The supervisor and the dashboard read the loop files to show the progress.

## Boards

### Create a board

1. Press `Cmd+K` (or `Ctrl+K`) to open the command palette.
2. Choose **Manage boards**. On the boards page, choose **New board**. The dialog **New board** opens.
3. Fill the fields. Only **Name** is required. The repository rows and **Advanced** are optional. **Advanced** is closed at first. It holds **Key**, **Folder** and **Linear team keys**.

| Field                | What to enter                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Key**              | 2 to 6 capital letters or digits. The key starts with a letter. You cannot change the key later. `LOCAL` and `GROUP` are reserved. |
| **Name**             | The name of the board.                                                                                                             |
| **Folder**           | The folder in which Dispatch makes one folder for each session.                                                                    |
| **Repository path**  | The path of a git repository. Choose **Add repository** to add more rows.                                                          |
| **Base branch**      | The base branch of that repository.                                                                                                |
| **Check command**    | The command that the ship flow runs as the check of that repository. The row shows the placeholder `npm run check`.                |
| **Linear team keys** | Linear team keys, separated by commas. New Linear issues of these teams go to this board.                                          |

4. Choose **Create**. The dialog closes, the message "Created board <name> (<KEY>)" shows and Dispatch opens the new board.

Dispatch derives the key from the name when you give no key. When you give no folder, Dispatch makes the folder `<workspaces root>/<key>`. The form shows an error under a field that is empty or wrong. **Key**, **Folder**, **Repository path**, **Base branch**, **Check command** and **Linear team keys** are optional. An empty **Check command** becomes `npm run check`. Enter the folder and the repository path as absolute paths.

In the dialog, **Browse** next to **Repository path** opens the folder browser. Choose a git folder to fill the path. In **Advanced**, **Key** and **Folder** have placeholders that show the values Dispatch uses when you leave them empty.

The key must be new. Dispatch refuses a key that another board or a Linear team already uses. A board can have no repository. Add a repository later in the board settings. The server can also make a local repository in `<board folder>/<lowercase key>`.

### Switch boards

The sidebar has a **Boards** section at its end, after the System group. It lists every active board, in list order. The board you are on is marked. Each row shows the number of items that need attention and the number of running loops. Select a row to open the kanban board of that board. The last row, **Create board**, opens the create dialog.

Select the label **Boards** to fold or unfold the section. Press `Enter` or `Space` on the label to do the same. When the sidebar is narrow, the section is one icon that opens the boards page. On a phone, the section shows in the sidebar sheet, and the sheet closes when you select a board.

Press `B` to open the command palette with the boards only. Type to filter the boards. The palette lists **Switch to board** for each active board except the current one, then **Manage boards** and **Create board**. `B` does nothing while you type in a text field or while a dialog is open. Select a board in the palette to show the same page on that board.

The address of a board page holds the board key. The pages with a keyed address are the board (`/boards/<key>`), the dashboard (`/boards/<key>/dashboard`), the inbox (`/boards/<key>/inbox`), the sessions (`/boards/<key>/sessions`) and the board settings (`/boards/<key>/settings`). The other pages keep the `board` search parameter, for example `/tickets?board=<key>`. The old addresses, such as `/board`, `/inbox` and `/dashboard?board=<key>`, still open the same pages.

### Create a board from the palette

1. Press `Cmd+K` (or `Ctrl+K`). Choose **Create board**.
2. Type the board name in the field **Board name**. Press `Enter`.
3. Dispatch shows the message "Created board <name> (<KEY>)" and opens the board.

An empty name does nothing. Press `Escape` to go back to the command list. If Dispatch refuses the name, it shows the reason and keeps the palette open.

### Create a board from the Ask page

Write "create a board called <name>" on the **Ask** page. Dispatch creates the board with the default values. The answer gives the key and the link **Open <name>**. If you write "create a board" with no name, Dispatch asks "What should the board be called?". Write the name, or write "cancel".

### Manage boards

**Manage boards** opens the boards page. The table has the columns **Name**, **Key**, **Repositories**, **Running**, **Open groups**, **Attention** and **Loops**. The **Loops** column shows each running loop as a group id and a percent, for example `ORC-6 40%`.

The row menu **Board actions** has three items.

- **Open board** opens the board.
- **Edit** opens the board settings page (see "Board settings"). You can change the name, the team keys and the repositories. The key and the folder do not change.
- **Archive** hides the board from the **Boards** section. The cards and sessions stay. The item is off while sessions run on the board. Restore the board from **Archived boards** with **Restore**.

### Board settings

Choose **Edit** in the row menu **Board actions**, or open `/boards/<key>/settings`. The page changes the name, the repositories and the Linear team keys of the board. The key does not change. An active board shows **Create a repository here**. It makes the repository `<folder>/<lowercase key>`.

### Start a card on a board with no repository

If the board has no repository, **Start** shows "This board has no repository." and three actions.

- **Start without a repository** runs the session in the board folder.
- **Create a repository here** makes the repository and selects it. Then choose **Start**.
- **Add a repository** opens **Browse**. Choose a git folder. Dispatch adds it to the board and selects it.

### The default board

`LOCAL` is the default board. It is the board that Dispatch shows when no other board is selected.

- You cannot archive it.
- Its repositories come from **Settings**, **Workspaces**. A change on its board settings page also changes that list. The page shows the repository path only.
- Its supervisor starts **Off**. A new board starts with the supervisor **On**.

## Orchestrated board setup

An orchestrated board needs three things: repositories, a policy and an orchestrator.

### Repositories

Add the repositories when you create the board, or choose **Edit** later. Each repository has a path, a base branch and a check command. The ship flow runs the check command.

### Board policy

To open the policy form of a board:

1. If the board does not exist, create it (see "Create a board").
2. Select the board in the **Boards** section (see "Switch boards").
3. Open the board page.
4. Choose **Orchestrator**, or **Add orchestrator** when the board has none. The command centre opens. Choose **Settings** to open the settings sheet. The sheet has two tabs: **Policy** and **Orchestrators**. The terminal and the decisions are on the command centre.
5. Open **Policy**. The form is called **Policy for** and the board name.

Only you can change the policy. The orchestrator reads it. No tool can change it.

| Label                                                     | Allowed values                                                                                   | Default                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------- |
| **Roadmap approval**                                      | **Ask me for each roadmap**, **Approve when the rules pass, else ask**, **Approve each roadmap** | **Ask me for each roadmap** |
| **Loops at once**                                         | A whole number from 1 to 10                                                                      | 3                           |
| **Free memory floor (MB)**                                | A whole number from 0 to 65536. 0 turns the floor off                                            | 1024                        |
| **Swap ceiling (MB)**                                     | A whole number from 256 to 65536                                                                 | 8192                        |
| **Loop model**                                            | **Session settings**, or a model with the effort `high` or `max`                                 | **Session settings**        |
| **Group playbook**                                        | **None**, or a playbook name                                                                     | **None**                    |
| **Messages from other sessions (loops and orchestrator)** | **Refuse (default)**, **Accept**, **Hold for review**                                            | **Refuse (default)**        |
| **Orchestrator model**                                    | **Opus 5.5**, **Sonnet 5.5**, **Fable 5.1**                                                      | **Opus 5.5**                |
| **Handoff at context percent**                            | A whole number from 10 to 95                                                                     | 50                          |
| **Hard handoff at context percent**                       | A whole number above the handoff percent, up to 100                                              | 80                          |
| **Wake timer (minutes)**                                  | A whole number from 0 to 1440                                                                    | 15                          |
| **At a usage limit**                                      | **Wait for the reset**, **Stop and ask me**                                                      | **Wait for the reset**      |
| **Ship rights**                                           | **None, I ship**, **Open PRs**, **Open and merge PRs**                                           | **None, I ship**            |
| **Budget per group (USD)**                                | An amount above 0 and at most 100000, or empty for **No limit**                                  | Empty (**No limit**)        |
| **Budget warning (%)**                                    | A whole number from 1 to 99                                                                      | 80                          |
| **Supervisor**                                            | **On**, **Off**                                                                                  | **On** (**Off** on `LOCAL`) |

Notes on the fields:

- **Roadmap approval** controls how the orchestrator approves the plan of a loop. With **Ask me for each roadmap**, the `approve_roadmap` tool needs your approve answer on a decision item of that group. With the two other values, the tool call is allowed. With **Approve when the rules pass, else ask**, the playbook judges the rules.
- **Memory floor and swap ceiling.** Dispatch reads the memory of this Mac every 15 seconds. When free memory is below the board's memory floor (default 1024 MB) or swap used is above its swap ceiling (default 8192 MB), Dispatch refuses a card start, a group start, a resume of a lost session and the orchestrator tools that start or resume a loop. The refusal names the reading and the limit, for example "free memory 812 MB is below the 1024 MB floor". A group that waits in the queue starts when memory recovers. On Linux there is no reading and nothing is refused. Set the two limits with **Free memory floor (MB)** and **Swap ceiling (MB)**, which are next to **Loops at once** on the **Policy** tab. A start, a group start or a resume that Dispatch refuses for memory shows the reason in the usual place for that action. See also "Memory and paused loops".
- **Loops at once** is the concurrency cap. It covers groups and the ticket cards that the orchestrator starts. Dispatch refuses the orchestrator tools that start a group or a card above the cap. A card or group in Agent done frees its slot. A group that waits for its dependencies stays queued. The supervisor starts it when the dependencies are done and a slot is free.
- **Loop model**: The model and effort of the sessions of a group. When you choose a model, Dispatch starts each group session with that model and effort, and it ignores any model or effort in the Settings Claude arguments. When you choose **Session settings**, Dispatch uses the Settings.
- **Group playbook**: the playbook of a group that the orchestrator creates without one. When the playbook no longer exists, the group starts with no playbook. When the stored name is not in the list of playbooks, the select shows it as "<name> (not found)", and **Save policy** keeps the name.
- **Messages from other sessions (loops and orchestrator)**: how a Roadmap Loop session and the orchestrator session of this board treat a message from another Claude session on this computer. **Refuse (default)** blocks the message. **Accept** delivers it. **Hold for review** shows a dialog in the session. The supervisor denies that dialog only when the board supervisor is **On**. When it is **Off**, you answer the dialog in the terminal. The value applies at the next session start. An extra orchestrator cannot override it.
- **Wake timer (minutes)**: Wakes an idle orchestrator after this many quiet minutes. 0 turns it off. An extra orchestrator cannot override it.
- **Supervisor** must be **On** to start an orchestrator. The form says: "The supervisor watches the loops of this board. An orchestrator needs it."
- Choose **Save policy** to save. The button is off until a field changes. The message "Policy saved." confirms the save.
- The number fields are text inputs. The form checks the ranges while you type and shows an error under the field. **Save policy** saves nothing while a field has an error.

The server accepts wider number ranges than the form does. The form ranges in the table are the ones to use.

### Messages from other Claude sessions

Another Claude session on this computer can send a message to a session that Dispatch started. To set how a session that you start from a ticket treats these messages:

1. Open **Settings**.
2. Open **Board**.
3. In **Messages from other Claude sessions**, choose **Accept**, **Hold for review** or **Refuse**. The default is **Accept**.
4. Choose **Save**.

The page says: "Applies to sessions that you start from a ticket. Roadmap Loop and orchestrator sessions refuse these messages unless the board policy or the start request sets a value. A running session keeps its value until it restarts."

A session that runs a playbook whose name starts with "Roadmap Loop", and an orchestrator session, use the board policy value (see "Board policy"). The start route also accepts the field `crossSessionInbound` for one card; the card keeps that value for each later launch only when the request starts the session of the card itself. A "start another session" request applies the value to the first launch of that new session only.

A session that starts without hooks gets no settings file, so this value does not apply to it. A session starts without hooks when the status channel is the pane, when the Claude CLI is below the hooks version, or when hooks are off.

## Add and start an orchestrator

1. Select the board in the **Boards** section. Open the board page. Every board has its own button. `LOCAL` has one too, and its supervisor starts **Off**.
2. Choose **Add orchestrator** in the page header. When the board already has an orchestrator, the button reads **Orchestrator**. The command centre opens (see "The command centre"). Choose **Settings** to open the settings sheet at the right of the command centre. The sheet opens at the **Policy** tab.
3. Make sure the supervisor is **On** in the **Policy** tab. With the supervisor **Off**, the button **Start** of the command centre is off. The command centre shows this line under the button: "Turn on the supervisor in Policy to start an orchestrator."
4. Close the settings sheet. Choose **Start** in the controls of the command centre.

When the board has no orchestrator record, **Start** first adds the main orchestrator. The record has the id `main` and the name "Main orchestrator". Then it starts the orchestrator.

The orchestrator can create a board with the tool `create_board`. It gives a name, and the tool answers the key and the link. The tool `get_board_workspace` lists all boards.

The orchestrator reads the folder and the repositories of the board by itself. It does not ask you for a repository path or a base branch. Set the base branch of each repository in the board settings.

The default board `LOCAL` stores no base branch, so its repositories answer base null. On `LOCAL` the orchestrator passes `repos` with a base to `create_group`. For example, it uses a branch that it makes with `create_base_branch`.

The start does these things:

- It creates a hidden card named "Orchestrator: Main orchestrator". The card holds the session.
- It writes an MCP configuration file for the `dispatch mcp` command. The file holds no token.
- It starts a Claude session in tmux with the playbook **Board Orchestrator**.
- It passes the model of the **Orchestrator model** field to Claude.
- It limits the tools. Claude gets the read tools `Read`, `Glob` and `Grep`, and the Dispatch tools. The tools `Bash`, `Write`, `Edit` and `NotebookEdit` are off.

The orchestrator node of the command centre shows the state of the session as a badge. The badge uses the session states of a loop. These are the values you see most:

- **Starting** (with a spinner). The start runs.
- **Working**. The orchestrator runs. This is the healthy state. The **Stop** button shows.
- **Idle**. The session runs and waits.
- **Needs input**, **Permission prompt**, **Usage limit dialog** and **Waiting for usage reset**. The session waits. Open the **Terminal** tab.
- **Session lost** and **Claude exited**. The session ended. **Resume** shows.

When the orchestrator waits at its prompt, Dispatch wakes it. Dispatch types one line that starts with "Dispatch wake:" when you answer its decision item, when one of its groups reaches Agent done, needs input, fails to start, ships, stops its ship flow, hits a loop error or a usage limit, and when the **Wake timer (minutes)** of the policy runs out. Dispatch never types while the orchestrator works, types at most one line in 20 seconds, and never wakes a stopped orchestrator.

The hidden card and the MCP configuration file do not show in the UI. To confirm a start, check these signs:

1. The badge reads **Working** and the **Stop** button shows.
2. The **Terminal** tab of the pane shows the live terminal.
3. The **Changed since** card of the dashboard shows a row such as "Supervisor: a card is now Working".

The start can fail. The controls of the command centre then show the line "The orchestrator did not start: <reason>." The reason names the step and the last text of the Claude pane. Dispatch waits about 30 seconds for Claude to be ready, so the badge can read **Starting** for some time before the line shows. Choose **Try again** beside the line to start again. The board now has a main orchestrator, so the page header button of the board reads **Orchestrator**.

The **Terminal** tab of the pane shows the live terminal. The buttons of the command centre depend on the state:

- **Start** starts a stopped orchestrator. It shows when the orchestrator is stopped, also after a failed start.
- **Stop** interrupts the current turn. The session stays open. The button is off when the session shows a permission prompt, the usage limit dialog or the wait for the usage reset.
- **Resume** shows when the session is lost or Claude exited. It starts Claude again in the open session, or it starts the session again.

The **Conversation** tab of the pane lists the open decision items of the orchestrator. The **Orchestrators** tab of the settings sheet lists the orchestrators. The **Last wake** column, after **Policy**, shows the reasons and the time of the last wake, for example "timer 15 min at 14:05", or **None** when the orchestrator has not woken. An extra orchestrator needs a scope of groups or tickets, and it needs the main orchestrator first. Choose **Add extra orchestrator** to add one.

## How the orchestrator judges and starts work

The orchestrator loads the rule book [`docs/orchestration/rulebook.md`](orchestration/rulebook.md) with the tool `get_rulebook`. It loads it at the start of a session and again after each handoff.

For each ticket or set of tickets, the orchestrator chooses one of three paths. The rule book gives these criteria:

- "Write code directly: one known fix of a few lines with no new surface"
- "PRD + Ralph Loop: one ticket or one feature of one module, up to a few hundred lines, with phases, QA and a gap analysis"
- "a group with the Roadmap Loop: two or more related tickets with an order or shared files, or any ticket that spans server, web and docs across modules"

The orchestrator reads the playbooks with the tool `list_playbooks`. The tool gives the name, the when line and the source (seeded or user) of each playbook. The start dialog shows the when line under the name of the playbook. Dispatch seeds a when line for each seeded playbook. A user playbook can have a `when:` line in its front matter. The line must have 300 characters or fewer. The playbook editor keeps the line when you save the playbook.

The orchestrator writes one plan for the whole intake. The plan is a decision item with the options approve and reject. The plan has one line for each ticket or group, with the playbook, the order and the size. With **Ask me for each roadmap**, you approve the plan with one click in the **Decisions** tab. The orchestrator starts no work until you approve.

After the approval, the orchestrator starts the work:

- For a single ticket card, it calls `start_card`. The tool starts the card the way the start dialog does, with a playbook and a direction.
- For a group, it calls `create_group` and then `start_group`.

The cards that the orchestrator starts count against **Loops at once** together with groups. A card or group in Agent done frees its slot. At the cap, the orchestrator waits for a slot.

A line that you type in the **Terminal** tab of the orchestrator is a direction. The orchestrator handles it like a new intake.

Dispatch updates a seeded playbook file that you never edited at the next start of Dispatch. Dispatch keeps a file that you edited.

When a single card that the orchestrator started reaches Agent done, the orchestrator ships it. It calls `start_ship` with the session branch of the card. The ship checks are the same as for a group. The ship rights of the board decide what the flow does. With **None, I ship**, the orchestrator raises a decision item and you ship the branch.

The orchestrator can prepare a release. It calls `release_prep` with the bump, the features and the merged pull requests. Dispatch reads the version of the base branch and creates a card **Release v<next version>** in **To Do**. The orchestrator starts that card with the **Release** playbook. The release session bumps the version, drafts the notes and records the demo. When the bump pull request is merged, the orchestrator tells the session, and the session publishes only when the **Ship rights** are **Open and merge PRs**. Else it asks you to publish.

Before it starts a long loop, the orchestrator calls `list_accounts`. It chooses the account with the most weekly headroom and starts the card on that account. It never chooses usage credits. The start dialog that you use is unchanged.

## Groups and loops

### How a group starts

A group is one session for several tickets.

1. On the board, hold `Cmd` (or `Ctrl`) and click two or more cards in **To Do**. A card that is in a group, or that is a group, cannot join.
2. Choose **Start N as group** in the selection bar. The dialog **New group** opens.
3. Check the **Title**, the **Repositories** and the **Playbook**. Dispatch can suggest a title.
4. Type an optional direction. It applies to the whole group.
5. Choose **Start group**.

An orchestrator does the same with its tools: it creates a group card and starts it. The `start_group` tool refuses a start above the **Loops at once** cap. The supervisor starts a queued group when its dependencies are done and a slot is free.

### The loop files

A loop is a roadmap that the group session runs. The session writes the loop files. The loop reader of Dispatch only reads them. The supervisor makes one change: it renames the engine file at the end of a loop. Paths are relative to the session folder of the group.

| File                                    | What it holds                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ROADMAP*.md`                           | The units of the roadmap, the status of each unit and the path of each unit PRD.                         |
| `.roadmap/<slug>/progress.md`           | The current unit and phase, and the branch of each unit.                                                 |
| The unit PRD                            | The phases of the unit, as headings of the form `### Phase <N>:`. A line `Retry budget` gives the limit. |
| `.planning/<slug>-unit-<N>/state.md`    | One line for each passed phase gate.                                                                     |
| `.planning/<slug>-unit-<N>/attempts.md` | One line for each failed attempt.                                                                        |
| `.claude/ralph-loop.local.md`           | The loop engine file. It shows if the loop is active. The supervisor renames it to `.done` at the end.   |
| `.roadmap/<slug>/resume.md`             | The resume prompt that the loop writes at a handoff.                                                     |

Dispatch reads these files again when a file changes and every 60 seconds. A bad or missing file gives a partial result. It never stops the board.

The loop also reports each phase gate and unit gate to Dispatch. The report uses the token of the session. It adds a gate event and starts a new read of the files. It writes no progress field.

### How progress shows

- The boards page **Loops** column shows each running loop as a group id and a percent.
- The dashboard section **Progress per group** shows one row for each group that has a loop. It also shows each single card that the orchestrator started, with the phases of its PRD.
- The dashboard section **Changed since** shows the gate events.

## The dashboard

Open the dashboard from the sidebar row **Dashboard** (group **Work**), or from the palette command **Go to Dashboard**. The sidebar row and the palette command show only when the board has a main orchestrator. The dashboard shows the board that is selected in the **Boards** section.

The page has the title "Project map" on a dot-grid background. Each section shows its own loading state and its own error. A section error has the button **Try again**. The other sections stay.

Under the title, one status line shows these items:

- "Synced HH:MM". When the stream is down, it reads "Data from <time>".
- "<n> of <cap> loops running".
- "<n> gates passed today". The count is the number of loop phases whose gate passed on the local calendar day.
- "$<amount> spent". This is a running total of the group costs. It is not a daily figure.
- The link "<n> need a call". With zero rows it reads "nothing needs you" and its dot is muted. The link moves focus to the **Needs your call** card.

At 1024 px and wider, the sections show in this order:

1. The status line.
2. **Progress per group**, full width.
3. **Left on this board**, full width.
4. Two columns. The main column holds **Tickets by column**. The rail holds **Next step**, **Needs your call**, **Changed since** and **Cost and usage**.

Below 1024 px, the sections show in this order: the status line, **Needs your call**, **Progress per group**, **Left on this board**, **Tickets by column**, **Next step**, **Changed since** and **Cost and usage**. Each section shows once in the page. The section headings are small uppercase labels. A screen reader still reads the names "Attention queue", "Progress per group", "Left on this board", "Tickets by column", "Next step", "Activity log" and "Cost and usage".

- **Progress per group.** The first line of the section is the memory line, for example "Memory: 812 MB free, swap 2048 of 8192 MB". It adds ", <n> paused" when loops are paused. It updates every 15 seconds. It shows "(stale)" after 60 seconds without a reading, and it is hidden when the computer is not a Mac. Each loop is a milestone track with one node for each unit. With no units it shows "No loop progress". The session badges and the last gate text stay on the track header. A node has one of these states:
  - Done. The node has a check glyph and the state line "Done HH:MM" or "Done".
  - Current. The node has an accent ring, a glow, the pill "You are here" and a phase sub-bar. The state line reads "Phase n of m". The glow moves only when the system allows motion.
  - Failed gate. The node has an X glyph and the state line "Gate failed".
  - Pending. The node is an outline. The state line reads "Next" for the first pending node and "Later" for the other nodes.
- **Left on this board.** The count of open cards and one pill for each open card. An open card is a card that is not in **Agent done**, **In review** or **Done**. A pill shows the card id and a glyph. The order is stuck, needs input, current, not started. With no open card it shows "Nothing open."
- **Tickets by column.** The filters **Group** and **Column** are above the tiles and stay visible. The section shows one tile for each card that the filters select. With no match it shows "No cards match." The link **Open board** stays on the section header. The collapsible **Show column counts** holds the table of column counts, with the count of cards that an orchestrator created (**By orchestrator**). Below 768 px, it holds a list. A tile shows these items:
  - The card id in a mono font and the title.
  - A state pill with a glyph and the column label, or "Stuck: <reason>".
  - A footer line when there is data: the last gate text, "Depends on <ids>" or "Shipped HH:MM".
- **Next step.** For the first running loop that has a current unit, it shows "<group id> unit <n>: <unit title>" and "Phase <n> of <m>: <phase name>". With no such loop it shows "No loop running" and "Start a group from the board."
- **Needs your call.** Each item that needs you, oldest wait first. With no item it shows "Nothing needs you." The card has a red tint only when it holds at least one item. The recommended decision option is bold. See the section "The attention queue".
- **Changed since <time>.** The time is the time of the oldest row on the shown page. A row has a dot, the change text with the card id in bold, and the time on the right. The dot colors are red, amber, green and grey:
  - Red is for a failed gate, a loop error, a failed start or a stopped ship.
  - Amber is for needs input and a usage limit.
  - Green is for a passed gate, agent done and shipped.
  - Grey is for the other rows.
- **Cost and usage.** The cost of each group against its budget, and the usage meters of the Claude account, as compact rows. With no cost it shows "No cost yet." See the section "Budgets and usage limits".

**Changed since** shows one row for each recorded event, newest first. The orchestrator rows are tool calls and raised decisions. The supervisor rows are actions, session state changes, loop gates, PR changes and a wake of the machine. Your rows are the decisions that you answer and the goals that you submit. A policy save, a board change and a press of **Start orchestrator** write no row of their own. The filters **Actor** (**All**, **Orchestrator**, **Supervisor**, **You**) and **Group** limit the rows. The log shows 20 rows. Choose **Show more** for 20 more. With no match it shows "No activity matches." With no event it shows "No activity on this board yet."

Each node and each tile state has a glyph and a text. The page reads without color.

When the connection to the server drops, the dashboard keeps the last data. The status line reads "Data from <time>". The reply, resume and decision buttons are off, with the reason "Reconnecting. Actions are off until the board stream is back."

## Memory and paused loops

Dispatch reads the memory of a Mac every 15 seconds. The reading shows as the memory line at the top of **Progress per group** on the dashboard (see "The dashboard"). Off macOS there is no reading, so the line is hidden. When 60 seconds pass without a new reading, the line adds "(stale)".

The two limits are **Free memory floor (MB)** (0 to 65536, where 0 turns the floor off) and **Swap ceiling (MB)** (256 to 65536). Set them on the **Policy** tab (see "Board policy"). When a card start, a group start or a resume is refused for memory, Dispatch shows the reason, for example "free memory 812 MB is below the 1024 MB floor".

To stop a loop by hand:

1. Open the card of a loop that has a live session. The card panel header shows **Pause** next to **Reset**.
2. Choose **Pause**. Dispatch stops every process of the loop until you resume it. On a narrow panel the button shows only its icon and keeps the name **Pause**.
3. The card shows a paused badge. The panel shows a note. The note reads "Paused. Resume it when you are ready." after you pause the loop. It reads "Paused for memory. Dispatch resumes it when swap falls." when Dispatch paused the loop because of memory.
4. Choose **Resume** in the same place to continue the loop.

**Run Claude** is off on a paused card. Its tooltip reads "Resume the loop first". When a pause or a resume fails, a message names the reason.

## The command centre

The command centre shows one orchestrator of a board as one page. It has the orchestrator, one branch for each ticket and group that it runs, and a conversation with it. The page reads the conversation and the decision items every 3 seconds. The branches follow the board stream.

### Open the command centre

- Choose **Orchestrator** in the page header of the board. When the board has no orchestrator, the button reads **Add orchestrator** from 768 px wide. On a narrower screen it reads **Orchestrator**. Both buttons open the command centre.
- Choose **Open command centre** next to the **Project map** title of the dashboard.
- Open `/boards/<key>/orchestrator` for the main orchestrator. Open `/boards/<key>/orchestrator/<orchestrator id>` for another orchestrator.
- The address `/orchestrator?board=<key>` only redirects to `/boards/<key>/orchestrator`. The same applies to `/orchestrator/<orchestrator id>?board=<key>`.

The sidebar has no row for the command centre.

### The orchestrator node

The node is the card at the top left of the canvas. It shows these items:

- The heading "Orchestrator", the name and the state badge. The badge reads **Starting**, **Stopping**, **Stopped** or the label of the session state.
- "Context <n>%" and "$<cost> today". Each shows only when Dispatch has the value.
- The count line "<n> branches, <m> need you". One branch reads "1 branch, 0 need you".

The count <n> is the number of branches in the bands. A shipped branch is not counted. The count <m> is the size of the band **Needs you**.

### The bands and the tiles

The branches stand in four bands, in this order: **Needs you**, **Running**, **Planned** and **Done**. Each band heading shows its count. A band with no branch shows only the heading. A branch belongs to the orchestrator that owns its card. A hidden card, a group member and a shipped card are not branches. Shipped work shows in the activity feed and in the board column Done.

- **Needs you** holds a branch at Needs input, Usage limit, Budget reached or Resume failed. It also holds a branch in a stuck session state.
- **Running** holds a branch with a session that works.
- **Planned** holds a branch with no session. It comes from the plan, also when its card does not exist yet.
- **Done** holds a branch at Agent done.

The stuck session states are **No progress**, **Permission prompt**, **API error**, **Session lost** and **Claude exited**.

The newest approved plan of the orchestrator sets the planned branches and their order. A newer open plan adds only the tickets that the approved plan lacks, after them. A rejected plan adds nothing.

A tile shows these items:

- The card id, the state badge and the title.
- A detail line. See the list below.
- "Playbook <name>", "Context <n>%" and "$<cost>". A planned branch with no session shows "Not started" in place of the meters.

The detail line reads as follows:

- Running: "Unit <n> of <m>, phase <p> of <q>", or "Phase <p> of <q>". A group with no phase reads "Group of <n> tickets".
- Planned: "Plan order <n>, size <size>".
- Needs input: "Needs your answer". Usage limit: "Stopped at the usage limit". Budget reached: "Budget reached".
- Done: "Done <time>, awaiting ship".

A time reads "HH:MM" on the current day. On another day it reads "<day> <month> HH:MM". The clock has 24 hours.

At 768 px wide and more, the canvas draws a line from the node to each tile. The line is dashed for a planned branch. Choose a tile to open its card. A planned branch with no card has nothing to open.

### Tile actions

A tile shows only the actions that fit its state. The actions are the same as in the attention queue.

| Action               | When it shows                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Inline reply         | The field "Reply to <card id>" and **Send reply**. The state is Needs input or No progress. |
| **Resume loop**      | The loop stopped at the usage limit or at the budget.                                       |
| **Try resume again** | The state is Resume failed.                                                                 |
| **Open terminal**    | A stuck session state, or Resume failed.                                                    |

How the actions work:

- A reply shows the count "<n> of 500 characters. A longer reply goes as a file." The result shows next to the buttons: "Delivered" or "Not confirmed. Check the terminal."
- When the session changed state, a reply shows "Not sent. <card id> is now at <state label>. Open the terminal."
- A failed action shows an alert, for example "Reply failed: <message>." The alert has the button **Try again**.
- A result and an alert hide when the branch changes state. A reply draft stays when you change a tab.
- **Open terminal** goes to the board page.

### Orchestrator controls

From 768 px wide, the controls sit in the page header. Below 768 px, they sit above the node in the page. The controls are:

- A badge "Data from <time>". It shows only while the connection is down.
- The switcher. It has the hidden label "Orchestrator". It shows only when the board has more than one orchestrator. Each option reads "<name> (Main)" or "<name> (Extra)". Choose an option to open that orchestrator.
- **Start**, **Stop** or **Resume**. One of them shows at a time. The state badge is part of the node and not of the controls.
- **Settings**. It opens the settings sheet at the **Policy** tab.

The rules of the buttons depend on the state of the session:

- **Start** shows for a stopped orchestrator. It is off when the supervisor is **Off**. Then the reason reads "Turn on the supervisor in Policy to start an orchestrator."
- **Stop** shows for a running orchestrator. It interrupts the current turn. The session stays open. It is off at a permission prompt, at a usage limit and at a shell prompt.
- **Resume** shows when the session is lost or Claude exited.
- No button shows while the orchestrator starts or stops.
- A failed button shows an alert with the reason and the button **Try again**.

### The settings sheet

The settings sheet holds the policy of the board and the orchestrators of the board. It opens at the right of the command centre. Its title is "Orchestrator settings".

To open the settings sheet:

- Choose **Settings** in the controls. The sheet opens at the **Policy** tab. Dispatch adds one history entry, so Back closes the sheet.
- Open a link that has `settings=policy` or `settings=orchestrators`. The sheet opens at that tab. Any other value opens no sheet.
- Choose **Change budget** in the attention queue of the dashboard. The sheet opens at the **Policy** tab.

The sheet has two tabs:

- **Policy**. It shows the form **Policy for** and the board name (see "Board policy").
- **Orchestrators**. It shows the table of the orchestrators and the dialogs to add one, to edit its overrides and to move groups. The tab label shows the count, for example "Orchestrators (2)". While the list loads, the label reads "Orchestrators".

A tab change does not add a history entry.

To close the sheet, choose the X button or press Escape. Back also closes it. A click on the dimmed page does not close the sheet, so an unsaved policy edit stays. Focus then returns to **Settings**. When a dialog is open, Escape closes the dialog first. A second Escape closes the sheet.

An old board link that has `panel=orchestrator` opens the command centre of the main orchestrator. With `tab=policy` or `tab=orchestrators`, the sheet opens at that tab. With `tab=terminal`, `tab=decisions` or no tab, the sheet stays closed.

While the board stream is down, the sheet header shows the badge "Data from <time>". When the list of orchestrators does not load, the **Orchestrators** tab shows the line "Orchestrators did not load: <error message>." with the button **Try again**.

From 768 px wide, the sheet has the width of the detail panel. Below 768 px, the sheet fills the full width of the screen.

### The pane

From 768 px wide, the pane stands at the right of the canvas. It is 360 px wide, and 420 px wide from 1280 px. It has two tabs:

- **Conversation**. This tab opens first.
- **Terminal**. It shows the live terminal of the orchestrator session. The terminal stays open when you change tabs.

### The conversation

The tab lists the messages and the decisions of the orchestrator in time order. Tool calls do not show. The list scrolls to the newest entry when a new entry comes.

A message shows an author, an age and the text. The author reads "You", the name of the orchestrator or "Dispatch". The age reads, for example, "5m ago". The text keeps its line breaks. It has no markdown.

A decision message shows the badge **Decision** or **Question**. A roadmap approval, a ticket proposal and a plan are a **Decision**. All other kinds are a **Question**.

- An open decision shows the same card as the attention queue. It has the question, the option buttons and the badge **Recommended**. A question also has the field "Or type an answer" and **Send answer**.
- A plan shows a table before the options. The table heads are **Order**, **Ticket**, **Playbook** and **Size**. The options are "Approve the plan" and "Do not approve".
- An answered decision shows the question, the plan table and the line "Answered: <option label>". A typed answer shows below the line.
- A failed answer shows "Decision answer failed: <message>." with the button **Try again**.

The tab shows every open decision of the orchestrator. It shows only the 20 newest answered decisions.

### The comment box

The comment box sits under the messages. It sends text to the orchestrator session.

- The field has the hidden label and the placeholder "Message the orchestrator".
- The line under the field reads "<n> of 500 characters. A longer reply goes as a file."
- The button **Send** is off when the field is empty or has only spaces. It is also off while Dispatch sends and while the connection is down.
- The result shows next to **Send**: "Delivered" or "Not confirmed. Check the terminal." After "Delivered" the field clears. After any other result the text stays.
- When the session changed state, the result reads "Not sent. <orchestrator name> is now at <state label>. Open the terminal."
- A failed send shows the alert "Message failed: <message>." with the button **Try again**. The text stays.
- Dispatch refuses a text that starts with a mode character of Claude (`/`, `!`, `#`, `&` or `@`) or that has only control characters. The alert reads "Message failed: the text is empty or starts with a mode character." Change the first character and send again.
- When the orchestrator has no session, **Send** sends no message. The alert "Message failed: <orchestrator name> has no session. Start it first." shows under the field. The text stays.

### Narrow screens

Below 768 px, the page has one column:

1. The controls: the switcher, **Start**, **Stop** or **Resume**, and **Settings**.
2. The node in a compact form. It has no heading "Orchestrator".
3. Two tabs: **Branches** and **Conversation**. **Branches** opens first.

The tab **Branches** shows the bands as a list, with the same tiles and actions. It has no lines between the node and the tiles. The tab **Conversation** is 480 px high. It holds the pane with its own tabs **Conversation** and **Terminal**.

Enter on the node selects the tab **Conversation** and the pane tab **Conversation**. Then it moves focus to the comment box. When you leave the page, the tabs return to their first values.

### States

| State   | What shows                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty   | "This board has no orchestrator." and **Start**. A board with no branch shows "No tickets or groups yet. Ask the orchestrator in the conversation." An empty pane shows "No messages yet." |
| Loading | Three grey blocks. The hidden text reads "Loading command centre".                                                                                                                         |
| Error   | An alert in the region that did not load, for example "Canvas did not load: <message>." The other region stays. The alert has the button **Try again**.                                    |
| Stale   | The last data stays. The badge "Data from <time>" shows. The line "Reconnecting. Actions are off until the board stream is back." shows above the canvas and above the comment box.        |

- A path with an unknown orchestrator id shows "Canvas did not load: no orchestrator <id> on this board."
- When Dispatch cannot read the transcript, the pane shows "The conversation is not available." and the link **Open the terminal.** The link opens the **Terminal** tab. The decision messages still show.
- While the connection is down, these controls are off: **Reply**, **Resume loop**, **Try resume again**, **Start**, **Stop**, **Resume**, the decision buttons and **Send**. **Settings**, **Open terminal** and the tiles stay on.

### Keyboard

- Tab goes through the page header, the node, the tiles in band order, and then the pane.
- The down arrow and the up arrow move focus to the next tile and to the previous tile. The node is the first stop.
- Home moves focus to the node. End moves focus to the last tile.
- Enter on a tile opens its card.
- Enter on the node moves focus to the comment box. With no orchestrator, Enter does nothing.
- The reply field and the buttons inside a tile take Tab. The arrow keys do not move focus away from them.

## The attention queue

The attention queue is the card **Needs your call** on the dashboard. Dispatch builds it from the sessions, the last gate of each group and the open decision items. An item leaves the queue when its cause ends.

Each item shows the group id, a badge, the wait time ("waiting 34 min", "waiting 5 h" or "waiting 3 d") and the actions of its kind.

| Item                  | What it shows                                                                                                            | Actions                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **Decision**          | The question, and who asked it and when. One button for each option. The recommended option has a **Recommended** badge. | Choose an option. Or type in "Or type an answer" and choose **Send answer**.                  |
| **Needs input**       | The last question of the loop.                                                                                           | Reply in the field "Reply to <group id>". Choose **Send reply**. Or choose **Open terminal**. |
| **No progress**       | "No progress for <n> min." The loop did not grow its transcript for 15 minutes while it worked.                          | Same as **Needs input**.                                                                      |
| **Permission prompt** | The prompt text from the pane.                                                                                           | **Open terminal**. Answer the prompt in the terminal.                                         |
| Usage limit stop      | "Stopped at the usage limit. The limit resets at <time>."                                                                | **Resume loop**, **Open terminal**.                                                           |
| Budget stop           | "Budget reached: $<cost> of $<budget>."                                                                                  | **Resume loop**, **Change budget**, **Open terminal**.                                        |
| **Failed gate**       | "Phase <n> gate failed, attempt <k> of <limit>."                                                                         | **Open terminal**.                                                                            |
| Failed resume         | "The session was lost and the resume failed: <reason>." or "Claude exited and the resume failed: <reason>."              | **Try resume again**, **Open terminal**.                                                      |

How each action works:

- **Answer a decision.** Dispatch stores the answer on the decision item. Dispatch records a `decision_answered` event. The orchestrator that owns the item reads it with its tools. A decision about a roadmap or a ticket proposal has no free-text answer.
- **Reply.** The reply goes to the session as typed input. Dispatch confirms that the text reached the transcript. The result shows next to the buttons: "Delivered", or "Not confirmed. Check the terminal." A reply of more than 500 characters goes to a file. The loop gets a one-line pointer to the file. The field shows the count "<n> of 500 characters. A longer reply goes as a file." Dispatch refuses a reply in the states Permission prompt, Usage limit dialog, Waiting for usage reset and Claude exited. The message then reads "Not sent. <group id> is now at <state>. Open the terminal."
- **Resume loop.** It sends the loop a continue prompt. The prompt tells Claude to read `progress.md` and `resume.md` and to continue from the recorded position. It works on a session at **Needs input**. It runs no budget check and no cap check, because you decide.
- **Try resume again.** It starts the resume of the dead session again. This is the same resume that the supervisor tried.
- **Open terminal.** It opens the detail panel of the group with its live terminal.
- **Permission prompt.** The queue has no approve button and no deny button. Answer the prompt in the terminal. The supervisor itself declines only two prompts: a dangerous delete, and a held message from a peer session.

A board with the supervisor **Off** still lists a card at **Needs input**, with a reply field when the card has a session.

## Inbox

The Inbox lists the things that wait for your decision. It shows two kinds of row:

- Slack messages that need a session.
- Linear Inbox cards.

GitHub, Sentry, Calendar and Meeting items do not show in the Inbox. They stay on their own pages.

### Needs a session

A Slack row has the badge **Needs a session** and a short reason beside it. The reason tells you why Dispatch kept the message. Two examples are "Direct question" and "Request with an action verb: review".

### Act on a row

Select a row, then press a key. Each key acts on the selected row only. You can also choose the button on the row.

| Action      | Key | What it does                                                                                        |
| ----------- | --- | --------------------------------------------------------------------------------------------------- |
| **Allow**   | `y` | Opens the Start dialog. The dialog has the playbook picker. Choose a playbook to start the session. |
| **Dismiss** | `d` | Hides the row. A toast shows **Undo**. Choose **Undo** to bring the row back.                       |
| **Restore** | `r` | Brings a dismissed row back. It works on a dismissed row only.                                      |

### Dismissed rows

The toggle **Dismissed (n)** shows the rows that you dismissed. The number n is the count of dismissed rows. Choose the toggle again to hide them. With no dismissed row the list shows "No dismissed items."

### Messages that are noise

Dispatch does not list a noise message in the Inbox. The message stays on the **Slack** page. The Slack page shows every open Slack message with its reason.

Slack messages that Dispatch stored before this change have no reason. They show "Not classified" on the **Slack** page and are not in the Inbox.

These reasons mean the message is noise:

- "Bot or app message"
- "Reaction or emoji only"
- "Acknowledgement"
- "Greeting"
- "FYI or broadcast"
- "Digest"
- "No question or request"

These reasons mean the message needs a session:

- "Direct question"
- "Request with an action verb: <verb or phrase>"

A message that starts with an acknowledgement, a greeting or a broadcast word, and then asks for something, still needs a session.

## Pull requests

The **Pull requests** page lists every open pull request of the board repositories. It also lists the pull requests that wait on you and the pull requests that your sessions opened.

A board repository is a repository that a board holds. Dispatch reads the `origin` remote of each board repository. It uses the remote only when the remote is on github.com. Dispatch skips a repository that has no GitHub remote. Dispatch also skips every repository of an archived board. Dispatch reads the list of remotes again every 10 minutes.

### The table

The table has these columns:

- The number of the pull request. It links to the pull request on GitHub.
- The title.
- The author.
- The repository.
- The state.
- The checks.
- The age.
- The linked card.

At a narrow width the table shows only the number, the title and the state. The wide table also has a **Review** button on each row.

The state is one of these texts. Dispatch shows the first text that applies, in this order:

1. "Draft"
2. "Review requested from me"
3. "Changes requested"
4. "Approved"
5. "Open"

### Filters

The filter bar has four controls. A row must pass every control that you set.

- **Mine** shows only the pull requests that you wrote. Dispatch compares the author with your GitHub login and ignores case.
- **Review requested** shows only the pull requests with the state "Review requested from me".
- The **Author** select shows the pull requests of one author.
- The **Repository** select shows the pull requests of one repository.

### Empty table

The table shows one of these texts when it has no row:

- "No open pull requests in the board repositories."
- "No board repository has a GitHub remote."
- "No pull requests match the filters."

The page shows the third text when pull requests exist but the filters hide all of them.

### More than 100 pull requests

Dispatch reads the first 100 open pull requests of the board repositories. If GitHub has more, Dispatch cuts the list. The page then shows this note: "Some pull requests may be missing: GitHub returned more than 100 results in a search, or an organization needs SAML single sign-on."

The page shows the same note in two more cases. In the first case, GitHub answers the open pull request search with an error and with some pull requests. Dispatch keeps the pull requests that GitHub returned and writes the error messages to the server log. In the second case, the open pull request search fails. Dispatch then keeps the pull requests that wait on you and the pull requests that your sessions opened. A rate limit or an authentication error still fails the whole poll.

### Review a pull request

Choose **Review** on a row or in the detail pane. Dispatch does these steps:

1. It makes one card for the pull request. If you choose **Review** again, Dispatch opens the same card. The card goes on the board that you are on, if that board has a repository for the pull request. If not, the card goes on the first open board that has one.
2. It switches the page to the board of the card, if that board is not the board that you are on.
3. It moves the card to To Do.
4. It opens the Start dialog. The dialog lists only the playbooks that have the tag `review`. The playbook "Review a pull request" is selected.

The Start dialog has the review prompt as the extra direction. Start the session from the dialog.

Dispatch matches the pull request to a repository by the GitHub name of the `origin` remote. It ignores case. The session starts in the worktree of that repository on the local branch `review/pr-<number>`. The branch is at the head of the pull request. The other repositories of the workspace stay on the normal card branch. The first prompt of the session names the branch `review/pr-<number>` for the matching repository only. The prompt tells the session to post nothing to GitHub until you approve it in the session.

The card stores the path of the repository that Dispatch matched. The Start dialog of a review card selects the registered folder that is this path or holds this path. If more than one folder holds the path, the dialog selects the longest folder. You can select another folder.

If you tick the repositories in the Start dialog and none of them has the pull request repository as its `origin`, the start fails at the step "creating worktrees".

The **Pull requests** page hides a pull request when the card of the pull request is in Done. A review card that is not in Done keeps the row of its pull request on every board that holds the repository, also when the card is on another board.

If the card is already past To Do, Dispatch opens the card. It does not start a second session.

If no open board has a repository that matches the pull request, the page shows the notice "No board repository matches this pull request." If GitHub is not connected, the page shows the notice "GitHub is not connected. Connect it in Settings."

### The header of a review card

A review card shows a header block for its pull request. The block has these parts:

- The link "PR #<number>". It opens the pull request on GitHub.
- The checks state: "Checks passing", "Checks failing" or "Checks pending".
- The verdict. It is the text after "Review verdict: " in the last DONE line of the session.

The block shows no verdict until the session writes a DONE line with "Review verdict: ".

## Budgets and usage limits

### Budget per group

The field **Budget per group (USD)** sets a cost limit for each group. The cost of a group is the sum of the costs of its sessions, as the status line reports them.

- The supervisor checks the cost when the last gate of a loop changes.
- When the cost has reached the budget, the session moves to **Needs input** with the reason "budget". The supervisor sends no key to the loop.
- The attention queue shows "Budget reached: $<cost> of $<budget>." with **Resume loop**, **Change budget** and **Open terminal**.
- **Change budget** opens the **Policy** tab of the settings sheet on the command centre.
- When you raise the budget above the cost, or remove it, the supervisor clears the budget reason within one minute. The item then becomes a normal **Needs input** item with a reply field.

When a group reaches the warning percent of its budget (80 by default), one "Budget warning" item shows in the attention queue. The sidebar count includes the item. The item goes away when you raise or remove the budget, when the group stops at its budget, or when the group is done.

The section **Cost and usage** shows a bar for each group. The text reads "$12.40 of $20.00, 62%". At the budget warning percent of the board or more (default 80) it reads "$17.10 of $20.00, 86%, near budget" and shows a warning glyph. Above 100 percent it reads "$25.00 of $20.00, 125%, over budget". With no budget it reads "$12.40, no budget". When an orchestrator override sets the budget, the text ends with "budget set by <name>".

The same section shows the usage meters of the Claude account that each live session uses: the current window and the current week. The text reads "Window 23%, resets 18:00" or "Week 85%, near limit, resets Mon 05:30". The meters come from the status line of the sessions. No control offers usage credits.

### Usage limits: wait or stop

Claude shows a usage limit dialog when the account reaches its limit. The field **At a usage limit** decides what the supervisor does.

**Wait for the reset** (`wait`, the default):

1. The supervisor selects the wait or stop row of the dialog. It presses Enter only after a new capture of the pane shows the cursor on that row.
2. It never selects a row that offers usage credits. If it finds no safe row, it does not press Enter. The session moves to **Needs input**.
3. If another account of the chain has weekly headroom, the supervisor moves the session to the account with the most headroom and the loop continues there. A pinned session does not move. The steps below apply when no account has headroom.
4. It finds the reset time in the pane. If the pane gives none, it uses the usage poll of the account. If that gives none, it waits 5 hours from the dialog.
5. Two minutes after the reset, it sends one continue prompt.
6. If the loop waits for a handoff, the supervisor leaves the automatic continue and starts a fresh session after the reset.

**Stop and ask me** (`stop`):

1. The supervisor answers the dialog in the same safe way.
2. The session moves to **Needs input** with the reason "usage_stop". The supervisor sends nothing more.
3. The attention queue shows "Stopped at the usage limit. The limit resets at <time>." with **Resume loop**.
4. Choose **Resume loop** after the limit resets.

Only you resume a loop that stopped at a usage limit or a budget.

### Claude accounts

The **Accounts** page shows one state for each Claude account:

- **Available**: the account has allowance.
- **Near limit**: a usage window is at 80 percent or more.
- **Limited**: a usage window is full. The row shows when the account resets.
- **Needs login**: Claude rejected the saved login two times in a row. Log in again.
- **Same login as Default**: the account uses the same login as your home login (**Default**). The chain does not use it.
- **Login expired**: the saved login ran out. Log in again.
- **Unknown**: Dispatch has no usable usage read for the account yet.

A limited account returns by itself. When its usage shows a new period, Dispatch puts the account back in the chain before the old reset time. You do nothing.

When an account needs a login, Dispatch raises the decision "Account <email> needs a login" on the default board:

1. Choose **Start the login**.
2. Open the link in the decision. It opens the login dialog of that account.
3. Open the sign-in address and paste the code into the dialog.

The account returns to the chain after the login. You do not restart Dispatch. Choose **Not now** to leave the account out of the chain. The decision closes by itself when the account works again, or when you remove the account. Dispatch refuses a switch to an account that needs a login, and the switch dialog tells you to use **Re-login** first.

When an account shows **Same login as Default**, choose **Remove duplicate**. The button removes the account and signs out only the folder of that account. Your home login stays signed in. Dispatch refuses a switch to an account that shows **Same login as Default**, and the switch dialog tells you to switch to **Default** or remove the duplicate.

When every account is at its limit, Dispatch raises the decision "Every Claude account is at its limit". The text shows when the first account resets. Work resumes at that time. To continue sooner, choose **Add an account** and add an account on the **Accounts** page. Choose **Wait for the reset** to do nothing. The decision closes by itself when an account is usable again.

When the home login is signed in and you did not move Default, the **Accounts** page shows the panel **Move the Default account to a Dispatch login**. If an added account has the same login as Default, remove that duplicate first; the panel then shows. You cannot dismiss the panel. It goes away when you finish the move.

After the move, Dispatch can track the usage of **Default** and can move its sessions, as it does for any other account. To do the move:

1. Choose **Log in** in the panel.
2. Open the sign-in address and paste the code into the dialog.
3. Sign in with the same Claude account as your terminal login.

If you sign in with another account, the login fails. The dialog shows "Sign in with the same Claude account as your terminal login (<email>)." Choose **Log in** again and use the account of your terminal login.

Running sessions keep running. New starts, resumes and moves use the Dispatch login. Your terminal login stays signed in.

To undo the move, remove the account with the meta **Default (Dispatch login)**. **Default** is then your home login again, and the panel shows again.

## Resume a lost session

When the tmux session of a card ends, for example after a shutdown, the card shows **Resume**. Resume starts Claude again in the card workspace and opens the newest conversation of the card.

- Dispatch reads the conversation folder of the card before each Resume. When a newer conversation is on disk than the stored one, Resume opens the newer conversation.
- When the stored conversation has no file on disk, Resume continues the newest conversation of the workspace.
- The detail panel shows the line "Resume: <id>, started <time>" beside **Resume**, or "Resume: newest conversation in the workspace". When Dispatch replaced the stored conversation, a tooltip on the line gives the stored id and the reason.

## Handoff

A handoff gives the loop a fresh conversation and keeps its place in the roadmap. The supervisor starts a handoff when the context of the session fills.

The supervisor reads the context percent from the status line of the session.

- **At the handoff percent** (default 50), the supervisor sends one handoff request. The request tells the loop not to interrupt work in progress. The loop lets background agents finish and records the current phase gate. Then it invokes the session-handoff skill and writes `resume.md`. It updates `progress.md` with the exact unit and phase. As its last action, it sets the `session_id` line of the engine file to `handoff-pending`. It prints `HANDOFF_READY <slug>` and ends its turn.
- **At the hard handoff percent** (default 80), if the loop has not handed off, the supervisor sends one hard request. The request tells the loop to hand off now and to start no new work.
- The supervisor sends each request once for each crossing. The crossing re-arms when the percent falls under the handoff percent, for example after a clear.

When the loop shows the state **Handing off** and the engine file says `handoff-pending`:

1. The supervisor waits up to 60 seconds for the turn to end.
2. It clears the conversation with `/clear`.
3. It sends the resume prompt. The prompt tells the new session to write its own session id into the engine file, and to read `resume.md`.
4. It checks that the new session id is in the engine file within 80 seconds.
5. If a step is not confirmed, the session moves to **Needs input**.

If a repeated handoff request arrives in the first five minutes after the resume, the supervisor sends one line that cancels it.

The supervisor also hands off a single PRD loop at the handoff percent. The loop writes its resume prompt in its feature folder.

An orchestrator uses the same thresholds. Its request tells it to call `write_state` with the full state and `handoffReady` set to true. Then it prints `HANDOFF_READY <orchestrator id>`. The fresh session starts with a prompt to call `read_state` first.

## Ship flow

The ship flow merges the branches of a finished group in order. It runs when the main orchestrator calls the `start_ship` tool for a group, or for a single card that it started. The field **Ship rights** decides what it may do.

| Ship rights            | What the flow does                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **None, I ship**       | Dispatch refuses the `start_ship` call. A flow that runs stops when you set this value. You ship by hand.        |
| **Open PRs**           | The flow checks and pushes each branch, opens its PR and waits for the checks. You merge each PR.                |
| **Open and merge PRs** | The flow does the same, and then squash merges each PR. When every branch is merged, it moves the group to Done. |

A flow starts only when all of these are true:

- Every unit of the loop is built or shipped.
- The loop engine file is closed.
- Every group that this group depends on is merged.
- No other flow runs on the board.
- The branches are unit branches or the specs branch of the loop. The flow refuses `main`, `master`, `HEAD` and the base branch.

For each branch, the flow goes through these states.

| State            | Label                  |
| ---------------- | ---------------------- |
| `queued`         | Queued                 |
| `merging_main`   | Merging main           |
| `checking`       | Checking               |
| `pushing`        | Pushing                |
| `waiting_checks` | Waiting for checks     |
| `waiting_merge`  | Waiting for your merge |
| `merging`        | Merging                |
| `verifying`      | Verifying              |
| `merged`         | Merged                 |
| `failed`         | Failed                 |

The state **Waiting for your merge** replaces **Merging** when the rights are **Open PRs**. In the **Checking** state, the flow checks that the diff holds only this branch and that the check command of the repository passes. In the **Verifying** state, it checks the author and the message of the new tip of main against the git identity at the start.

The section shows one block for each group. A block shows the flow state: **Running**, **Stopped** or **Done**. It also shows one row for each branch. The columns are **Order**, **Branch**, **PR**, **Ship state**, **Checks** and **Author**. The check states are **Not started**, **Pending**, **Passing** and **Failing**. The author states are **Not checked yet**, **Author verified** and **Author mismatch**.

When a branch fails, the flow stops. The block shows "Stopped at <step>: <reason>". Dispatch raises a decision item in the attention queue. A flow that ran when the server stopped starts again at boot.

## Playbook reference

A playbook is a markdown file with a name. Dispatch gives its text to Claude when a session starts. Dispatch seeds eight playbooks on the first boot of a machine. Each seeded playbook is a file in the `playbooks` folder of the Dispatch data folder. Dispatch seeds a name once. If you delete a seeded playbook, it stays deleted. Open **Playbooks** in the sidebar, group **System**, to edit, copy or delete playbooks.

Every seeded playbook has one input: the extra direction. It is the optional text that you type in the start dialog. The token `{extra}` in the playbook marks where the text goes. When you type nothing, Dispatch removes the block that holds the token.

### PRD + Ralph Loop

- **File:** `prd-ralph-loop.md`
- **When to use:** a ticket whose scope is not settled and that needs a phased PRD and a loop.
- **Inputs:** the extra direction.
- **What it does:** it tells Claude to use the grill-me skill to test the scope until the requirements stop changing. Then it tells Claude to use the write-prd skill to write a phased `PRD.md`. Then it tells Claude to use the ralph-loop skill to run the PRD phase by phase. Claude uses the QA subagent mode unless the PRD is trivial. Claude passes the path of the PRD from the write-prd step to the ralph-loop step.

### Superpowers

- **File:** `superpowers.md`
- **When to use:** a ticket that needs an approved design before code.
- **Inputs:** the extra direction.
- **What it does:** it tells Claude to use the Superpowers brainstorming skill and reach an approved design before any code. Then it tells Claude to use the writing-plans and executing-plans skills to write a plan and run it. For large work, Claude can use the subagent-driven-development skill.

### GSD

- **File:** `gsd.md`
- **When to use:** a repository that uses the GSD workflow.
- **Inputs:** the extra direction.
- **What it does:** if the repository has a GSD project for related work, Claude plans and runs the ticket with the gsd-plan-phase and gsd-execute-phase skills. Otherwise Claude starts with gsd-new-project, or with gsd-new-milestone when a project exists but needs a new milestone. Then it plans and runs the resulting phase.

### Write code directly

- **File:** `write-code-directly.md`
- **When to use:** a small ticket that needs no process.
- **Inputs:** the extra direction.
- **What it does:** it adds no workflow text. The session gets your extra direction. Dispatch still adds its standard kickoff text, such as the workspace orientation and the status protocol.

### Roadmap Loop

- **File:** `roadmap-loop.md`
- **When to use:** two or more related tickets with an order or shared files, or any ticket that spans server, web and docs across modules.
- **Inputs:** the extra direction.
- **What it does:** it tells Claude to read every ticket of the group first. In part 1, Claude uses the write-roadmap skill on the whole group and stops for roadmap approval. After the approval, Claude uses the grill-me skill and then the write-prd skill for each unit in order. In part 2, Claude uses the roadmap-loop skill to run every unit. Claude commits each unit to a stacked local branch. Claude never pushes, tags, opens a PR or merges.

### Review a pull request

- **File:** `review-pull-request.md`
- **When to use:** one pull request to review before it merges. Dispatch selects it when you choose **Review** on the **Pull requests** page.
- **Inputs:** the extra direction. The Review action fills it with the review prompt.
- **What it does:** it tells Claude to read the pull request first with `gh pr view` and `gh pr diff`. Then it tells Claude to review the pull request with subagents from three perspectives: correctness, edge cases and security. Claude verifies each finding against the code and drops a finding that the code does not support. Claude shows the comments to you in the session. Claude posts a comment with `gh` only after you approve it in the session. Claude ends with the DONE status line. The summary of that line starts with "Review verdict: ", then approve, request changes or comment, then one line of reason.
- **Tag:** the playbook has the tag `review`.

### Board Orchestrator

- **File:** `board-orchestrator.md`
- **When to use:** you do not pick this playbook. Dispatch selects it by name when it starts an orchestrator.
- **Inputs:** the extra direction. For an orchestrator, Dispatch writes it: "You are the orchestrator "<name>" (id <id>) of board <KEY>. Use the dispatch tools to coordinate the work of this board."
- **What it does:** it tells the orchestrator to keep its state in the tools and not in memory. The orchestrator follows these steps:
  1. Call `read_state`. Then call `get_rulebook` and follow the rule book. Call `get_rulebook` again after each handoff.
  2. Handle a line that you type in the terminal as a direction, like a new intake.
  3. Read a message that starts with "Dispatch wake:" as a message from Dispatch. Read the board state with the dispatch tools and continue.
  4. End every turn with `wait_for_event`. Never end a turn with only a report.
  5. Call `write_state` after each decision, with the full state.

  The rule book holds the rules for intake, playbook choice, grouping, the plan, starts, directions, monitoring, ship and release (see "How the orchestrator judges and starts work").

  The rule book tells the orchestrator to check `get_group_progress` and `read_pane_tail` after a usage limit, before it sends input. It tells each loop never to run a dangerous `rm`. The orchestrator hands off only when asked. The playbook forbids these actions:

  - Write or edit code or any file in a repository.
  - Commit, push, merge or rebase outside the ship flow.
  - Select usage credits.
  - Read the vault or an env file.
  - Change a policy.
  - Kill a process.
  - Start a loop above the cap.
  - Act on another board.
  - Answer its own decision item or approve a permission prompt.
  - Delete a branch, a worktree or a card that it did not create.

### Release

- **File:** `release.md`
- **When to use:** you do not pick this playbook. The orchestrator starts it on the card that `release_prep` made.
- **Inputs:** the extra direction.
- **What it does:** it tells Claude to read the release card, bump the version in `package.json`, run the check command and commit the bump. Then it tells Claude to draft the release notes and record the demo. Claude never pushes, tags or opens a pull request. When the orchestrator says that the bump pull request merged, the orchestrator also names the current ship rights. Claude publishes the release only when those ship rights are merge, and never by hand. Else Claude asks you to publish.

### The tags key

A playbook can have a `tags:` line in its front matter. The value is a comma separated list. Dispatch makes each tag lower case and removes a repeated tag.

The Review action of the **Pull requests** page lists only the playbooks that have the tag `review`. To use your own review playbook, add `tags: review` to its front matter. The playbook then shows in the Start dialog of the Review action.

When no playbook has the tag, the Start dialog shows "No playbook has the tag review.".

The Start dialog and the group dialog select the playbook that you used for the last start. They skip this playbook when it has the tag `review`. A start that is not a Review start therefore does not select the review playbook. The Review action still selects "Review a pull request".

## Replaced manual scripts

Before this feature, a person ran a set of manual scripts next to Dispatch. Dispatch now does each job. The scripts are outside this repository, in the workspaces folder. This release deletes no file. Remove a script when no running loop uses it.

| Manual script or session     | What Dispatch does instead                                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `watch-loops.zsh`            | The marker watcher and the status-line parser. The marker watcher reads every live pane every 2 seconds. The supervisor sorts each session into one of 12 states. It marks a session idle when the pane is unchanged in three reads, 60 seconds apart, and shows no busy sign. |
| `resume-loop.zsh`            | The resume loop. The supervisor resumes a lost session or a session at a shell prompt, and sends the resume prompt. If the resume fails, the attention queue shows **Try resume again**. The button **Resume loop** sends a continue prompt to a loop at **Needs input**.      |
| `resume-after-reset.zsh`     | The usage limit flow. With **Wait for the reset**, the supervisor sends one continue prompt two minutes after the reset. With **Stop and ask me**, the attention queue holds the loop until you choose **Resume loop**.                                                        |
| `handoff-request.md`         | The supervisor handoff request. It sends the request at the handoff percent and the hard request at the hard handoff percent, and then starts the fresh session itself.                                                                                                        |
| The `keepawake` tmux session | The supervisor keep-awake. The supervisor holds one `caffeinate -is` process while a session of a supervised board runs. It stops the process when no such session runs. The `-w` option ties the process to the server, so a crashed server never keeps the Mac awake.        |

## Run the scenario tests

The steps to run the scenario tests are in the "Scenario Tests" section of `docs/ARCHITECTURE.md`.
