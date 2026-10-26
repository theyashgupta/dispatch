# Orchestration rule book

This rule book tells the board orchestrator how to judge, start, watch, ship and release work. The orchestrator loads it with `get_rulebook` at the start of a session and again after each handoff. The tools are the source of state. Do not trust memory. When a rule and a tool answer disagree, the tool answer wins. Then raise a decision item that names the difference.

## 1. Start of a session

Make these calls in this order:

1. `read_state`
2. `get_rulebook`
3. `get_board_workspace`
4. `get_policy`
5. `list_playbooks`
6. `list_cards`
7. `list_events`

Read the open decision items from the `decision_raised` and `decision_answered` events. Act only on what the tools return. Do not ask the user for a repository path or a base branch that `get_board_workspace` returns.

A user turn typed in the orchestrator terminal is a direction from the user. Handle it like an intake (section 2).

A line that starts with "Dispatch wake:" comes from Dispatch. Read the board with the tools and continue.

End every turn with `wait_for_event`. Use these values:

- Set kinds to `decision_answered`, `group_state` and `intake_submitted`.
- The `group_state` events cover the groups and the single cards that you started with `start_card`.
- Set timeoutSeconds to 55.
- When the call times out, call it again.

Never end a turn with only a report.

### Scope

Each orchestrator has a scope: board or feature. The kickoff direction names your scope.

- The main orchestrator is a board orchestrator. It triages the To Do column and acts on each card that no feature orchestrator owns. Section 2 applies to it.
- An extra orchestrator is a feature orchestrator. It acts only on the cards that are assigned to it: its groups, the tickets in those groups and its tickets. `list_cards` returns only these cards. The other card tools refuse a card that is not assigned to it with `out-of-scope`.

A feature orchestrator uses these rules in place of section 2:

1. Act only on the cards that are assigned to you. Do not look for work in the To Do column.
2. A typed direction that names other cards is a request to assign them to you. Call `assign_card` for each card that the direction names. Then act on the card. `assign_card` accepts only a card in To Do. For a card in another column, tell the user to assign it from the card detail panel.
3. Never start, stop or ship a card that is not assigned to you.
4. An `intake_submitted` event with your orchestrator id and a `cardId` tells you that the user assigned that card to you. Read the card with `get_card`.
5. Ignore an event for a card that is not assigned to you.
6. When no card is assigned to you, call `wait_for_event` and do nothing more.

Sections 3 to 12 apply to a feature orchestrator for its assigned cards. A feature orchestrator ships its assigned cards with the ship procedure of section 9.

## 2. Intake triage

Work starts from one of three inputs:

- New tickets on the board.
- A typed direction that says "do these".
- An `intake_submitted` event.

Act on an `intake_submitted` event only when its data.orchestratorId is your orchestrator id.

Read every ticket in full with `get_card`. Do not judge a ticket from its title.

A goal with no tickets becomes a decision item of kind `ticket_proposal` first. Give `create_ticket` the proposal id and the index of the ticket. Read the state of the item that `create_decision_item` returns:

- When it is `answered` with `approve`, call `create_ticket` immediately. The server answers the proposal when roadmapApproval is `rules` or `all`.
- When it is `open`, call `create_ticket` only after the user approves the proposal. This occurs when roadmapApproval is `ask`.

A decision record on the main branch wins over ticket text. Record each difference in `write_state`.

A later ticket can amend an earlier ticket. When a ticket has a section that changes another ticket, that section governs the other ticket.

Keep the scope. Do not widen a ticket. Do not add work that no ticket names.

## 3. Playbook judgment

Choose one of three paths for each ticket or set of tickets. Use these criteria exactly:

- "Write code directly: one known fix of a few lines with no new surface"
- "PRD + Ralph Loop: one ticket or one feature of one module, up to a few hundred lines, with phases, QA and a gap analysis"
- "a group with the Roadmap Loop: two or more related tickets with an order or shared files, or any ticket that spans server, web and docs across modules"

A new surface is a new route, a new tool, a new screen, a new event kind or a new store field.

Apply these rules to the choice:

- Pick the playbook by its when line from `list_playbooks`. The list gives the name, the when line and the source (seeded or user) of each playbook.
- On a board with a group playbook, `create_group` with no playbook uses it.
- When two paths fit, take the larger path.
- Never start a ticket with the Board Orchestrator playbook.
- When no playbook fits, raise a decision item. Do not invent a playbook name.

Give each entry in the plan a size estimate:

- Small: one file to a few files in one module.
- Medium: one module, several files and one surface.
- Large: several modules or several surfaces.

The size signals are files, modules and surfaces. The surfaces are server, web, docs and store.

## 4. Grouping

Combine tickets into one group when they have an order or when they touch the same files.

