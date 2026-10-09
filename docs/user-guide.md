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
2. Choose **New board**. The dialog **New board** opens.
3. Fill the fields.

| Field                | What to enter                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Key**              | 2 to 6 capital letters or digits. The key starts with a letter. You cannot change the key later. `LOCAL` and `GROUP` are reserved. |
| **Name**             | The name of the board.                                                                                                             |
| **Sessions folder**  | The folder in which Dispatch makes one folder for each session.                                                                    |
| **Repository path**  | The path of a git repository. Choose **Add repository** to add more rows.                                                          |
| **Base branch**      | The base branch of that repository.                                                                                                |
| **Check command**    | The command that the ship flow runs as the check of that repository. The row shows the placeholder `npm run check`.                |
| **Linear team keys** | Linear team keys, separated by commas. New Linear issues of these teams go to this board.                                          |

4. Choose **Create board**. The dialog closes and the message "Board <name> created." shows. You stay on the boards page. The board switcher still shows the old board.
5. Open the new board. In its row, choose **Board actions**, then **Open board**. Or choose the new board in the board switcher.

These fields are required: **Key**, **Name**, **Sessions folder** and the path of one repository. The form shows an error under a field that is empty or wrong. **Base branch**, **Check command** and **Linear team keys** are optional. An empty **Check command** becomes `npm run check`. Enter the sessions folder and the repository path as absolute paths.

The key must be new. Dispatch refuses a key that another board or a Linear team already uses. A board needs at least one repository.

### Switch boards

The sidebar shows the board switcher when more than one board is active. Choose the switcher, or press `B`, and select a board. The switcher shows the number of items that need attention for each board.

The palette also has **Switch to board** commands, **Manage boards** and **New board**.

### Manage boards

**Manage boards** opens the boards page. The table has the columns **Name**, **Key**, **Repositories**, **Running**, **Open groups**, **Attention** and **Loops**. The **Loops** column shows each running loop as a group id and a percent, for example `ORC-6 40%`.

The row menu **Board actions** has three items.

- **Open board** opens the board.
- **Edit** opens the dialog **Edit board**. You can change everything except the key.
- **Archive** hides the board from the switcher. The cards and sessions stay. The item is off while sessions run on the board. Restore the board from **Archived boards** with **Restore**.

### The default board

`LOCAL` is the default board. It is the board that Dispatch shows when no other board is selected.

- You cannot archive it.
- Its repositories come from **Settings**, **Workspaces**. A change in its **Edit board** dialog also changes that list. The dialog shows the repository path only.
- Its supervisor starts **Off**. A new board starts with the supervisor **On**.

## Orchestrated board setup

An orchestrated board needs three things: repositories, a policy and an orchestrator.

### Repositories

Add the repositories when you create the board, or choose **Edit** later. Each repository has a path, a base branch and a check command. The ship flow runs the check command.

### Board policy

To open the policy form of a board:

1. If the board does not exist, create it (see "Create a board").
2. Select the board in the board switcher (see "Switch boards").
3. Open the board page.
4. Choose **Orchestrator**, or **Add orchestrator** when the board has none. The panel has four tabs: **Terminal**, **Decisions**, **Policy** and **Orchestrators**.
5. Open **Policy**. The form is called **Policy for** and the board name.

Only you can change the policy. The orchestrator reads it. No tool can change it.

| Label                               | Allowed values                                                                                   | Default                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------- |
| **Roadmap approval**                | **Ask me for each roadmap**, **Approve when the rules pass, else ask**, **Approve each roadmap** | **Ask me for each roadmap** |
| **Loops at once**                   | A whole number from 1 to 10                                                                      | 3                           |
| **Loop model**                      | **Session settings**, or a model with the effort `high` or `max`                                 | **Session settings**        |
| **Group playbook**                  | **None**, or a playbook name                                                                     | **None**                    |
| **Orchestrator model**              | **Opus 5.5**, **Sonnet 5.5**, **Fable 5.1**                                                      | **Opus 5.5**                |
| **Handoff at context percent**      | A whole number from 10 to 95                                                                     | 50                          |
| **Hard handoff at context percent** | A whole number above the handoff percent, up to 100                                              | 80                          |
| **Wake timer (minutes)**            | A whole number from 0 to 1440                                                                    | 15                          |
| **At a usage limit**                | **Wait for the reset**, **Stop and ask me**                                                      | **Wait for the reset**      |
| **Ship rights**                     | **None, I ship**, **Open PRs**, **Open and merge PRs**                                           | **None, I ship**            |
| **Budget per group (USD)**          | An amount above 0 and at most 100000, or empty for **No limit**                                  | Empty (**No limit**)        |
| **Supervisor**                      | **On**, **Off**                                                                                  | **On** (**Off** on `LOCAL`) |

