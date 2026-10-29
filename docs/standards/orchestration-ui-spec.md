# Orchestrator UI Spec

Status: accepted. Date: 2026-10-06. Ticket: LOCAL-84. Design records: `docs/standards/orchestration-design.md` (cited as D-1 to D-9).

This spec is the screen contract for the UI tickets LOCAL-85 to LOCAL-93. It gives the routes, the layout at each width, the parts with their primitives and copy, and the empty, loading, error and stale states of each screen. A UI ticket follows this spec. A change to this spec is a new dated entry in this file.

Terms: "orchestrator" is the Claude session that belongs to a board. "Supervisor" is the server code that watches the sessions. The session start saga keeps the name "orchestration" (term rule in the glossary of the design records).

Table rules:

- In a parts table, the primitive cell names a file in `src/web/components/ui/` in a code span. "Added by the UI ticket" means that the UI ticket adds the primitive with `npx shadcn@latest add`. "Module component" means plain elements with token classes inside a module. Only the group progress bar uses it. Frontend rule 10 allows plain elements only in the allowed custom families, so LOCAL-92 adds the segmented progress bar to "Allowed custom families" in `docs/standards/frontend-architecture.md` in the same change (U2-07).
- Layout widths: the 1440 px rules apply at 1280 px and wider. The 1024 px rules apply from 768 px to 1279 px. The 390 px rules apply below 768 px.
- In a states table, each screen has the rows Empty, Loading, Error and Stale. Stale means that the board stream is disconnected and the screen shows the last data that it received.

## Inputs

| Input                               | What the screens read                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 Board model                     | `key`, `name`, `workspaceRoot`, `repositories` (path, base branch, check command), `linearTeamKeys`, `policy`, `orchestrators`, `archived`. The default board `LOCAL` reads `workspaceRoot` from `Config` and its repositories from the workspace folders of the store (`workspaceFolders`), as today (D-1 amendment of 2026-10-06). Screens 1, 2 and 5. |
| D-2 Card identifiers                | The key pattern `^[A-Z][A-Z0-9]{1,5}$` and the reserved keys. Card ids `<KEY>-<n>`. Screen 1 form.                                                                                                                                                                                                                                                       |
| D-3 Supervisor and orchestrator     | The 12 session states, the restart and resume rules, and the decision items. Screens 3 and 4, and the state labels in "Cross-screen rules".                                                                                                                                                                                                              |
| D-4 Control surface                 | The `board` query parameter (default board when it is absent), `send_input` with `confirmed` or `unconfirmed`, `stop_session`, `resume_loop` and the four states in which the send route rejects input. Screens 3 and 4.                                                                                                                                 |
| D-5 Loop progress protocol          | `loopProgress` on a group card (units, current unit, current phase, gate results), and the session meters `contextPercent`, `model`, `cost` and `usage`. Screen 4.                                                                                                                                                                                       |
| D-6 Policy per board                | The 10 policy fields, their values and defaults. No field offers usage credits. Only the user edits the policy. Screen 3.                                                                                                                                                                                                                                |
| D-7 More than one orchestrator      | One main orchestrator per board, extra orchestrators with a scope and an owner, and the policy override that only narrows. Screens 3 and 4.                                                                                                                                                                                                              |
| D-8 Stacked branch ship flow        | The ship states of each branch, the flow state, the PR number, the check state and the identity result. Screen 4.                                                                                                                                                                                                                                        |
| D-9 Never list                      | No control lets the orchestrator change a policy, approve a permission prompt or answer its own decision item. Screens 3 and 4.                                                                                                                                                                                                                          |
| `docs/standards/design-contract.md` | The tokens of `src/web/styles/tokens.css`, the density scale, the contrast floor, the focus outline (2 px solid `--accent`, offset 2 px) and the chrome dimensions (`--nav-width` 240 px, `--page-header-height` 52 px, 44 px on narrow screens). All screens.                                                                                           |

## Information architecture

### Routes

- The routes of today stay. Each URL of today shows the default board `LOCAL`, as today.
- The pages `/boards/<KEY>` (board), `/boards/<KEY>/dashboard`, `/boards/<KEY>/inbox` and `/boards/<KEY>/settings` carry the board key in the path. The old addresses `/board`, `/dashboard` and `/inbox` still open and go to the keyed address.
- Each other board-scoped route takes the search parameter `board` with the board key. When the parameter is absent, the route shows the default board (D-4). The board-scoped routes are the pages that read the board snapshot today: `/board`, `/inbox`, `/today`, `/tickets`, `/workspace`, `/workspaces`, `/flow`, `/activity`, `/archive`, and the new `/dashboard`. The source pages (`/pull-requests`, `/errors`, `/slack`, `/meetings`, `/calendar`) read only the global source data or look up cards. They keep the `board` parameter in their links and open the cards of the selected board.
- The selected board is the path key on a keyed page, else the `board` parameter of the current URL. A link inside the app keeps the board of the current URL.
- An unknown or archived `board` key shows the default board `LOCAL` and the toast "Board <KEY> is not available." When the user archives the selected board, the app goes to the same page on the default board.
- New route `/boards`: the boards page (Screen 1). It is not board-scoped.
- New route `/dashboard`: the dashboard of the selected board (Screen 4).
- The settings sheet (Screen 3) is a sheet on the command centre (Screen 6). The search parameter `settings` opens it. The old board parameter `panel=orchestrator` redirects to the centre (LOCAL-111).
- The ticket detail panel stays as today: a fixed right panel above the page. Escape closes the detail panel first.

### Where each screen lives

| Screen                        | Route or place                                                                                            | How the user gets to it                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Boards page                | `/boards`                                                                                                 | The command palette entry "Manage boards". The icon of the Boards section in the collapsed sidebar.                                                                                                                                                                                                                           |
| 2. Sidebar Boards section     | The sidebar content, after the System group                                                               | It always shows. The shortcut `b` opens the command palette with the Boards group only. The command palette entries "Switch to board <name>".                                                                                                                                                                                 |
| 3. Settings sheet             | The settings sheet of `/boards/<KEY>/orchestrator?settings=policy` or `settings=orchestrators` (Screen 6) | The button "Settings" of Screen 6. The old link `/board?panel=orchestrator` redirects to the centre (LOCAL-111).                                                                                                                                                                                                              |
| 4. Dashboard                  | `/dashboard?board=<KEY>`                                                                                  | The Dashboards dropdown row of the board in the sidebar. The dropdown lists only boards with a main orchestrator. In the collapsed sidebar the Dashboards icon opens the current board's dashboard and shows only when that board has a main orchestrator. The command palette entry "Go to Dashboard" follows the same rule. |
| 5. Board with no orchestrator | `/board` when the selected board has no orchestrator                                                      | The user opens the board from its row in the sidebar Boards section or with the command palette entry "Go to Board".                                                                                                                                                                                                          |

Navigation rules:

- With one board and no orchestrator, the shell is the shell of today. It shows the Boards section with one board and the "Create board" row, and no "Dashboard" row. The only other new visible part is the "Add orchestrator" button in the board header (Screen 5).
- The command palette entries "Manage boards" and "Go to Dashboard" are not visible chrome. They show only when the user opens the palette.
- The page title of a board-scoped page is the page name. When more than one board exists, the title is "<page name> · <board name>", for example "Board · Dispatch". With one board, the title stays "Board", as today.

## Screen 1: Boards page

### Purpose

The user sees all boards in one list, adds a board, edits a board and archives a board. LOCAL-85 and LOCAL-87 build this screen.

### Data

- Each board row of D-1: `key`, `name`, `repositories`, `archived`.
- Counts per board from the snapshot of that board: running sessions (cards with a live session, the cards that show the Live session chip of today), open groups (group cards not in Done) and the attention count (the number of items in the attention queue of Screen 4, Section 1).
- For the create form: the keys of all boards and the Linear team keys that the store knows (D-2).
- For the default board edit form: the `Config` field `workspaceRoot` and the store list `workspaceFolders` (D-1 amendment of 2026-10-06).

### Layout

- **1440 px:** the page body column of the design contract (720 px maximum width, centered). The page header holds the title "Boards" and the button "New board". Below it, one `table` with one row per board. The columns are Name, Key, Repositories, Running, Open groups, Attention and a row menu. Archived boards are in a `collapsible` section "Archived boards" below the table.
- **1024 px:** the same table. The Repositories cell shows the count ("2 repositories") in place of the folder names.
- **390 px:** no table. Each board is one `item` in a list: the name and the key on the first line, the three counts as `badge` parts on the second line, and the row menu at the right. The "New board" button stays in the page header.

### Parts