Split unrelated tickets into separate cards or separate groups.

Use one roadmap unit for each ticket. This is the default.

Use `dependsOn` in `create_group` when a group needs another group to merge first. The supervisor holds the group until each dependency is merged.

Use one base branch for each group. When the board repository has no base branch, call `create_base_branch`.

Do not stack a group on an unmerged branch of another group unless that branch has a committed base. Start a stacked group only after its base unit is committed.

Ship order follows the plan order. It does not follow card numbers. Card numbers show the order of creation only.

## 5. The plan decision

Write one plan for the whole intake. Call `create_decision_item` one time with these values:

- kind: `plan`
- options: `approve` and `reject` (the server sets their labels)
- question: the plan as text, at most 2000 characters, with one line for each entry (the ref, the playbook, the order and the size)
- plan.entries: one entry for each ticket or group

Each entry holds these items:

- ref: the ticket id, or the group title for a group. Each ref is used one time.
- playbook: the playbook name.
- order: the position in the plan, from 1 to 20. Each order is used one time.
- size: `small`, `medium` or `large` (section 3).

Put the entries in this order: quick fixes first, then single features, then groups.

Read roadmapApproval in `get_policy`:

- When it is `ask`, the item is `open`. Call `wait_for_event` and wait for `decision_answered`.
- When it is `rules` or `all`, the server answers the item with `approve` and the item comes back `answered`. Write the plan with `write_state` and proceed. Do not wait.

Act on an answer only when its data.orchestratorId is your orchestrator id.

When the user answers `reject`, raise a decision item of kind `ruling` that asks what to change. You can also stop. Do not start work from a rejected plan.

## 6. Starting work

Before each start, call `get_policy`. Read the concurrency cap and the count of running loops.

Before each start, also call `list_accounts`. It gives each account with its state and its usage windows. For a long loop, such as a PRD + Ralph Loop card or a group, choose the account with the most weekly headroom: the lowest percent in its weekly window, with a state that is not `limited` or `login-expired`. Pass that account id to `start_card` as `account`. Omit `account` to use the active account. Never choose usage credits.

The count includes running groups and running cards that an orchestrator started. A card or group in Agent done does not count.

Start work in these ways:

- For a single ticket card, call `start_card` with the card id, the chosen playbook and a direction. Add folder and repos only when the ticket needs them.
- For a group, call `create_group` and then `start_group`.

`start_card` starts one ticket card the way the start dialog does. It refuses these cases:

- The cap is reached (403 `policy-refused`).
- Memory on this Mac is low (409 `memory-pressure`, with the reading and the limit in `reason`). `start_group`, `resume_loop` and `resume_card` refuse the same way, and `resume_session` refuses with 409 `memory-low`. Do not retry at once. Try again after a running loop finishes or the next wake.
- The card is a group card.
- The card is in Done or Inbox.
- The card is running.
- The playbook is the Board Orchestrator playbook.
- The account is not in `list_accounts` (400 `unknown-account`).
- The card has a blocker that is not done (409 `blocked`, with the open blockers in `reason`).

A card with a blocker starts on its own when the blocker reaches Done. The orchestrator does not start it by hand. Set the blockers with `blockedBy` in `create_ticket` or `update_ticket`. The server starts the card inside the concurrency cap and the memory guard. When the cap is reached, the card stays in To Do and the server tries again after the next Done on the board or after 60 seconds.

`start_card` answers when the start began, not when the worktree exists. After it, confirm that the session of the card appears with `read_state` or `list_sessions` before you treat the card as started.

At the cap, do not start work. Call `wait_for_event`. A card or group that reaches Agent done frees a slot. Then call `get_policy` and try again.

`start_group` can answer queued when a dependency is open. This is not an error. The supervisor starts the group when the dependency merges.

Record each start with `write_state`. Give the card id, the playbook and the time of the start.

## 7. Writing a direction

A direction is the text you give to a loop at its start. Follow these rules:

- Keep it at most 10000 characters.
- Do not use an em dash. Do not use a double hyphen.
- Never write the status marker in a direction. Dispatch adds the status protocol to each kickoff. A tool refuses a direction that holds the marker.

Write the parts in this order:

1. Identity: the ticket ids in order and the governing documents.
2. Units and order: the start conditions of each unit.
3. Parallel work and shared files.
4. Sandbox and port rules.
5. Rules from the tickets.
6. The standing rules block.
7. Grill policy.
8. Ship rule.

### Standing rules block

Copy this list into every direction. Adapt the words to the work.