Notes on the fields:

- **Roadmap approval** controls how the orchestrator approves the plan of a loop. With **Ask me for each roadmap**, the `approve_roadmap` tool needs your approve answer on a decision item of that group. With the two other values, the tool call is allowed. With **Approve when the rules pass, else ask**, the playbook judges the rules.
- **Loops at once** is the concurrency cap. Dispatch refuses the orchestrator tool that starts a group above the cap. A group that waits for its dependencies stays queued. The supervisor starts it when the dependencies are done and a slot is free.
- **Loop model**: The model and effort of the sessions of a group. When you choose a model, Dispatch starts each group session with that model and effort, and it ignores any model or effort in the Settings Claude arguments. When you choose **Session settings**, Dispatch uses the Settings.
- **Group playbook**: the playbook of a group that the orchestrator creates without one. When the playbook no longer exists, the group starts with no playbook. When the stored name is not in the list of playbooks, the select shows it as "<name> (not found)", and **Save policy** keeps the name.
- **Wake timer (minutes)**: Wakes an idle orchestrator after this many quiet minutes. 0 turns it off. An extra orchestrator cannot override it.
- **Supervisor** must be **On** to start an orchestrator. The form says: "The supervisor watches the loops of this board. An orchestrator needs it."
- Choose **Save policy** to save. The button is off until a field changes. The message "Policy saved." confirms the save.
- The number fields are text inputs. The form checks the ranges while you type and shows an error under the field. **Save policy** saves nothing while a field has an error.

The server accepts wider number ranges than the form does. The form ranges in the table are the ones to use.

## Add and start an orchestrator

1. Select the board in the board switcher. Open the board page. Every board has its own button. `LOCAL` has one too, and its supervisor starts **Off**.
2. Choose **Add orchestrator** in the page header. When the board already has an orchestrator, the button reads **Orchestrator**. The orchestrator panel opens as a side panel over the board. Its header shows the board name.
3. Make sure the supervisor is **On** in the **Policy** tab. With the supervisor **Off**, the panel shows: "Turn on the supervisor in Policy to start an orchestrator."
4. Choose **Start orchestrator**.

When the board has no orchestrator record, **Start orchestrator** first adds the main orchestrator. The record has the id `main` and the name "Main orchestrator". Then it starts the orchestrator.

The orchestrator reads the folder and the repositories of the board by itself. It does not ask you for a repository path or a base branch. Set the base branch of each repository in the board settings.

The default board `LOCAL` stores no base branch, so its repositories answer base null. On `LOCAL` the orchestrator passes `repos` with a base to `create_group`. For example, it uses a branch that it makes with `create_base_branch`.

The start does these things:

- It creates a hidden card named "Orchestrator: Main orchestrator". The card holds the session.
- It writes an MCP configuration file for the `dispatch mcp` command. The file holds no token.
- It starts a Claude session in tmux with the playbook **Board Orchestrator**.
- It passes the model of the **Orchestrator model** field to Claude.
- It limits the tools. Claude gets the read tools `Read`, `Glob` and `Grep`, and the Dispatch tools. The tools `Bash`, `Write`, `Edit` and `NotebookEdit` are off.

The panel header shows the state of the session as a badge. The badge uses the session states of a loop. These are the values you see most:

- **Starting** (with a spinner). The start runs.
- **Working**. The orchestrator runs. This is the healthy state. The **Stop** button shows.
- **Idle**. The session runs and waits.
- **Needs input**, **Permission prompt**, **Usage limit dialog** and **Waiting for usage reset**. The session waits. Open the **Terminal** tab.
- **Session lost** and **Claude exited**. The session ended. **Resume orchestrator** shows.

When the orchestrator waits at its prompt, Dispatch wakes it. Dispatch types one line that starts with "Dispatch wake:" when you answer its decision item, when one of its groups reaches Agent done, needs input, fails to start, ships, stops its ship flow, hits a loop error or a usage limit, and when the **Wake timer (minutes)** of the policy runs out. Dispatch never types while the orchestrator works, types at most one line in 20 seconds, and never wakes a stopped orchestrator.

The hidden card and the MCP configuration file do not show in the UI. To confirm a start, check these signs:

1. The badge reads **Working** and the **Stop** button shows.
2. The **Terminal** tab shows the live terminal.
3. The **Activity log** of the dashboard shows a row such as "Supervisor: a card is now Working".