| Part                          | Primitive                  | Copy                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New board button              | `button`                   | "New board"                                                                                                                                                                                                                                                                                                   |
| Board list (1440 px, 1024 px) | `table`                    | Column heads: "Name", "Key", "Repositories", "Running", "Open groups", "Attention"                                                                                                                                                                                                                            |
| Board list (390 px)           | `item`                     | "<name>" and "<KEY>" on line 1                                                                                                                                                                                                                                                                                |
| Default board mark            | `badge`                    | "Default" beside the name of `LOCAL`                                                                                                                                                                                                                                                                          |
| Count cells                   | `badge`                    | "<n> running", "<n> open groups" ("1 open group"), "<n> need attention" ("1 needs attention"). A zero shows "0" with no badge.                                                                                                                                                                                |
| Row menu                      | `dropdown-menu`            | Trigger label "Board actions". Items: "Open board", "Edit", "Archive". The default board has no "Archive" item.                                                                                                                                                                                               |
| Create and edit form          | `dialog`                   | Title "New board" or "Edit board <name>". Buttons "Create board" or "Save", and "Cancel".                                                                                                                                                                                                                     |
| Key field                     | `field`, `label`, `input`  | Label "Key". Help "2 to 6 capital letters or digits. It starts with a letter. You cannot change it later." Read-only in the edit form.                                                                                                                                                                        |
| Key errors                    | `field`                    | "Use 2 to 6 capital letters or digits, starting with a letter." "LOCAL and GROUP are reserved." "Board <name> uses this key." "Linear team <KEY> uses this key."                                                                                                                                              |
| Name field                    | `field`, `label`, `input`  | Label "Name". Error "Enter a name."                                                                                                                                                                                                                                                                           |
| Workspace root field          | `field`, `label`, `input`  | Label "Sessions folder". Help "Dispatch makes one folder for each session in this folder." Error "This folder does not exist."                                                                                                                                                                                |
| Repository rows               | `field`, `input`, `button` | Labels "Repository path", "Base branch", "Check command". Placeholder of the check command "npm run check". Buttons "Add repository" and "Remove". Error "Add at least one repository."                                                                                                                       |
| Linear team keys field        | `field`, `label`, `input`  | Label "Linear team keys". Help "New Linear issues of these teams go to this board. Separate keys with a comma."                                                                                                                                                                                               |
| Linear key warning            | `alert`, `badge`           | "Linear team <KEY> has the same key as this board. Dispatch skips each Linear issue whose id is already a card id." It shows on the edit form, and a `badge` "Key clash" shows on the board row, when the warning of D-2 applies.                                                                             |
| Default board note            | `alert`                    | "The default board reads its repositories from Settings, Workspaces. A change here also changes that list. It picks the base branch at each start and runs `npm run check`." It shows in the edit form of `LOCAL`. That form shows the path of each repository row only.                                      |
| Archive confirm               | `alert-dialog`             | Title "Archive board <name>?" Body "The board leaves the Boards section. Its cards and sessions stay. You can restore it from Archived boards." Buttons "Archive board" and "Cancel". The "Archive" menu item is disabled when sessions run, with the reason below it: "Stop the <n> running sessions first." |
| Archived boards section       | `collapsible`, `table`     | Trigger "Archived boards (<n>)". Row action "Restore".                                                                                                                                                                                                                                                        |
| Save result                   | `sonner`                   | "Board <name> created." "Board <name> saved." "Board <name> archived." "Board <name> restored."                                                                                                                                                                                                               |

### States

| State        | What shows                                                                                                                                                                      | Copy                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Empty        | Only the default board exists. The table shows its one row, and an `empty` block below the table invites a second board.                                                        | Title "One board". Body "Add a board to keep a second project apart from this one." Button "New board".       |
| Loading      | Three `skeleton` rows in the table (three `skeleton` items at 390 px). The "New board" button is disabled.                                                                      | Screen reader text "Loading boards".                                                                          |
| Error        | An `alert` in place of the table, with a retry button. The "New board" button is disabled.                                                                                      | "Boards did not load: <error message>." Button "Try again".                                                   |
| Stale        | The last rows stay. A `badge` beside the title shows the time of the last update. The count cells keep their last values.                                                       | "Counts from <time>". The shell shows "Disconnected, reconnecting…" as today.                                 |
| Action error | A failed create, save, archive or restore. In the dialog, an `alert` above the buttons; the dialog stays open with the values. For archive and restore, a `sonner` error toast. | "<Action> failed: <error message>." Button "Try again". For example "Create board failed: the key is in use." |

## Screen 2: Sidebar Boards section

### Purpose

The user moves between boards from any page. The section lists every active board with its attention count and its running loops, so the user sees which board needs them. LOCAL-102 replaces the header switcher of LOCAL-87 with this section.

### Data

- The board rows of D-1 that are not archived: `key` and `name`.
- The attention count and the number of running loops of each board, as in Screen 1.
- The selected board: the path key on a keyed page, else the `board` parameter of the current URL, else `LOCAL`.

### Layout

- **1440 px:** the section is the last group in the sidebar content, after the System group, so a long board list never pushes the pages out of view. The label "Boards" is a button with a chevron. Below it, one row per board, then the row "Create board". The sidebar header keeps the glyph and the wordmark only.
- **1024 px:** the same as 1440 px. When the sidebar is collapsed (56 px), the section is one icon row labeled "Boards" (tooltip on hover) that opens `/boards`.
- **390 px:** the sidebar is a `sheet` as today. The section shows as at 1440 px. The sheet closes after the user selects a board or "Create board". A long board name truncates and the row does not scroll sideways.

### Parts

| Part                    | Primitive               | Copy                                                                                                                                |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Section label           | `collapsible`, `button` | "Boards". `aria-expanded` is set. Enter and Space fold and unfold the section. The section is open by default and is not stored.    |
| Board row               | `sidebar` menu button   | "<board name>", truncated, with the full name in the `title` attribute. The selected board is marked active and has `aria-current`. |
| Attention count per row | `badge`                 | "<n>" when the count is above 0. Accessible name "<n> items need attention". No badge at 0.                                         |
| Running loops per row   | muted text              | "<n>" when the number is above 0. Accessible name "<n> running loops".                                                              |
| Create board row        | `sidebar` menu button   | "Create board". It opens `/boards?dialog=new`.                                                                                      |
| Shortcut hint           | `kbd`                   | The cheat sheet row "Switch board" with the key "B" in the Global group. The row always shows.                                      |
| Palette entries         | `command`               | One entry per board: "Switch to board <name>". The selected board has no entry. Group heading "Boards".                             |

Rules:

- The section always shows, also with one board. The list holds active boards only.
- A board row opens the kanban board of that board (`/boards/<KEY>`).
- The shortcut is `b` with no modifier. No binding of today uses it. Mod+B toggles the sidebar (`src/web/components/ui/sidebar.tsx`), and Mod+Shift+B opens the bookmarks bar in Chrome, so the shortcut uses no modifier. It is a global binding like `n`. It opens the command palette with the Boards group only: the entries "Switch to board <name>", "Manage boards" and "Create board". Typing filters inside the group, and the palette shows no ticket results. It does nothing when a text field has focus or when a dialog or a menu is open.
- An entry "Switch to board <name>" goes to the same page on the other board. A keyed page changes its path key. Another page changes its `board` parameter. On `/boards` the route stays `/boards`.
- The board counts refresh every 15 seconds while the board list is loaded.

### States

| State   | What shows                                                                                        | Copy                                            |
| ------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Empty   | One board only: one row for it and the row "Create board". The palette group has no switch entry. | No copy.                                        |
| Loading | Two `skeleton` rows under the label until the board list loads.                                   | No copy.                                        |
| Error   | The board list failed with nothing cached. The section shows muted text and a retry button.       | Text "Boards did not load." Button "Try again". |
| Stale   | The rows show the last board list and the last counts. One muted line shows under the rows.       | "Counts from <time>".                           |

## Screen 3: Settings sheet

Replaced: the orchestrator panel on `/board` (LOCAL-91). LOCAL-111 removed the panel. This settings sheet on the command centre (Screen 6) holds the Policy and Orchestrators tabs of the panel. Screen 6 holds the Terminal tab, the Decisions tab and the Start, Stop and Resume buttons of the panel.

### Purpose

The user edits the board policy and manages the orchestrators of the board from the command centre.

### Data

- The route `/boards/<KEY>/orchestrator` or `/boards/<KEY>/orchestrator/<orchestrator id>` with the search parameter `settings`. The value `policy` or `orchestrators` opens the sheet on that tab. Any other value opens no sheet.
- The old link `/boards/<KEY>?panel=orchestrator` redirects to the centre of the main orchestrator. With `tab=policy` or `tab=orchestrators` the sheet opens on that tab. With `tab=terminal`, `tab=decisions` or no tab the sheet stays closed.
- The board `policy` with the 10 fields of D-6.
- The board `orchestrators` of D-7: id, main flag, scope, policy override and session name, and the `ownerOrchestrator` of each group card.
- The sheet reads the board record, the orchestrator list and the board cards. It makes no new request.
- The button "Settings" opens the sheet on the Policy tab and adds one history entry, so Back closes the sheet. A tab change adds no history entry.

### Layout