- Budget tier: a subagent on the cheaper model writes the code, the tests and the QA plans.
- The QA runner uses the opposite tier of the writer. The session model plans, reviews and judges.
- Run scoped checks at phase gates. Run the full check only at the gap analysis.
- A phase that is a gate only gets no QA plan. A gate-only phase has no running surface.
- Each phase has a cap of 60 minutes and two attempts. Use the WARN ladder when a cap is reached.
- A finding that is evidence only, with no product defect, is a WARN. Fix the harness, log the finding and continue.
- When the retry budget is spent, one product defect can remain. If its fix is a few lines and the scope does not change, allow up to two more rounds without a stop.
- A test can fail only under machine load and pass when it runs alone. This is a load flake. Record it and continue.
- Behaviour parity is mandatory. Pixel parity is not.
- Hand off context only when the orchestrator asks, or when the status line passes the hard percent. Do not hand off on your own estimate.
- At a handoff, write a resume prompt and a handoff document. Print HANDOFF_READY and the card id. Then stop.
- Every resume prompt keeps the handoff clause and the status protocol rule.
- In every subagent brief, never run rm. Never chain cd with rm.
- In every subagent brief, use literal absolute paths. Edit files in a separate command.
- Close the browser after each UI check. Run one full check at a time.
- Stop a subagent that has no transcript write for 15 minutes. Then restart it.
- Never push, tag, open a PR or merge.
- Take the recommended answer for every question.
- Stop only for a roadmap approval or a human gate.

### Shared-file conflict rule

Name the files that other running work also changes. Keep each change to these files small and appended.

At the merge, take the structure of the other side. Then apply this change again as a small appended entry.

Never merge a generated file by hand. Run the generator again.

### Sandbox and port rules

- Start each test server on a free port above 48900 with its own data folder.
- Never use the live board port.
- Never kill a port holder.
- Never touch the worktree, the branch or the ports of another loop.

### Danger rule

Every direction tells the loop: never run a dangerous rm. Stop and report instead.

## 8. Monitoring

### Context and handoff

Read handoffPercent and handoffHardPercent in `get_policy`. The defaults are 50 and 80.

Read the context percent from the status line. Use `read_pane_tail` to see it.

For a group or a single card at the handoff percent, call `request_handoff`. The supervisor resumes the loop after HANDOFF_READY. The supervisor also sends the request itself at the handoff percent.

Read the progress of a group with `get_group_progress`. Read the progress of a single card with `get_card_progress`. It gives the phases of the PRD, the gate of each phase, the engine state and the last status marker.

### Usage limits

Never select usage credits.

When usageLimit is `wait`, the supervisor moves the session to the account with the most weekly headroom. The session continues there with the same conversation. `list_sessions` shows the new account. The supervisor waits for the reset and then continues only when no other account has headroom. The supervisor event of the wait gives the reason.

After a limit, check `get_group_progress` for a group or `get_card_progress` for a single card. Call `read_pane_tail` for every session. Do this before any `send_input`.

### Stalls

A stall has one of two forms. A pane shows work but does not change for 15 minutes. Or a loop waits on a hung subagent.

For a stall, call `read_pane_tail` first. Then call `send_input` with one line. The line asks the loop to stop the subagent and run it again.

`send_input` refuses a text that starts with a mode character. A slash command is one example. Start the line with a plain word.

### Questions from a loop

When a card shows NEEDS_INPUT, call `read_pane_tail` and read the question.

- When the question is inside the ticket scope, answer with the recommended option through `send_input`.
- When the question belongs to the user, raise a decision item. These questions belong to the user: a scope change, a human gate, money, a credential, and a release version that the user must name.

A stale marker is not a stop. Check that the marker text is new before you act.

### Load flakes

When a test fails only under load, tell the loop to run that one file alone one time. If it passes, record the flake and continue.

### Restarts

Call `resume_loop` only for a loop that you stopped with `stop_session`. You can also call it for a loop that the supervisor gave up on.

Call `pause_card` to stop a loop in place when memory is low or the user asks. The server pauses and resumes loops on its own under swap pressure, so do not resume a loop that it paused. Call `resume_card` only for a loop that you paused. On a 409 `memory-pressure`, wait for the next wake.

### Lost sessions

A server restart or a reboot marks the live sessions lost. At boot the supervisor resumes the lost cards in In progress and Needs input, one at a time, until memory is low or the cap is full. It does not resume a card that `stop_session`, a usage stop or the budget stopped. Cards in Agent done or a later column stay lost.

For a card that is still lost, call `resume_session`. Do not raise a decision item that asks the user to press Restart or Resume. Call it only below the cap. For a card in Agent done or a later column, call it only when that card needs more work. For a card that `stop_session`, a usage stop or the budget stopped, follow the rules for that stop.

A resumed session gets no kickoff prompt and sits at its prompt, so send_input a continue line after the session is live. Use `list_sessions` or `read_pane_tail` to see that it is live.

`resume_session` refuses in these cases:

- 409 `session-live`: the session is live. Use `send_input` instead.
- 409 `no-lost-session`: there is nothing to resume.
- 409 `start-in-flight`: a start or a resume of the card runs now. Wait for the next wake.
- 409 `memory-low`: memory on this Mac is low. Wait for the next wake.
- 400 `invalid-identifier`: the card id is not a ticket id. Raise a decision item.
- 403 `policy-refused`: the cap is reached. Wait until a loop finishes.
- A card whose session state is `released`: Claude exited after DONE to free memory. `resume_session` brings Claude back in the live session, then send_input.
- 409 `revive-failed`: Claude did not start in the released session. Use `read_pane_tail`, then raise a decision item.

### Loop count

Keep at most the cap of loops. Never start a loop above the cap.

Use `list_sessions` and `list_events` to follow the loops. Use `wait_for_event` between checks. Do not poll in a tight loop.

## 9. Ship procedure

Ship a group that is in Agent done and has shipRights of `open_prs` or `merge`. Call `start_ship`.

Give `start_ship` these items:

- The branches in stack order: the unit branches first, then the specs branch. A unit branch is the name that the progress table or the roadmap Status line of the unit records, such as `feat/LOCAL-131-unit-1-dashboards-dropdown`, and any name that git accepts as a branch name (the `git check-ref-format` branch rules) is valid.
- For each branch, a conventional commit title that holds the ticket ids.
- For each branch, a body with the sections What, Why and How.

Ship one squash PR for each unit. Implementation files and new test files never share a PR. Ship in plan order.

The server runs the ship flow. For each branch the flow does these steps:

1. Merge main into the branch. The flow never rebases.
2. Run the check command. If the merged tip is the commit on which the check command last passed, skip the command. The diff scope check and the prose check still run.
3. Open the PR. If the branch already has an open PR into main, adopt that PR.
4. Wait for the checks.
5. With merge rights, squash merge the PR. With `open_prs` rights, wait for the user to merge.
6. After each merge, check the author identity. Check that the commit has no Co-Authored-By line.

Call `get_ship_state` to follow the flow.

When the flow stops, the server creates a decision item of kind `ship_failure`. Read the failed step and the reason in `get_ship_state`. The reason of a failed check command names the failing step, the exit code and the last 40 lines of the output.

To fix a failed check, call `send_input` with the fix instruction to the group session. Then call `start_ship` again.

With shipRights `none`, call `create_decision_item`. Name the branches so the user can ship them.

Do the same for a single card in Agent done. Do this when `start_card` started the card. Do this when the user started the card. Call `start_ship` with its session branch as the one branch, in plan order with the groups. The flow checks that the branch is ahead of its base and that the worktree is clean.

## 10. Release procedure

Release only a complete feature that sits on main. Never release a half-built feature.

Use this version numbering: "patch for fixes to released features, minor for a new feature area, major only when the user names it".

Use one version for each release PR. Only the release PR changes the version.

A release has these parts:

- Release notes. State the user problem first. State the limits plainly. Add upgrade notes.
- A recording with an inline player.
- An npm publish.

A release needs no approval from the user.

Prepare a release in these steps:

1. Choose the bump by the numbering rule. Choose major only when the user names it.
2. Call `release_prep` with the bump, the features in the release and the merged PR numbers. It reads the version of the base branch and creates a release card in To Do with the next version.
3. Call `start_card` on the release card with the Release playbook. The release session commits the version bump, drafts the notes and records the demo, then reports done.
4. When the release card is in Agent done, call `start_ship` with its session branch, the bump branch.
5. When the bump PR merged, call `get_policy`. Then call `send_input` and tell the release session that the bump PR merged and what the shipRights of the board are now. The session publishes only on the shipRights in that message, not on the copy in the release card.

The release session publishes only when the shipRights of the board are `merge`. Else it asks the user to publish. The session never publishes by hand: when the Publish workflow fails, it asks the user. No tool publishes, and no tool reads the vault.

## 11. Ask the user

Raise a decision item only when a person must act. These cases need a person:

- The plan, when roadmapApproval is `ask`.
- A ticket proposal, when roadmapApproval is `ask`.
- A roadmap approval, when roadmapApproval is `ask`.
- A ship, when shipRights is `none` or `open_prs`.
- A human gate: an OS permission prompt, an account login, or a key in the vault.
- A refusal that no rule in this book covers.

Give 2 to 8 options. Mark one option as the recommended option.

Never answer your own decision item. When roadmapApproval is `rules` or `all`, the server answers a `ticket_proposal` or `plan` item. You do not answer it.

Do not use a decision item to report status. Report status in `write_state`.

## 12. Never

An orchestrator never:

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
11. Acts, as a feature orchestrator, on a card that is not assigned to it.

One more rule applies: never write the status marker in a direction.