The start can fail. The panel then shows the line "The orchestrator did not start: <reason>." The reason names the step and the last text of the Claude pane. Dispatch waits about 30 seconds for Claude to be ready, so the badge can read **Starting** for some time before the line shows. Choose **Try again** beside the line to start again. The board now has a main orchestrator, so the page header button reads **Orchestrator**.

The **Terminal** tab shows the live terminal. The panel buttons depend on the state:

- **Start orchestrator** starts a stopped orchestrator. It shows when the orchestrator is stopped, also after a failed start.
- **Stop** interrupts the current turn. The session stays open. The button is off when the session shows a permission prompt, the usage limit dialog or the wait for the usage reset.
- **Resume orchestrator** shows when the session is lost or Claude exited. It starts Claude again in the open session, or it starts the session again.

The **Decisions** tab lists the open decision items of the board. The **Orchestrators** tab lists the orchestrators. The **Last wake** column, after **Policy**, shows the reasons and the time of the last wake, for example "timer 15 min at 14:05", or **None** when the orchestrator has not woken. An extra orchestrator needs a scope of groups or tickets, and it needs the main orchestrator first. Choose **Add extra orchestrator** to add one.

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
- The dashboard section **Progress per group** shows one row for each group that has a loop.
- The dashboard section **Activity log** shows the gate events.

## The dashboard

Open the dashboard from the sidebar row **Dashboard** (group **Work**), or from the palette command **Go to Dashboard**. The sidebar row and the palette command show only when the board has a main orchestrator. The dashboard shows the board that is selected in the switcher.

The page has six sections in a fixed order. Each section shows its own loading state and its own error. A section error has the button **Try again**. The other sections stay.

1. **Attention queue.** Each item that needs you, oldest wait first. With no item it shows "Nothing needs you."
2. **Progress per group.** One row for each group that has a loop. With no loop it shows "No loops on this board yet. Start a group from the board to see its progress here." The count of the section reads "<n> of <cap> loops running". A row shows these items:
   - The group id, the loop slug and the session state badge.
   - The context percent, for example "Context 38%".
   - The session age and an estimate of the time left. The estimate reads "Estimate after 2 gates" until two gates passed.
   - A text label such as "Unit 2 of 3, phase 4 of 9". A complete loop shows "3 of 3 units built, awaiting ship".
   - A bar with one segment for each unit.
   - The last gate line: "Phase 3 gate passed 12:41" or "Phase 4 gate failed 13:05, attempt 1 of 2".
3. **Tickets by column.** The cards of the board for each column, with the count of cards that an orchestrator created (**By orchestrator**). The link **Open board** goes to the board. Choose **Show cards** to list the cards. The filters **Group** and **Column** limit them.
4. **Activity log.** One row for each recorded event, newest first. The orchestrator rows are tool calls and raised decisions. The supervisor rows are actions, session state changes, loop gates, PR changes and a wake of the machine. Your rows are the decisions that you answer and the goals that you submit. A policy save, a board change and a press of **Start orchestrator** write no row of their own. The filters **Actor** (**All**, **Orchestrator**, **Supervisor**, **You**) and **Group** limit the rows. The log shows 20 rows. Choose **Show more** for 20 more. With no event it shows "No activity on this board yet."
5. **PRs and merge order.** One block for each group in ship order. See the section "Ship flow". With no PR it shows "No PRs yet."
6. **Cost and usage.** The cost of each group against its budget, and the usage meters of the Claude account. With no cost it shows "No cost yet." See the section "Budgets and usage limits".

Each segment of the progress bar has a glyph and a text name (done, current, pending or failed gate). The bar reads without color.

When the connection to the server drops, the dashboard keeps the last data. A badge beside the title reads "Data from <time>". The reply, resume and decision buttons are off, with the reason "Reconnecting. Actions are off until the board stream is back."

## The attention queue

The attention queue is the first section of the dashboard. Dispatch builds it from the sessions, the last gate of each group and the open decision items. An item leaves the queue when its cause ends.

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

## Budgets and usage limits

### Budget per group

The field **Budget per group (USD)** sets a cost limit for each group. The cost of a group is the sum of the costs of its sessions, as the status line reports them.

- The supervisor checks the cost when the last gate of a loop changes.
- When the cost has reached the budget, the session moves to **Needs input** with the reason "budget". The supervisor sends no key to the loop.
- The attention queue shows "Budget reached: $<cost> of $<budget>." with **Resume loop**, **Change budget** and **Open terminal**.
- **Change budget** opens the **Policy** tab.
- When you raise the budget above the cost, or remove it, the supervisor clears the budget reason within one minute. The item then becomes a normal **Needs input** item with a reply field.