- **1440 px:** a `sheet` from the right edge, at the width of the token `--panel-width`, over the dimmed centre.
- **390 px:** the same `sheet`, full width.

### Parts

| Part                    | Primitive                                        | Copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sheet                   | `sheet`                                          | Title "Orchestrator settings". Description (sr-only) "Policy and orchestrators of <board name>." The close button is an X button. A click on the dimmed page does not close it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Stale badge             | `badge`                                          | "Data from <time>". It shows in the sheet header while the board stream is down.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Tabs                    | `tabs`, `line` variant                           | "Policy", "Orchestrators (<n>)". While the list loads, the label reads "Orchestrators".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Policy form             | `field`, `label`                                 | Section title "Policy for <board name>". Help "Only you can change this policy. The orchestrator reads it. No tool can change it."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `roadmapApproval`       | `select`                                         | Label "Roadmap approval". Options "Ask me for each roadmap" (`ask`, default), "Approve when the rules pass, else ask" (`rules`), "Approve each roadmap" (`all`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `concurrencyCap`        | `input`                                          | Label "Loops at once". Default 3. Error "Enter a number from 1 to 10."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `loopModel`             | `select`                                         | Label "Loop model". Default "Session settings" (the session settings of today). Options are the models and efforts that LOCAL-91 lists. Today the session settings hold one free-text field of launch arguments, so LOCAL-91 defines the list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `orchestratorModel`     | `select`                                         | Label "Orchestrator model". Default "Opus". Options are the models of the same LOCAL-91 list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `handoffPercent`        | `input`                                          | Label "Handoff at context percent". Default 50. Error "Enter a number from 10 to 95."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `handoffHardPercent`    | `input`                                          | Label "Hard handoff at context percent". Default 80. Error "Enter a number above the handoff percent."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `usageLimit`            | `toggle-group`                                   | Label "At a usage limit". Options "Wait for the reset" (`wait`, default) and "Stop and ask me" (`stop`). No option selects usage credits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `shipRights`            | `select`                                         | Label "Ship rights". Options "None, I ship" (`none`, default), "Open PRs" (`open_prs`), "Open and merge PRs" (`merge`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `budgetPerGroup`        | `input`                                          | Label "Budget per group (USD)". Empty means no limit, the default. Placeholder "No limit". The maximum is 100000. Errors "Enter an amount above 0, or leave it empty for no limit." and "Enter an amount of 100000 or less."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `supervisor`            | `switch`                                         | Label "Supervisor". Default off on the default board, on on a new board. Help "The supervisor watches the loops of this board. An orchestrator needs it."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Policy save             | `button`, `sonner`                               | Button "Save policy". Toast "Policy saved." The button is disabled until a field changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Orchestrators list      | `table`                                          | Column heads "Orchestrator", "Role", "Scope", "Owns", "Policy". Role "Main" or "Extra". Scope of the main orchestrator: "Each group that no extra owns". Owns: the group ids. Policy: "Board policy" or the narrowed fields, for example "Loops at once: 1".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Add extra button        | `button`                                         | "Add extra orchestrator". Disabled with no main orchestrator, with the reason "Start the main orchestrator first."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Extra orchestrator form | `dialog`, `checkbox`, `field`, `select`, `input` | Title "Add extra orchestrator". Scope list: one checkbox per open group and ticket of the board. A group that another extra owns shows disabled with "Owned by <name>", because each group has exactly one owner (D-7). Overrides (D-7, narrow only): `concurrencyCap`, `shipRights`, `roadmapApproval` and `usageLimit` are `select` fields with the labels of the Policy form; each offers only values at or below the board value (narrow order: `concurrencyCap` a lower number; `shipRights` `merge`, then `open_prs`, then `none`; `roadmapApproval` `all`, then `rules`, then `ask`; `usageLimit` `wait`, then `stop`), and the first option is "Same as board", the default. `budgetPerGroup` is an `input` with an upper limit of the board budget (no limit when the board has none); empty means "Same as board". Errors "Enter an amount at or below the board budget." and "Enter an amount above 0, or leave it empty to use the board budget." Buttons "Add orchestrator" and "Cancel". |
| Move ownership          | `dropdown-menu`, `dialog`, `checkbox`, `select`  | Row menu item "Move groups". It opens a `dialog` "Move groups from <name>": one checkbox per group that this orchestrator owns, a `select` labelled "New owner", buttons "Move groups" and "Cancel". Toast "Groups moved to <name>." Only the user moves ownership (D-7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Edit overrides          | `dropdown-menu`, `dialog`                        | Row menu item "Edit overrides" on each extra orchestrator. It opens a `dialog` "Edit overrides of <name>" with the override fields and errors of the Extra orchestrator form, filled with the current values. Buttons "Save overrides" and "Cancel". Toast "Overrides of <name> saved."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| List error              | text, `button`                                   | "Orchestrators did not load: <error message>." Button "Try again".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Rules:

- No control in this sheet offers usage credits (D-6, D-9 item 3).
- The policy form is a user form. No orchestrator tool edits it (D-6, D-9 item 5). An extra orchestrator override can only narrow the board policy (D-7). For each field, the value that applies is the narrower of the board value and the override, so a board value that the user lowers below an override still applies.
- Each user control in this sheet (Save policy, Add orchestrator, Save overrides, Move groups) calls a user route. A user route rejects an orchestrator token (D-9 item 5).

### Keyboard

- Escape closes an open dialog first, then the sheet.
- When the sheet closes, focus returns to the button "Settings".

### States

| State        | What shows                                                                                                                                                                      | Copy                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Empty        | The Policy tab works as usual. The orchestrators table shows its empty copy.                                                                                                    | "No orchestrators yet."                                            |
| Loading      | The tab label has no count. The table shows its loading state.                                                                                                                  | Tab label "Orchestrators".                                         |
| Error        | The Orchestrators tab shows one line and a button.                                                                                                                              | "Orchestrators did not load: <error message>." Button "Try again". |
| Stale        | The last data stays. A `badge` in the sheet header shows the time.                                                                                                              | Badge "Data from <time>".                                          |
| Action error | A failed Save policy, Add extra orchestrator, Save overrides or Move groups. In a dialog, an `alert` above the buttons; else a `sonner` error toast. The form keeps its values. | "<Action> failed: <error message>." Button "Try again".            |

## Screen 4: Dashboard

### Purpose

The user sees, on one page, what needs them now and how each loop of the board progresses. The attention queue is first, so a stop does not wait unseen for 30 minutes or more (research F1, F3, F8). LOCAL-92 builds this screen.

### Data

- The route `/dashboard` with the `board` search parameter. With no parameter, the dashboard shows the default board (D-4).
- The group cards of the board with `loopProgress` (D-5): the units with their status, the current unit, the current phase of its phase count, the gate results and the failed attempts.
- The sessions of the board with `state`, `stateReason`, `stateSince`, `contextPercent`, `model`, `cost` and `usage` (D-3, D-5).
- The pending decision items of the board (D-3, D-7).
- The events of the board with the `since` cursor (D-4): tool calls of each orchestrator and actions of the supervisor.
- The ship flow of each group (D-8): the branches in stack order, the ship state, the PR number, the check state, the identity result and the flow state.
- The policy fields `budgetPerGroup` and `concurrencyCap` (D-6). The budget of a group is the board `budgetPerGroup`, or the `budgetPerGroup` override of its owner orchestrator when one is set and lower, so a board budget lowered below an override still applies (D-7: an override only narrows). Sections 1 and 6 use this budget. The Section 2 heading count reads "<n> of <cap> loops running".

### Layout

- **1440 px:** one column, 1120 px maximum width, centred, with `--space-lg` padding and a gap of `--space-xl` between sections. The six sections are in the order below, top to bottom. Each section has a heading row with the section name and a count.
- **1024 px:** the same single column at the full content width. Tables keep their columns. The activity log shows 20 rows before "Show more".
- **390 px:** the same order. Each table becomes an `item` list. The segmented bar of Section 2 keeps one segment per unit and puts its text label on its own line above the bar. The inline reply field is full width with the send button below it.

The section order is fixed. A UI ticket does not reorder it and does not add a section. The counts of running sessions and open groups are in the boards page rows (Screen 1), not in a dashboard section (U2-03).

### Section 1: Attention queue

Each item that needs the user, oldest wait first. Each item shows the group id, the session state badge of "Cross-screen rules" when the item has a session, the wait time ("waiting 34 min") and one or more actions. The wait reads in minutes under 60, in hours under 48 ("waiting 5 h"), then in days ("waiting 3 d") (rule added 2026-10-09).

| Item kind                         | Source                                              | What the item shows and does                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision item                     | `create_decision_item` (D-3, D-7)                   | The question, one button per option, the recommended option marked, and the other answer field. The answer goes to the owner orchestrator as an event.                                                                                                                                                                                                                                                               |
| `needs_input`                     | Session state (D-3)                                 | The last question of the loop (the last lines of its last message). An inline reply field. The reply calls the user send route, which uses the same send function as `send_input` (D-4) and rejects an orchestrator token (D-9 item 5). "Resume loop" and "Try resume again" also call user routes. The item shows "Delivered" for `confirmed` and "Not confirmed. Check the terminal." for `unconfirmed`.           |
| `stale`                           | Session state (D-3)                                 | "No progress for <n> min." The inline reply field and the link "Open terminal".                                                                                                                                                                                                                                                                                                                                      |
| `permission_prompt`               | Session state (D-3)                                 | The prompt text from the pane. The link "Open terminal" only. No approve button and no deny button (D-9 item 9).                                                                                                                                                                                                                                                                                                     |
| Usage limit stop                  | `needs_input` with `stateReason` `usage_stop` (D-4) | "Stopped at the usage limit. The limit resets at <time>." The button "Resume loop". Only the user resumes this loop.                                                                                                                                                                                                                                                                                                 |
| Budget stop                       | `needs_input` with `stateReason` `budget` (D-3)     | "Budget reached: $<cost> of $<budget>." The buttons "Resume loop" and "Change budget" (see the Change budget button row). Only the user resumes this loop.                                                                                                                                                                                                                                                           |
| Failed gate                       | A gate event with a failed result (D-5)             | "Phase <n> gate failed, attempt <k> of <limit>." The link "Open terminal".                                                                                                                                                                                                                                                                                                                                           |
| Failed resume of a `lost` session | Supervisor resume saga (D-3)                        | "The session was lost and the resume failed: <reason>." The buttons "Try resume again" and "Open terminal".                                                                                                                                                                                                                                                                                                          |
| Failed resume of a `shell_prompt` | Supervisor resume saga (D-3)                        | "Claude exited and the resume failed: <reason>." The buttons "Try resume again" and "Open terminal".                                                                                                                                                                                                                                                                                                                 |
| `pushover_missing`                | Pushover values check (LOCAL-168)                   | Badge "Notifications". The text "Pushover PUSHOVER_USER_KEY is empty or not set. Loop phase notifications are not sent. Fill the value in the env vault." With two names: "Pushover PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN are empty or not set. Loop phase notifications are not sent. Fill the values in the env vault." The item has no group id and no action. It is the one item with no group and no action. |

Rules:

- The inline reply shows only on `needs_input` and `stale` items. The send route rejects input in the states `permission_prompt`, `usage_limit_dialog`, `usage_limit_wait` and `shell_prompt` (D-4), so those items have no reply field. A `needs_input` session with the `stateReason` `usage_stop` or `budget` shows only as its stop item, with no reply field.
- "Open terminal" opens `/board/<group id>?board=<KEY>`, the detail panel of the group with its live terminal.
- A text longer than 500 characters goes to a file, and the loop gets a one-line pointer (D-3). The reply field shows the count "<n> of 500 characters. A longer reply goes as a file."

### Section 2: Progress per group

One row per group that has a loop. Each row shows the group id, the roadmap name, the segmented bar, the text label, the result of the last gate, the context percent and the session state badge.

The segmented bar has one segment per unit. Each segment state has a glyph, a fill pattern and a text name, so the bar reads with no colour (R-22). Fill tokens: done uses `--text-muted`, current uses `--text`, pending uses a `--text-muted` outline (3:1 non-text floor), and failed gate uses `--destructive`. Each segment has a 1 px border in its fill token. No bar or segment uses `--accent`.

| Segment state | Glyph (lucide) | Fill pattern          | Text name     |
| ------------- | -------------- | --------------------- | ------------- |
| done          | `Check`        | solid fill            | "done"        |
| current       | `Play`         | diagonal stripes      | "current"     |
| pending       | `Circle`       | outline only, no fill | "pending"     |
| failed gate   | `X`            | dots                  | "failed gate" |

- The text label states the position: "Unit 2 of 3, phase 4 of 9". When the loop is done: "3 of 3 units built, awaiting ship".
- Each segment has the accessible name "Unit <n>: <unit name>, <text name>". The bar is a list of segments, not an image.
- The last gate line: "Phase 3 gate passed 12:41" or "Phase 4 gate failed 13:05, attempt 1 of 2" (the limit is the retry budget of the PRD).
- The context badge: "Context 38%".
- A running group with no loop progress has one row (rule added 2026-10-09, LOCAL-95). The row shows the group id, the session state badge, the context badge and the session time. In place of the text label it shows the line "No loop progress". It has no bar, no last gate line and no time left. The empty text shows only when no row exists. The heading count "<n> of <cap> loops running" counts the running groups of the same board snapshot that builds the rows, so a group that moves to Done leaves the count and its row together; the cap comes from the summary.

### Section 3: Tickets by column

The cards of the board per column: To Do, In Progress, Needs Input, Agent Done, In Review, Parked and Done, with the count of each. The cards that the orchestrator created carry the badge "By orchestrator". The link "Open board" goes to `/board?board=<KEY>`.

### Section 4: Activity log

The tool calls of each orchestrator and the actions of the supervisor, newest first. Each row shows the time, the actor ("Orchestrator", "Extra orchestrator <name>", "Supervisor" or "You"), the action and the card. Examples: "send_input to GROUP-13: confirmed", "Supervisor sent one continue prompt to GROUP-14", "Supervisor selected wait at the usage limit dialog". With no events the log shows "No activity on this board yet."

### Section 5: PRs and merge order (removed)

LOCAL-133 removed this section. Shipped work shows in Section 4 and in the board column Done.

### Section 6: Cost and usage

- One bar per group: the cost against `budgetPerGroup`. The bar follows the `dataviz` skill: it is `progress` with the tone `default` (the text colour), one hue for the value, the value as text beside the bar ("$12.40 of $20.00, 62%"), and at 80 percent and above the tone `stale`, the glyph `TriangleAlert` and the word "near budget" ("$17.10 of $20.00, 86%, near budget"). Above 100 percent the word is "over budget" ("$25.00 of $20.00, 125%, over budget") (rule added 2026-10-09). With no budget, the row shows the cost only: "$12.40, no budget".
- The usage meters of the account from the status line (D-5): the current window and the week, each with its percent and its reset time ("Week 41%, resets Mon 05:30"). At 80 percent and above a meter is `progress` with the tone `stale`, and its text shows the glyph `TriangleAlert` and the word "near limit" ("Week 85%, near limit, resets Mon 05:30").
- No control here offers usage credits.

### Parts

| Part                      | Primitive                              | Copy                                                                                                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section heading and count | `badge`                                | "Attention queue", "Progress per group", "Tickets by column", "Activity log", "Cost and usage"                                                                                                                                                                                              |
| Attention item            | `item`                                 | "<group id>", "waiting <n> min"                                                                                                                                                                                                                                                             |
| Session state badge       | `badge`                                | The label and glyph of the state from "Cross-screen rules"                                                                                                                                                                                                                                  |
| Decision options          | `button`                               | The option text. Every option button uses the `outline` variant, so a page with several decision items has no extra filled buttons. The recommended option carries the neutral badge "Recommended" inside it.                                                                               |
| Recommended mark          | `badge`                                | "Recommended"                                                                                                                                                                                                                                                                               |
| Other answer              | `field`, `label`, `textarea`, `button` | Label "Your answer to <question>" (sr-only), placeholder "Or type an answer", button "Send answer" (`outline` variant).                                                                                                                                                                     |
| Inline reply              | `field`, `label`, `textarea`, `button` | Label "Reply to <group id>" (sr-only). Placeholder "Reply to <group id>". Button "Send reply" (`outline` variant). Results "Delivered", "Not confirmed. Check the terminal." and, when the send route rejects the input, "Not sent. <group id> is now at <state label>. Open the terminal." |
| Open terminal link        | `button`                               | "Open terminal" (link variant)                                                                                                                                                                                                                                                              |
| Resume loop button        | `button`                               | "Resume loop", "Try resume again" Both use the `outline` variant.                                                                                                                                                                                                                           |
| Change budget button      | `button`                               | "Change budget". It opens the settings sheet of Screen 6 on the Policy tab.                                                                                                                                                                                                                 |
| Open board link           | `button`                               | "Open board" (link variant). It opens `/board?board=<KEY>`.                                                                                                                                                                                                                                 |
| Group progress bar        | module component                       | "Unit 2 of 3, phase 4 of 9". LOCAL-92 adds it to the allowed custom families (U2-07).                                                                                                                                                                                                       |
| Last gate and context     | `badge`                                | "Phase 3 gate passed 12:41", "Context 38%"                                                                                                                                                                                                                                                  |
| Tickets by column table   | `table`                                | Column heads "Column", "Cards", "By orchestrator"                                                                                                                                                                                                                                           |
| By orchestrator mark      | `badge`                                | "By orchestrator"                                                                                                                                                                                                                                                                           |
| Activity rows             | `scroll-area`, `item`                  | "<time> <actor>: <action>"                                                                                                                                                                                                                                                                  |
| Show more                 | `button`                               | "Show more"                                                                                                                                                                                                                                                                                 |
| PR table                  | `table`                                | Column heads "Order", "Branch", "PR", "Ship state", "Checks", "Author"                                                                                                                                                                                                                      |
| Ship flow state           | `badge`                                | "Running", "Stopped at <step>: <reason>", "Done"                                                                                                                                                                                                                                            |
| Cost bar                  | `progress`                             | "$12.40 of $20.00, 62%", "$17.10 of $20.00, 86%, near budget"                                                                                                                                                                                                                               |
| Usage meters              | `progress`                             | "Window 23%, resets 18:00", "Week 41%, resets Mon 05:30", "Week 85%, near limit, resets Mon 05:30"                                                                                                                                                                                          |

### States

| State        | What shows                                                                                                                                                                                                         | Copy                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty        | The board has no group with a loop. Section 1 shows an `empty` block. Sections 2, 5 and 6 show one line each. Sections 3 and 4 show their data as usual.                                                           | Section 1: "Nothing needs you." Section 2: "No loops on this board yet. Start a group from the board to see its progress here." Section 4 with no events: "No activity on this board yet." Section 5: "No PRs yet." Section 6: "No cost yet." |
| Loading      | Each section shows `skeleton` rows in its own place, so the order shows before the data.                                                                                                                           | Screen reader text "Loading dashboard"                                                                                                                                                                                                        |
| Error        | An `alert` inside the section that did not load. The other sections stay.                                                                                                                                          | "<section name> did not load: <error message>." Button "Try again".                                                                                                                                                                           |
| Stale        | The last data stays. A `badge` beside the page title shows the time of the last update. The reply, resume and decision buttons are disabled until the stream is back.                                              | Badge "Data from <time>". Disabled reason "Reconnecting. Actions are off until the board stream is back."                                                                                                                                     |
| Action error | A failed reply, decision answer, Resume loop or Try resume again. The item stays in the queue and shows an `alert` under its controls. A send that the route rejects shows the rejection copy of the inline reply. | "<Action> failed: <error message>." Button "Try again". "Not sent. <group id> is now at <state label>. Open the terminal."                                                                                                                    |

## Screen 5: Board with no orchestrator

### Purpose

A user with no orchestrator sees the board of today. The new feature adds one entry point and changes nothing else. LOCAL-91 adds the button. This screen is the default for every board until the user adds an orchestrator.

### Data

- The board snapshot of today for the selected board (D-1, D-4): the cards, the columns and the sessions.
- The `orchestrators` list of the board, which is empty on this screen.
- The count of boards that are not archived, which the Boards section lists (Screen 2).

### Layout

- **1440 px:** the board page of today: the page header with the title "Board" and the card count, the toolbar strip with the search box, and the seven columns To Do, In Progress, Needs Input, Agent Done, In Review, Parked and Done. The page header gains one button at the right end: "Add orchestrator". The detail panel opens as today.
- **1024 px:** the board of today at this width, with the same button in the page header.
- **390 px:** the board of today at this width: the carousel columns with the status pills. The button shows the short label "+ Orchestrator" so the page header keeps one line at 44 px.

This view matches the board of today. The only added part is the "Add orchestrator" button in the board header. With one board and no orchestrator, the shell shows no "Dashboard" row.

### Parts

| Part             | Primitive           | Copy                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add orchestrator | `button`, `tooltip` | "Add orchestrator" (outline variant). At 390 px: "+ Orchestrator"; the plus glyph marks the add action, and the accessible name stays "Add orchestrator". Tooltip "Add an orchestrator to plan tickets and run loops on this board." It opens the command centre (Screen 6) in its empty state. |

The board parts of today stay as they are, in their module files. The UI ticket does not change them:

| Board part of today                                         | Source of today                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Page header with the title "Board" and the card count       | `src/web/modules/shell/containers/ShellContainer.tsx`, `src/web/modules/shell/components/PageHeader.tsx`       |
| Toolbar strip with the search box "Search tickets…"         | `src/web/modules/board/components/BoardLayout.tsx`, `src/web/modules/board/components/SearchField.tsx`         |
| Status pills in carousel mode                               | `src/web/modules/board/components/StatusPillSwitcher.tsx`                                                      |
| Seven columns with label, count chip and resize handle      | `src/web/modules/board/components/ColumnHeader.tsx`, `src/web/modules/board/components/ColumnResizeHandle.tsx` |
| Column empty text                                           | `src/web/modules/board/components/EmptyState.tsx`                                                              |
| Card face: priority dot, identifier, title and session chip | `src/web/modules/board/components/CardView.tsx`                                                                |
| Selection bar for multi-select                              | `src/web/modules/board/components/SelectionBar.tsx`                                                            |
| Detail panel with its own resize handle                     | `src/web/modules/detail/views/DetailPanelView.tsx`                                                             |
| Sidebar header with the glyph and the wordmark              | `src/web/modules/shell/components/AppSidebar.tsx`                                                              |

Updated 2026-10-07 (LOCAL-77): the source paths above moved to the board and shell modules when the legacy tree was deleted. The board parts did not change.

### States

| State   | What shows                                                                                                                                                     | Copy                                                                                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty   | The columns of today with their empty text. The "Add orchestrator" button shows.                                                                               | As today: "No tickets in To Do", "Nothing running.", "Nothing waiting on your input.", "No finished agents yet.", "Nothing waiting on you.", "Nothing set aside.", "Finished tickets land here." |
| Loading | The page loading state of today: a `spinner` in the page body. The "Add orchestrator" button is not shown until the board loads.                               | As today: screen reader text "Loading page".                                                                                                                                                     |
| Error   | The page error state of today, with the reload button.                                                                                                         | As today: "This page failed to load." Button "Reload".                                                                                                                                           |
| Stale   | The last cards stay. The shell shows the disconnected line of today. The "Add orchestrator" button stays enabled; the command centre opens in its Stale state. | As today: "Disconnected, reconnecting…"                                                                                                                                                          |

## Screen 6: Command centre

### Purpose

The user sees the orchestrator of a board as one centre: the orchestrator node, a branch to each ticket and group that it runs, and a conversation where the user comments and the orchestrator answers. The layout is the orchestrator tree (Layout B of `docs/research/orchestration-centre-research.md`, section "Chosen layout"). LOCAL-104 Part 1b builds this screen. Its settings sheet is Screen 3.

### Data

- The route `/orchestrator` with the `board` search parameter and an optional `orchestrator` search parameter (the orchestrator id; the default is the main orchestrator).
- The orchestrator records of the board (D-7): name, role, state, card id, the session meters `contextPercent` and `cost` of its active session.
- The board snapshot (cards with `state`, `stateReason`, `stateSince`, `activeSessionId`, `contextPercent`, `cost`, `launch.playbook`, `startIntent.playbook`, `loopProgress`, `shipFlow`, `memberIds`, `groupId`). The branches come from the cards whose owner resolves to the selected orchestrator (D-7). Hidden cards and group members are not branches.
- The decision items of the board, open and answered (D-3). The newest approved `plan` item of the selected orchestrator gives the planned branches and their order. A newer open plan adds only the refs that the approved plan does not have, after them, as a preview. A rejected plan adds nothing.
- The conversation of the selected orchestrator: `GET /api/boards/<KEY>/orchestrators/<id>/conversation`. The user turns, the orchestrator text replies and the lines that Dispatch typed, in transcript order, with no tool calls.
- Polling: conversation and decision items every 3 s while the screen is open. The branches follow the board stream.

### Layout

- **1440 px:** two regions under the page header. Left: the canvas with the faint dot grid. The orchestrator node is at the top left of the canvas. The branches are one vertical stack to the right of it, joined to it by elbow edges. The stack is in bands, in this order: Needs you, Running, Planned, Done. A shipped card is not a branch (LOCAL-133). Each band has an uppercase eyebrow heading with a count. Right: the conversation pane, 420 px wide, with the tabs Conversation and Terminal. Conversation is the default tab.
- **1024 px:** the same two regions. The conversation pane is 360 px wide. The node tiles take the full width of the stack.
- **390 px:** a compact orchestrator header (name, state badge, context, cost, "<n> branches, <m> need you"), then the tabs Branches and Conversation. Branches is the default tab. The Branches tab shows the bands as a grouped list with the same tiles and actions and no edges. The Conversation tab holds the pane with its Conversation and Terminal tabs.
- The canvas draws the edges in one SVG layer behind the tiles. The tiles are focusable buttons in the band order. A new branch goes into its band after the branches of the same plan rank; the other tiles keep their place.

### Parts

| Part                       | Primitive                              | Copy                                                                                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page title                 | page header                            | "Orchestrator", or "Orchestrator · <board name>" when more than one board exists                                                                                                                                                                                             |
| Orchestrator controls      | `button`, `badge`                      | The state badge of "Cross-screen rules". The Start, Stop or Resume button of the next rows. "Settings" (`outline` variant).                                                                                                                                                  |
| Start button               | `button`                               | "Start orchestrator". It shows when no orchestrator session runs and the session is not `lost` or `shell_prompt`. It uses the `default` variant. Disabled when `supervisor` is `off`, with the reason below it: "Turn on the supervisor in Policy to start an orchestrator." |
| Stop button                | `button`, `tooltip`                    | "Stop". Tooltip "Interrupt the current turn. The session stays open." It sends one Escape key, as `stop_session` does (D-4). Disabled while the session is `permission_prompt`, `usage_limit_dialog`, `usage_limit_wait` or `shell_prompt` (D-4).                            |
| Resume orchestrator button | `button`                               | "Resume orchestrator". It shows only when the orchestrator session is `lost` or `shell_prompt`. It runs the resume saga (D-3). At `lost` and `shell_prompt` the controls show only this button; Start and Stop do not show.                                                  |
| Orchestrator switcher      | `select`                               | Label "Orchestrator" (sr-only). One option per orchestrator: "<name>" with "Main" or "Extra". Shows only when the board has more than one orchestrator.                                                                                                                      |
| Orchestrator node          | module component                       | Eyebrow "Orchestrator", the name, the state badge, "Context <n>%", "$<cost> today", "<n> branches, <m> need you"                                                                                                                                                             |
| Band heading               | `badge`                                | "Needs you", "Running", "Planned", "Done", each with its count                                                                                                                                                                                                               |
| Branch tile                | module component                       | The card id (mono), the title, the state badge, the detail line, "Playbook <name>", "Context <n>%", "$<cost>". A planned branch with no session shows "Not started" in place of the meters.                                                                                  |
| Branch state badge         | `badge`                                | "Planned", "Running", "Needs input", "Usage limit", "Agent done", or the label of "Cross-screen rules" for the other session states. Each with its glyph.                                                                                                                    |
| Detail line                | text                                   | Running: "Unit <n> of <m>, phase <p> of <q>" or "Phase <p> of <q>". Group: "Group of <n> tickets". Planned: "Plan order <n>, size <size>". Done: "Done <time>, awaiting ship".                                                                                               |
| Inline reply               | `field`, `label`, `textarea`, `button` | The copy of the Screen 4 inline reply, with the card id                                                                                                                                                                                                                      |
| Branch actions             | `button`                               | "Resume loop", "Try resume again", "Open terminal" with the rules of Screen 4 Section 1                                                                                                                                                                                      |
| Pane tabs                  | `tabs`                                 | "Conversation", "Terminal"                                                                                                                                                                                                                                                   |
| Message                    | `item`                                 | Eyebrow "You", "<orchestrator name>" or "Dispatch", and the time (mono). The text.                                                                                                                                                                                           |
| Decision message           | `item`, `button`, `badge`, `table`     | Badge "Decision" or "Question". The question. A plan shows a table with the heads "Order", "Ticket", "Playbook", "Size". The option buttons, the recommended mark and the other answer of Screen 4, Section 1. An answered item shows "Answered: <option label>".            |
| Comment box                | `field`, `label`, `textarea`, `button` | Label "Message the orchestrator" (sr-only). Placeholder "Message the orchestrator". Button "Send". The count "<n> of 500 characters. A longer reply goes as a file." Results "Delivered", "Not confirmed. Check the terminal."                                               |
| Terminal                   | terminal frame                         | The live ttyd terminal of the orchestrator session, fully interactive. The frame stays mounted when the user changes tabs.                                                                                                                                                   |

### Keyboard

- Tab order: page header, the orchestrator node, the tiles in band order, then the pane.
- In the canvas, the up and down arrow keys move focus from tile to tile in band order, Home goes to the orchestrator node and End to the last tile.
- Enter on a tile opens the card (the detail panel of the card). Enter on the orchestrator node moves focus to the comment box.
- The inline controls of a tile are reachable with Tab inside the tile.

### States

| State        | What shows                                                                                                                                                                                                                                                         | Copy                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Empty        | The board has no orchestrator: the terminal shows the empty block "No orchestrator on this board", and the controls show "Start orchestrator". The orchestrator has no branch: the orchestrator node and one line in the canvas. No message: one line in the pane. | "This board has no orchestrator." "No tickets or groups yet. Ask the orchestrator in the conversation." "No messages yet." |
| Loading      | `skeleton` tiles in the canvas and `skeleton` rows in the pane.                                                                                                                                                                                                    | Screen reader text "Loading command centre"                                                                                |
| Error        | An `alert` in the region that did not load. The other region stays. A conversation status `no-transcript` or `unreadable` shows one line and the link to the Terminal tab.                                                                                         | "<region> did not load: <error message>." Button "Try again". "The conversation is not available. Open the terminal."      |
| Stale        | The last data stays. A `badge` beside the page title shows the time of the last update. The reply, resume, decision and send buttons are disabled until the stream is back.                                                                                        | Badge "Data from <time>". Disabled reason "Reconnecting. Actions are off until the board stream is back."                  |
| Action error | A failed reply, decision answer, resume or comment. The control stays and shows an `alert` under it.                                                                                                                                                               | "<Action> failed: <error message>." Button "Try again". "Not sent. <id> is now at <state label>. Open the terminal."       |

### Settings sheet

The button "Settings" opens the settings sheet. Screen 3 gives its rules.

## Cross-screen rules

### Keyboard

- Each control on the five screens is reachable with Tab, in the visual order: page header, then the content top to bottom, then the right pane or the sheet.
- `b` opens the command palette with the Boards group only (Screen 2). The cheat sheet always lists it in the Global group as "Switch board".
- Escape closes the top layer first: a menu, then a dialog, then the detail panel, then the settings sheet of Screen 6 (an open dialog in the sheet closes first, then the sheet).
- In a decision item, the option buttons are in their written order. The recommended mark does not move the option.
- The board keys of today (`j`, `k`, `h`, `l`, Enter and the digits) stay off while the detail panel is open.

### Focus

Each focusable part shows the focus outline of the design contract: 2 px solid `--accent`, offset 2 px. No ring and no box shadow (frontend rule 15).

### Colour-free reading

Each state on these screens has a glyph and a text label. Colour is an extra signal, never the only one. This applies to the session state badges, the segments of the progress bar, the ship states and the warning tone of the meters. A screen in grayscale shows the same information.

### Themes

Each screen works in the dark theme (the `:root` default of `tokens.css`) and the light theme (`:root[data-theme="light"]`). Each colour comes from a token. Text meets the contrast floor of the design contract in both themes.

### Session state labels

The 12 session states of D-3 have these labels and glyphs on every screen. The glyph is a `lucide-react` icon name.

| State                | Label                     | Glyph (lucide)              | Tone      |
| -------------------- | ------------------------- | --------------------------- | --------- |
| `working`            | "Working"                 | `Play`                      | neutral   |
| `idle`               | "Idle"                    | `Pause`                     | muted     |
| `needs_input`        | "Needs input"             | `MessageCircleQuestionMark` | attention |
| `permission_prompt`  | "Permission prompt"       | `ShieldQuestionMark`        | attention |
| `handoff_ready`      | "Handing off"             | `ArrowRightLeft`            | neutral   |
| `roadmap_complete`   | "Roadmap done"            | `CircleCheck`               | success   |
| `usage_limit_dialog` | "Usage limit dialog"      | `Gauge`                     | attention |
| `usage_limit_wait`   | "Waiting for usage reset" | `Hourglass`                 | muted     |
| `api_error`          | "API error"               | `TriangleAlert`             | error     |
| `stale`              | "No progress"             | `Clock`                     | attention |
| `lost`               | "Session lost"            | `Unplug`                    | error     |
| `shell_prompt`       | "Claude exited"           | `SquareTerminal`            | error     |

The tone maps to the `badge` tones of `src/web/components/ui/badge.tsx`: attention uses `tone="state"` with `stateColor="var(--col-needs-input)"` (the label mixes 35 percent of the state colour with `--text`, so it meets the contrast floor), error uses `danger`, success uses `success`, muted uses `neutral`, and neutral uses the `outline` variant. The warning of a meter (cost, usage) uses the `warning` tone with the glyph `TriangleAlert` and a word. A column token such as `--col-needs-input` is never a text colour. The other badges on these screens ("Default", "Main", "Extra", "By orchestrator", "Recommended", "Key clash", the ship flow state and the counts) use `tone="neutral"`. No badge on these screens uses `tone="accent"`. Ship, check and identity badges: `merged` and "Passing" use `success`; `failed`, "Failing" and "Author mismatch" use `danger`; the others use `neutral`.

### Notice policy

A notice is the desktop notification and chime of a card move, or the undo toast. A notice reports news only. These four rules apply to every notice (LOCAL-146):

1. A session start or a session success does not cause a notice. Only a move into Needs Input or Agent Done causes one. Agent Done is a hand-off to the user, not a success. A move into In Progress, In Review or Done causes no notice.
2. A failure older than 5 minutes does not cause a notice. The age of a move is the time since the card's `columnSince`. A move exactly 5 minutes old still causes a notice. The rule applies to Needs Input and Agent Done, because a failure arrives as Needs Input.
3. A reconnect replay does not cause a notice. The first snapshot after a reconnect or a board change only records the columns.
4. A hidden tab does not replay a backlog when it becomes visible. A move made before the tab last became visible, and not notified while the tab was hidden, causes no notice. A hidden tab that stays live keeps its notices.

The undo toast follows these rules without extra code: only a user action in the same tab shows it, the store holds one toast, and the stream never writes it.

## Sketches

Static sketches of the populated state of each screen. Each sketch is one HTML file with the shared `sketch.css`. Open a sketch with `?theme=light` or `?theme=dark`. The sketches are throwaway: they are not product code. The 1024 px layout and the empty, loading, error and stale states are in this spec only.

| Screen                                                              | Sketch                                                                        | 1440 px light                                                                                                 | 1440 px dark                                                                                                | 390 px light                                                                                                | 390 px dark                                                                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Screen 1: Boards page                                               | [boards.html](../research/sketches/boards.html)                               | [boards-1440-light.png](../research/sketches/screenshots/boards-1440-light.png)                               | [boards-1440-dark.png](../research/sketches/screenshots/boards-1440-dark.png)                               | [boards-390-light.png](../research/sketches/screenshots/boards-390-light.png)                               | [boards-390-dark.png](../research/sketches/screenshots/boards-390-dark.png)                               |
| Screen 2: Board switcher (superseded by the sidebar Boards section) | [switcher.html](../research/sketches/switcher.html)                           | [switcher-1440-light.png](../research/sketches/screenshots/switcher-1440-light.png)                           | [switcher-1440-dark.png](../research/sketches/screenshots/switcher-1440-dark.png)                           | [switcher-390-light.png](../research/sketches/screenshots/switcher-390-light.png)                           | [switcher-390-dark.png](../research/sketches/screenshots/switcher-390-dark.png)                           |
| Screen 3: Orchestrator panel (replaced by the settings sheet)       | [orchestrator-panel.html](../research/sketches/orchestrator-panel.html)       | [orchestrator-panel-1440-light.png](../research/sketches/screenshots/orchestrator-panel-1440-light.png)       | [orchestrator-panel-1440-dark.png](../research/sketches/screenshots/orchestrator-panel-1440-dark.png)       | [orchestrator-panel-390-light.png](../research/sketches/screenshots/orchestrator-panel-390-light.png)       | [orchestrator-panel-390-dark.png](../research/sketches/screenshots/orchestrator-panel-390-dark.png)       |
| Screen 4: Dashboard                                                 | [dashboard.html](../research/sketches/dashboard.html)                         | [dashboard-1440-light.png](../research/sketches/screenshots/dashboard-1440-light.png)                         | [dashboard-1440-dark.png](../research/sketches/screenshots/dashboard-1440-dark.png)                         | [dashboard-390-light.png](../research/sketches/screenshots/dashboard-390-light.png)                         | [dashboard-390-dark.png](../research/sketches/screenshots/dashboard-390-dark.png)                         |
| Screen 5: Board with no orchestrator                                | [board-no-orchestrator.html](../research/sketches/board-no-orchestrator.html) | [board-no-orchestrator-1440-light.png](../research/sketches/screenshots/board-no-orchestrator-1440-light.png) | [board-no-orchestrator-1440-dark.png](../research/sketches/screenshots/board-no-orchestrator-1440-dark.png) | [board-no-orchestrator-390-light.png](../research/sketches/screenshots/board-no-orchestrator-390-light.png) | [board-no-orchestrator-390-dark.png](../research/sketches/screenshots/board-no-orchestrator-390-dark.png) |
| Screen 6: Command centre                                            | [centre-b.html](../research/sketches/centre-b.html)                           | [centre-b-1440-light.png](../research/sketches/screenshots/centre-b-1440-light.png)                           | [centre-b-1440-dark.png](../research/sketches/screenshots/centre-b-1440-dark.png)                           | [centre-b-390-light.png](../research/sketches/screenshots/centre-b-390-light.png)                           | [centre-b-390-dark.png](../research/sketches/screenshots/centre-b-390-dark.png)                           |

## Changes

### 2026-10-07 (LOCAL-92)

This entry adds to the screens above. It does not change the text of an earlier section.

- **Screen 4, Section 2 (R-12).** Each row gains two neutral badges after the state badge. "Session <time>" shows the age of the active session. The time-left badge shows "About <time> left", "At least <time> left" when a later unit has no PRD, or "Estimate after 2 gates" when fewer than two gates passed.
- **Screen 4, Section 2 label (U1-11).** A loop with all units shipped shows "<n> of <n> units shipped". A loop between units shows "<done> of <total> units built, unit <n> not started".
- **Screen 4, Section 3 (U1-10).** The section gains a collapsible "Show cards" list. A group select and a column select filter the list.
- **Screen 4, Section 4 (U1-09).** The section gains an actor select with the options All, Orchestrator, Supervisor and You, and a group select.
- **Screen 1 (R-16).** The boards table gains a "Loops" column after "Attention". Each running loop shows "<group id> <percent>%". The cell shows at most three loops, then "+<n> more". A board with no running loop shows "0". From 768 px to 1279 px, the cell shows only the number of running loops, as the Repositories cell shows a count (U1-30). Below 768 px, each board item gains one more badge line with the same text.
- **Screen 1, Loops cell (2026-10-09, LOCAL-95).** A running group with no loop progress shows "<group id> no loop progress" in place of "<group id> <percent>%". The cell lists the same groups that the dashboard count "<n> of <cap> loops running" counts.

### 2026-10-09 (LOCAL-96)

This entry adds to the screens above. It does not change the text of an earlier section.

- **Policy form, Wake timer (U2-09).** The form gains a text input "Wake timer (minutes)" after "Hard handoff at context percent". It accepts a whole number from 0 to 1440. Any other text shows the error "Enter a whole number from 0 to 1440." and "Save policy" saves nothing. The helper text reads "Wakes an idle orchestrator after this many quiet minutes. 0 turns it off." The override form of an extra orchestrator has no such field.
- **Orchestrators tab, Last wake column (U2-10).** The table gains a "Last wake" column after "Policy". The value is "<reasons> at <HH:MM>", with the reasons joined by ", " and the time in local 24-hour format, or "None" when the orchestrator has not woken. The cell wraps its text like the other text columns, so the table keeps its columns at 390 px.
- **Activity, wake row (U2-12).** A `supervisor_action` with `action` `orchestrator_wake` reads "Woke <orchestrator name>: <reasons joined with ', '>". When the event has no orchestrator name, it shows the identifier of the orchestrator card in place of the name. An unconfirmed send reads "Could not wake <orchestrator name>: <reasons>". A `group_state` event reads "<group id> <label>" with the actor "Supervisor"; the labels are "reached Agent done", "needs input", "failed to start", "shipped", "ship stopped", "loop error" and "hit a usage limit".

### 2026-10-11 (LOCAL-104)

This entry adds to the screens above. It does not change the text of an earlier section.

- **Screen 6, Command centre.** A new screen at `/orchestrator?board=<KEY>`. The layout is the orchestrator tree, chosen in `docs/research/orchestration-centre-research.md`, section "Chosen layout". The candidate sketches are `centre-a.html`, `centre-b.html` and `centre-c.html`.
- **Entry point.** In Part 1b, the board header button "Orchestrator" opens Screen 6 in place of the panel. Until Part 2, the "Settings" button of Screen 6 opens the Policy tab of the panel (Screen 3).
- **Screen 3.** In Part 2, a settings sheet of Screen 6 takes the Policy and Orchestrators tabs, and the panel goes away. The Terminal and Decisions tabs of Screen 3 are covered by the Terminal tab and the decision messages of Screen 6.
- **Screen 4.** The attention queue and the progress rows stay. In Part 1b, the dashboard gets a link "Open command centre" to Screen 6.
- **Decision kind `plan`.** A plan decision shows its entries as a table (Order, Ticket, Playbook, Size) and the options "Approve the plan" and "Do not approve". It has no other answer.

### 2026-10-13 (LOCAL-104)

This entry adds to the screens above. It does not change the text of an earlier section.

- **Screen 6, route (Data list, entry of 2026-10-11).** The keyed route `/boards/<KEY>/orchestrator` replaces `/orchestrator?board=<KEY>`. The optional path part `/<orchestrator id>` replaces the `orchestrator` search parameter. The default is the main orchestrator.
- **Screen 6, flat route.** `/orchestrator` and `/orchestrator/<orchestrator id>` only redirect. They take the board from the `board` search parameter, then replace the history entry with the keyed route and drop `board` from the search. They render no page.
- **Entry point.** The board header button reads "Orchestrator" when the board has an orchestrator. With none, it reads "Add orchestrator" from 768 px and "Orchestrator" below 768 px. Both open Screen 6. The dashboard link "Open command centre" sits in the dashboard page header. The sidebar has no row for Screen 6.
- **Screen 6, controls from 768 px.** The controls sit in the page header: the stale badge, the switcher, "Start", "Stop" or "Resume", and "Settings". A control alert shows under them.
- **Screen 6, controls below 768 px.** The page header holds no controls. The same controls sit inline at the top of the page body, above the compact node. The compact node has no eyebrow "Orchestrator". A control alert shows under the controls.
- **Screen 6, narrow tabs.** The tabs "Branches" and "Conversation" follow the compact node. The Conversation tab is 480 px high. It holds the pane with its own tabs "Conversation" and "Terminal". The terminal frame stays mounted across both tab levels.
- **Screen 6, tab reset.** The page tab, the pane tab and the focus request live in one store. They return to "Branches" and "Conversation" when the user leaves the page.
- **Screen 6, state badge.** The state badge sits in the orchestrator node, not with the controls. It reads "Starting", "Stopping", "Stopped" or the label of the session state.
- **Screen 6, node count.** One branch reads "1 branch, 0 need you". The branch count covers the four bands only. A shipped card is not counted (LOCAL-133).
- **Screen 6, tile states and details.** Two more badges show: "Budget reached" and "Resume failed". The stuck session states show their own labels. The detail lines "Needs your answer", "Stopped at the usage limit" and "Budget reached" are new. A done branch with no time reads "Awaiting ship".
- **Screen 6, tile times.** A time reads "HH:MM" on the current day and "<day> <month> HH:MM" on another day. The clock has 24 hours.
- **Screen 6, planned tile.** A planned branch with no card is not a button. It takes focus with Tab and the arrow keys. It has no open action.
- **Screen 6, Open terminal.** On a tile, "Open terminal" goes to the board page. It does not select the card.
- **Screen 6, message time.** A message shows its age, for example "5m ago". It does not show a clock time.
- **Screen 6, answered decisions.** The conversation shows every open decision of the orchestrator. It shows only the 20 newest answered decisions, by answer time, then by creation time.
- **Screen 6, "Not sent" line.** A refused send because of the session state shows as the result line next to the button, with no alert and no "Try again". In the comment box it reads "Not sent. <orchestrator name> is now at <state label>. Open the terminal." The same applies to the inline reply of a tile, with the card id.
- **Screen 6, Enter on the node.** Enter selects the Conversation page tab and the Conversation pane tab, then moves focus to the comment box. Only a plain Enter on the node itself does this. With no orchestrator record, Enter does nothing.
- **Screen 6, unknown orchestrator.** A path with an orchestrator id that the board does not have shows "Canvas did not load: no orchestrator <id> on this board." with "Try again".

### 2026-10-13 (LOCAL-106)

This entry adds to the screens above. It does not change the text of an earlier section.

This entry replaces the Layout, the section order rule and the Section 2 segmented bar of Screen 4 for the dashboard look. It changes no data, action or state.

- **Layout.** The page title is "Project map", on a dot-grid background. At 1024 px and wider, the order is: the status line, Progress per group (full width), Left on this board (full width), then two columns. The main column holds Tickets by column. The rail holds Next step, Needs your call, Changed since, and Cost and usage. Below 1024 px, the order is: the status line, Needs your call, Progress per group, Left on this board, Tickets by column, Next step, Changed since, and Cost and usage. Each section has one copy in the DOM. The section headings are small uppercase labels. The screen reader names stay: "Attention queue", "Progress per group", "Left on this board", "Tickets by column", "Next step", "Activity log" and "Cost and usage".
- **Command centre link.** The link "Open command centre" sits at the end of the title row. It replaces the dashboard page header link of the LOCAL-104 entry. The dashboard has no page header actions.
- **Status line.** One line under the title. It shows "Synced HH:MM" (or "Data from <time>" when the stream is down), "<n> of <cap> loops running", "<n> gates passed today" (loop phases whose gate passed on the local calendar day), "$<amount> spent" (a running total of the group costs, not a daily figure) and the link "<n> need a call". With zero rows the link reads "nothing needs you" and its dot is muted. The link moves focus to the Needs your call card.
- **Section 2, milestone track.** Each loop is a track with one node for each unit. A loop with no units shows "No loop progress". The session badges and the last gate text stay on the track header. A node has a glyph and a state line, so it reads without color.

  | State       | Glyph                                                | State line                                                     |
  | ----------- | ---------------------------------------------------- | -------------------------------------------------------------- |
  | Done        | Check                                                | "Done HH:MM", or "Done" with no time                           |
  | Current     | Accent ring with a glow, and the pill "You are here" | "Phase n of m", with a phase sub-bar                           |
  | Failed gate | X                                                    | "Gate failed"                                                  |
  | Pending     | Outline                                              | "Next" for the first pending node, "Later" for the other nodes |

- **Left on this board.** The count of open cards (cards not in Agent done, In review or Done) and one pill for each open card. A pill shows the card id and a glyph. The order is stuck, needs input, current, not started. With no open card it shows "Nothing open."
- **Section 3, tiles.** The filters Group and Column are above the tiles and stay visible. One tile shows for each card that the filters select. With no match it shows "No cards match." A tile shows the mono id, the title, a state pill and a footer line when there is data. The pill shows a glyph and the column label, or "Stuck: <reason>". The footer shows the last gate text, "Depends on <ids>" or "Shipped HH:MM". The collapsible "Show column counts" replaces "Show cards" and holds the column count table (and a list below 768 px). The link "Open board" stays on the section header. Tiles sort by state, then by id.

  | Tile state  | Source                                                           | Look           |
  | ----------- | ---------------------------------------------------------------- | -------------- |
  | Stuck       | Start error, lost session or failed last gate (wins over column) | Red hatch      |
  | Needs input | The card needs input                                             | Amber tint     |
  | Current     | In Progress                                                      | Accent ring    |
  | Not started | To Do or Parked                                                  | Dashed outline |
  | Done        | Agent Done, In Review or Done                                    | Plain          |

- **Next step.** For the first running loop with a current unit, it shows "<group id> unit <n>: <unit title>" and "Phase <n> of <m>: <phase name>". With no such loop it shows "No loop running" and "Start a group from the board."
- **Section 1, Needs your call.** The card was "Attention queue". The items, the actions, the disabled reason text and the empty text "Nothing needs you." stay. The card has a red tint only when it holds at least one item. The recommended decision option is bold.
- **Section 4, Changed since.** The section was "Activity log". The heading reads "Changed since <time>", where the time is the time of the oldest row on the shown page. A row has a dot, the change text with the card id in bold, and the time on the right. The dot is red for a failed gate, a loop error, a failed start or a stopped ship. It is amber for needs input and a usage limit. It is green for a passed gate, agent done and shipped. It is grey for the other rows. The Actor and Group filters, "Show more" (20 rows for each page), "No activity matches." and "No activity on this board yet." stay.
- **Section 6, Cost and usage.** The same rows and meters, as compact rows. "No cost yet." stays.
- **Motion.** The glow of the current node breathes only when the system allows motion (`motion-safe`).
- **Colour-free reading.** Each node, each tile and each pill has a glyph and a text. Colour is an extra signal, never the only one.

### 2026-10-14 (LOCAL-111)

This entry changes the routes row of the panel, the Change budget row, the Escape order line and the first line of Screen 3. It adds the settings sheet part to Screen 6.

- **Screen 6, settings sheet.** The settings sheet replaces the Policy and Orchestrators tabs of the panel of Screen 3.
- **Entry points.** The button "Settings" and the old panel links open the sheet. The old link `/boards/<KEY>?panel=orchestrator` redirects to the centre.
- **Screen 3.** Screen 6 and its settings sheet replace Screen 3.
- **Change budget.** The button always opens the Policy tab. The earlier text gave a second path for a `budgetPerGroup` override (the Orchestrators tab with the "Edit overrides of <name>" dialog). The app never had that path. This entry removes it, so the spec agrees with the app.

### 2026-10-14 (LOCAL-118)

This entry changes the text of Screen 3 and of the sections that cite it. It changes no behaviour of the app.

- **Screen 3.** Screen 3 is now the settings sheet of the command centre. The panel text is removed. The Settings sheet section of Screen 6 moved into Screen 3.
- **Screen 6, controls.** The Start, Stop and Resume rows of the panel moved into the parts of Screen 6. The "Stopped loops" list of the panel has no place on the centre; the "Resume loop" action of a branch tile replaces it.
- **Citations.** Screen 4 and Screen 6 cite Screen 4, Section 1 for the decision options, and Screen 6 for the controls. Screen 5 opens Screen 6, as the LOCAL-104 entry of 2026-10-13 gives.

### 2026-10-16 (LOCAL-146)

This entry adds to the screens above. It does not change the text of an earlier section.

- **Cross-screen rules, Notice policy.** A new section gives the four suppression rules for notices: no notice for a session start or success, none for a failure older than 5 minutes, none for a reconnect replay, and no backlog replay when a hidden tab becomes visible.
