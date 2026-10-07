# Recorded pane fixtures

Real tmux pane text from Claude Code sessions, taken from the `tmux capture-pane -p` tool results in the LOCAL-22 orchestrator transcripts (U2-24). Each file is plain text without ANSI, as the tool result returned it. Only fully blank trailing lines were trimmed. The non-breaking space after the `❯` prompt is kept.

Source folder: `~/.claude/projects/-Users-yash-dispatch-workspaces-LOCAL-22/` (read-only). The line number is the 1-based line of the `tool_result` record in the jsonl file. The timestamp is that record's `timestamp`.

## Fixtures

| File                       | State                                                                      | Source jsonl                                 | Line | Timestamp                | Scrubs |
| - | - | - | - | - | - |
| `working.txt`              | spinner working footer (Boondoggling)                                      | `033044ba-e6e2-4dad-b41d-964a1a9c82c0.jsonl` | 3579 | 2026-09-30T03:13:50.878Z | none   |
| `idle.txt`                 | idle prompt after a finished turn                                          | `033044ba-e6e2-4dad-b41d-964a1a9c82c0.jsonl` | 5575 | 2026-09-30T16:49:59.990Z | none   |
| `needs-input-question.txt` | DISPATCH_STATUS NEEDS_INPUT then empty prompt                              | `4d1c1cad-ea85-4eda-8b6a-6b2df4b0c078.jsonl` | 2572 | 2026-10-02T00:50:51.789Z | none   |
| `permission-prompt.txt`    | tool permission dialog (Do you want to proceed)                            | `033044ba-e6e2-4dad-b41d-964a1a9c82c0.jsonl` | 4133 | 2026-09-30T08:09:23.016Z | none   |
| `dangerous-delete.txt`     | permission dialog for a dangerous rm                                       | `f28703a9-bfe1-47a5-b3fb-9712e55dfa29.jsonl` | 3078 | 2026-09-25T06:12:01.335Z | none   |
| `peer-message.txt`         | held message from another session                                          | `033044ba-e6e2-4dad-b41d-964a1a9c82c0.jsonl` | 5377 | 2026-09-30T15:28:34.595Z | none   |
| `handoff-ready.txt`        | HANDOFF_READY line then idle prompt                                        | `033044ba-e6e2-4dad-b41d-964a1a9c82c0.jsonl` | 1907 | 2026-09-29T16:56:49.347Z | none   |
| `roadmap-complete.txt`     | promise ROADMAP COMPLETE line                                              | `f28703a9-bfe1-47a5-b3fb-9712e55dfa29.jsonl` | 961  | 2026-09-24T22:31:23.427Z | none   |
| `limit-menu.txt`           | rate limit options dialog with 3 numbered options                          | `f28703a9-bfe1-47a5-b3fb-9712e55dfa29.jsonl` | 3193 | 2026-09-28T07:39:51.231Z | none   |
| `limit-menu-2.txt`         | weekly limit dialog from a two pane capture, with the limit error above it | `4d1c1cad-ea85-4eda-8b6a-6b2df4b0c078.jsonl` | 1419 | 2026-10-01T14:14:16.405Z | none   |
| `auto-continue.txt`        | limit reached, "Continuing automatically at" notice                        | `4d1c1cad-ea85-4eda-8b6a-6b2df4b0c078.jsonl` | 1757 | 2026-10-01T16:56:10.600Z | none   |
| `auto-continue-2.txt`      | "Automatic continue cancelled" notice                                      | `4d1c1cad-ea85-4eda-8b6a-6b2df4b0c078.jsonl` | 1788 | 2026-10-01T19:11:50.323Z | none   |
| `api-error.txt`            | API Error: response stopped arriving                                       | `4d1c1cad-ea85-4eda-8b6a-6b2df4b0c078.jsonl` | 2777 | 2026-10-02T02:18:10.082Z | none   |
| `api-error-2.txt`          | API Error: computer went to sleep mid-response                             | `4d1c1cad-ea85-4eda-8b6a-6b2df4b0c078.jsonl` | 997  | 2026-10-01T04:47:42.643Z | none   |
| `warming-up.txt`           | status line warming up                                                     | `f28703a9-bfe1-47a5-b3fb-9712e55dfa29.jsonl` | 723  | 2026-09-24T21:45:45.071Z | none   |
| `warming-up-2.txt`         | warming up with the startup banner and a queued prompt                     | `f28703a9-bfe1-47a5-b3fb-9712e55dfa29.jsonl` | 2778 | 2026-09-25T05:30:34.463Z | none   |