The section **Cost and usage** shows a bar for each group. The text reads "$12.40 of $20.00, 62%". At 80 percent or more it reads "$17.10 of $20.00, 86%, near budget" and shows a warning glyph. Above 100 percent it reads "$25.00 of $20.00, 125%, over budget". With no budget it reads "$12.40, no budget". When an orchestrator override sets the budget, the text ends with "budget set by <name>".

The same section shows the usage meters of the Claude account that each live session uses: the current window and the current week. The text reads "Window 23%, resets 18:00" or "Week 85%, near limit, resets Mon 05:30". The meters come from the status line of the sessions. No control offers usage credits.

### Usage limits: wait or stop

Claude shows a usage limit dialog when the account reaches its limit. The field **At a usage limit** decides what the supervisor does.

**Wait for the reset** (`wait`, the default):

1. The supervisor selects the wait or stop row of the dialog. It presses Enter only after a new capture of the pane shows the cursor on that row.
2. It never selects a row that offers usage credits. If it finds no safe row, it does not press Enter. The session moves to **Needs input**.
3. It finds the reset time in the pane. If the pane gives none, it uses the usage poll of the account. If that gives none, it waits 5 hours from the dialog.
4. Two minutes after the reset, it sends one continue prompt.
5. If the loop waits for a handoff, the supervisor leaves the automatic continue and starts a fresh session after the reset.

**Stop and ask me** (`stop`):

1. The supervisor answers the dialog in the same safe way.
2. The session moves to **Needs input** with the reason "usage_stop". The supervisor sends nothing more.
3. The attention queue shows "Stopped at the usage limit. The limit resets at <time>." with **Resume loop**.
4. Choose **Resume loop** after the limit resets.

Only you resume a loop that stopped at a usage limit or a budget.

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

An orchestrator uses the same thresholds. Its request tells it to call `write_state` with the full state and `handoffReady` set to true. Then it prints `HANDOFF_READY <orchestrator id>`. The fresh session starts with a prompt to call `read_state` first.

## Ship flow

The ship flow merges the branches of a finished group in order. It runs when the main orchestrator calls the `start_ship` tool for a group. The field **Ship rights** decides what it may do.

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

For each branch, the flow goes through these states. The dashboard section **PRs and merge order** shows them.

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

A playbook is a markdown file with a name. Dispatch gives its text to Claude when a session starts. Dispatch seeds five playbooks on the first boot of a machine. Each seeded playbook is a file in the `playbooks` folder of the Dispatch data folder. Dispatch seeds a name once. If you delete a seeded playbook, it stays deleted. Open **Playbooks** in the sidebar, group **System**, to edit, copy or delete playbooks.

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

### Board Orchestrator

- **File:** `board-orchestrator.md`
- **When to use:** you do not pick this playbook. Dispatch selects it by name when it starts an orchestrator.
- **Inputs:** the extra direction. For an orchestrator, Dispatch writes it: "You are the orchestrator "<name>" (id <id>) of board <KEY>. Use the dispatch tools to coordinate the work of this board."
- **What it does:** it tells the orchestrator to keep its state in the tools and not in memory. The orchestrator follows these steps:
  1. Call `read_state`, then `get_board_workspace`, `list_cards`, `list_events` and `get_policy`. Never ask you for a repository path or a base branch that the board holds.
  2. Turn a goal into a ticket proposal (a decision item of the kind `ticket_proposal`). Wait for your approval. Then create the tickets with `create_ticket`.
  3. Write a direction for each group before it starts.
  4. Start groups only inside the concurrency cap.
  5. Approve or escalate each roadmap as **Roadmap approval** says.
  6. Answer loop inputs with `send_input`.
  7. End every turn with `wait_for_event`. Set `kinds` to `decision_answered`, `group_state` and `intake_submitted`, and `timeoutSeconds` to 55. When it times out, call it again. Never end a turn with only a report.
  8. Ship in order with `start_ship` when the ship rights allow it. When the ship rights allow it, it ships a group in Agent done without a decision item.
  9. Report to you. Raise a decision item with `create_decision_item` when a person must decide.
  10. Call `write_state` after each decision, with the full state.

  A message that starts with "Dispatch wake:" comes from Dispatch. Read the board state with the dispatch tools and continue.

  After a usage limit, it checks `get_group_progress` and `read_pane_tail` before it sends input. It tells each loop never to run a dangerous `rm`. It hands off only when asked. The playbook forbids these actions:

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