## Extraction notes

- The orchestrator never saved an unfiltered capture. Every tool result went through a pipeline such as `grep -v blank | tail -N | cut -c1-N`, so each fixture is the last N non-blank lines of a pane, with long lines cut. A cut can end a line in the middle of a multi-byte character.
- Several commands printed other output next to the pane. Only the pane part is kept. The slice per file:
  - `working.txt`: whole result.
  - `idle.txt`: first 10 lines (pane); later lines are other commands.
  - `needs-input-question.txt`: whole result.
  - `permission-prompt.txt`: whole result.
  - `dangerous-delete.txt`: whole result.
  - `peer-message.txt`: whole result.
  - `handoff-ready.txt`: lines 4 to 10 (pane); first 3 lines and last line are other commands.
  - `roadmap-complete.txt`: whole result.
  - `limit-menu.txt`: whole result.
  - `limit-menu-2.txt`: GROUP-13 section only; the date line after it is another command.
  - `auto-continue.txt`: GROUP-14 section only.
  - `auto-continue-2.txt`: GROUP-13 section only; the date line after it is another command.
  - `api-error.txt`: first 9 lines (pane); later lines are other commands.
  - `api-error-2.txt`: first 12 lines (pane); later lines are other commands.
  - `warming-up.txt`: whole result.
  - `warming-up-2.txt`: whole result.
- Scrub rules checked on every fixture: API key prefixes (OpenAI style, GitHub, Slack, AWS), bearer headers, token query parameters, hex or base64 strings over 32 characters, and email addresses. No fixture contained a match, so nothing was replaced and the Scrubs column says none. The scan result is in `.planning/g18-orch-runtime-unit-2/qa/phase-1/secret-scan.txt`.
- Script source check: no fixture contains `#!/bin/`, `case "$` or `grep -E`. Every kept capture is a tool result, not text written by the orchestrator model.
- The panes show the Claude Code footer with `bypass permissions on`. That mode hides `esc to interrupt`, so the working state is recognised by the spinner line (for example `✽ Boondoggling… (25m 53s · ↓ 33.3k tokens)`).
- `peer-message.txt` also holds a `DISPATCH_STATUS: NEEDS_INPUT` line above the held message dialog.

## Not found in the source

- `idle-a.txt` and `idle-b.txt` (an identical idle pair): searched all 581 capture results for two captures of the same pane with the same body. The footer carries elapsed time and cost, and no two captures match, even with the footer lines removed or with different tail lengths. `idle.txt` is one real idle capture. A pair can be built by feeding it twice.
- `choice-menu.txt` (a generic numbered choice menu, such as an AskUserQuestion list): searched for `❯ N.` lines, `Enter to select`, `to navigate`, `Type something` and `↑/↓`. Every numbered `❯` menu found is a permission dialog or the rate limit dialog; the held peer message dialog is an unnumbered `❯` menu. They are stored as `permission-prompt.txt`, `dangerous-delete.txt`, `limit-menu.txt`, `limit-menu-2.txt` and `peer-message.txt`.
- `shell-prompt.txt` is not from the source: searched for `$` or `%` prompt lines, `user@host` prompts, `zsh:`, `command not found`, `Resume this conversation`, `pane_dead=1` and `cmd=zsh`, and no pane showed a shell. It is a real capture of a zsh prompt (`PS1="yash@mac dispatch %% "`, `zsh -f -i`) in a 120 by 20 pane on a private tmux server, recorded on 2026-10-06 with `capture-pane -p -J` and trailing spaces trimmed.
- API errors with 500, 529, overloaded or connection error text: searched for `529`, `overloaded`, `Connection error`, `ECONNRESET`, `Request timed out` and `ENOTFOUND`. Only two `API Error:` panes exist (`api-error.txt`, `api-error-2.txt`). A 429 weekly limit error is inside `limit-menu-2.txt`.
- `esc to interrupt` working footer: no pane capture contains it (see the extraction notes).
