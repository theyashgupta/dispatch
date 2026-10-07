# Claude accounts study (LOCAL-94)

This study answers the 6 points of LOCAL-94 Phase 1 with evidence. The Unit 2 design of the account chain rests on it.

- **Date:** 2026-10-06.
- **Claude CLI:** 2.1.290 (installed 2026-10-06) for part 1. The CLI updated itself to 2.1.291 at 12:30Z on 2026-10-06, during the real session of part 2. Unit 1 measured 2.1.289.
- **Status:** complete. Part 1 covered the points that need no second account. Part 2 (2026-10-06, 12:28Z to 12:44Z) covered the rest with a real second account.
- **Evidence:** part 1 was collected on 2026-10-06 with CLI 2.1.290: strings read from the CLI binary, the layout of an added account folder, transcript limit lines, subagent limit notifications and the quoted terms. The captures are not committed. Each section names what each source measured.
- **Unit 1 measurements:** the Unit 1 measure file (`unit-1-measure.md` in the G15 roadmap folder, not committed) records the limit surfaces, the `StopFailure` hook and the resume of one conversation id on Default with CLI 2.1.289, and the keys sent to fake surfaces. Its captures are not committed.
- **Part 2 setup:** a sandbox Dispatch server of this branch with its own data folder, the real `claude` first on PATH and the real usage endpoint. Default is the home login. The second account is a real account (`max` plan) that another Dispatch on this Mac logged in. The sandbox used its config folder by path, through a test harness setting. Dispatch wrote nothing into that folder; only the CLI wrote to it, on launch (the workspace trust and its own session files), and the CLI refreshed its keychain item. One real session ran, with one line prompts.
- **Rules for the evidence:** no token or credential value is printed, logged or saved. Part 1 read no credential, started no Claude session and made no API call. Part 2 read only the `expiresAt` field of each keychain item: the keychain read went straight into a JSON field extract.

| Point | Subject                                      | Status                                 |
| ----- | -------------------------------------------- | -------------------------------------- |
| 1     | Credentials and token refresh                | Done.                                  |
| 2     | Usage endpoint                               | Done.                                  |
| 3     | How a limit shows                            | Done.                                  |
| 4     | Resume under the folder of another account   | Done.                                  |
| 5     | Subagent at a limit and at an account change | Done.                                  |
| 6     | Terms for more than one account per person   | Done. Ruled by the user on 2026-10-05. |

## Point 1: Credentials and token refresh

### Where the credentials of each config folder live

- On macOS the CLI keeps the OAuth credential in the login keychain. It uses one keychain item for each config folder.
- The item name is `Claude Code-credentials` for the home login (no `CLAUDE_CONFIG_DIR`). With `CLAUDE_CONFIG_DIR` set, the CLI adds `-` and the first 8 hex characters of the SHA-256 of the folder path.
- The CLI falls back to `<config folder>/.credentials.json` (mode `0600`) when the keychain refuses the write.
- Dispatch uses the same rule in `keychainServiceName` (`src/server/services/orchestration/claude-accounts.ts:127`). Dispatch never links `.credentials.json` into an account folder (`BLOCKLIST_EXACT`, `claude-accounts.ts:50`).
- An added account folder on this Mac holds no `.credentials.json`. So its credential is in the keychain.

Sources:

- Strings read from the CLI 2.1.290 binary: the keychain service name rule.
- The layout of an added account folder on this Mac, listed on 2026-10-06.
- Claude Code docs, "Credential management": https://code.claude.com/docs/en/authentication. Quote: "If you've set the `CLAUDE_CONFIG_DIR` environment variable, Claude Code keeps the `.credentials.json` file under that directory instead, including the file the macOS fallback writes, and keys the macOS Keychain entry to that directory too, so a session with a different `CLAUDE_CONFIG_DIR` reads a different entry."

### How a token refresh works for an account that is not in use

- The CLI refreshes the access token only inside a CLI process that runs on that config folder.
- The refresh step tests `now + 300000 ms >= expiresAt`. If the test is false, the refresh returns `not_needed`. If it is true, the CLI takes the lock file `<config folder>/.oauth_refresh.lock`, posts the refresh token, and saves the new pair in the same keychain item.
- No background service refreshes a token. So an account that no session uses keeps its last access token until the token expires.
- Dispatch does not refresh tokens. A second process that rotates the refresh token can log out the live REPL (`docs/ARCHITECTURE.md:2032-2036`). On a 401 or 403 the usage poll keeps the last windows and marks them `stale` (`src/server/services/orchestration/claude-usage.ts:118`).
- Effect on Unit 2: a stale read with a logged in folder gives the state `unknown`. The selection does not exclude `unknown`. The first launch on that account refreshes its token, and the next usage read gives its real state.

Sources:

- Strings read from the CLI 2.1.290 binary: the expiry test before a refresh, the refresh lock file in the config folder and the refresh steps.
- Claude Code docs, "Renew an expiring login": https://code.claude.com/docs/en/authentication.

### `expiresAt` of each account

| Read (2026-10-06) | Default (home login)         | Second account                    |
| ----------------- | ---------------------------- | --------------------------------- |
| 12:29Z            | 19:44:30Z, valid for 435 min | 01:45:07Z, expired 644 min before |
| 12:33Z            | 19:44:30Z, valid for 431 min | 20:30:58Z, valid for 477 min      |

- The keychain item of the second account is `Claude Code-credentials-88f3ae02`. The suffix is the first 8 hex characters of the SHA-256 of its folder path, as the rule above says.
- The second account logged in at 17:45Z on 2026-10-05. Its token expired 8 hours later. Until 12:30Z on 2026-10-06 no CLI process ran on its folder, so nothing refreshed the token.
- At 12:30:58Z one CLI launch on the second account folder refreshed the token. The new `expiresAt` is the launch time plus 8 hours.
- Default stayed valid because other CLI sessions on this Mac use the home login and refresh it.
- So the access token lives 8 hours. Only a CLI launch on the folder renews it. Dispatch renews no token.

Source: the `expiresAt` field of both keychain items, read at 12:29Z and 12:33Z on 2026-10-06.

## Point 2: Usage endpoint

### Request and response shape

- **Request:** `GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <access token>` and `anthropic-beta: oauth-2025-04-20` (`src/server/adapters/claude-usage.ts:7`, `fetchUsage` at `:76`). The token stays in memory only (`readAccessToken` at `:40`).
- **Legacy buckets:** `five_hour` and `seven_day`. Each bucket has `utilization` (percent) and `resets_at` (time). Dispatch maps them to the windows `session` (5 hours) and `weekly_all` (7 days).
- **Newer shape:** a `limits` array. Each entry has `kind`, `percent`, `resets_at`, `is_active` and an optional `scope.model`. Dispatch uses `limits` when it is present and not empty (`mapUsageResponse` at `:205`).
- **Team and Enterprise seats:** no rate limit windows. A `spend` block gives a monthly credit budget.
- **Status codes:** 401 and 403 give `stale`. 429 backs off for `Retry-After`. The poll runs each 15 minutes (`docs/ARCHITECTURE.md:2032-2034`).
- **Wire type:** `ClaudeUsageWindow` with `kind`, `percent`, `resetsAt`, `isActive`, `periodStart` and `periodEnd` (`src/shared/types.ts:1296`).
- **Fake endpoint:** Unit 1 served the legacy shape through `DISPATCH_USAGE_URL`. Example: `five_hour.utilization` 100, `seven_day.utilization` 17 (a fake usage response from Unit 1 QA).

### Usage reads of both accounts

Real reads through the sandbox server (boot poll and manual refresh), 2026-10-06:

| Time   | Default                                        | Second account                                               |
| ------ | ---------------------------------------------- | ------------------------------------------------------------ |
| 12:29Z | `ok`: session 4%, weekly 53%, weekly Fable 16% | `stale`, error `token-rejected`, no windows, state `unknown` |
| 12:33Z | `ok`                                           | `ok`: session 0%, weekly 0%, weekly Fable 0%                 |
| 12:44Z | `ok`: session 7%, weekly 54%, weekly Fable 17% | `ok`: session 0%, weekly 0%, weekly Fable 0%                 |

- The real endpoint returns the `limits` shape. Dispatch maps it to three windows: `session`, `weekly_all` and `weekly_scoped` (label `Weekly Fable`).
- At 12:29Z the second account ran no session and its token had expired. The endpoint refused the token, so Dispatch kept the account `stale` and the chain state `unknown`.
- At 12:33Z, after one CLI launch refreshed its token, the same read returned real windows.
- R-12 result: the endpoint reports usage for an account that runs no session, if its access token is not expired. An account that no CLI process used for 8 hours reads `token-rejected` until a launch on its folder refreshes the token. The selection treats that `unknown` state as eligible, so the first move to it refreshes it.

Source: `GET /api/accounts` and the manual usage refresh of each account on the sandbox server, 2026-10-06.

## Point 3: How a limit shows

### In a pane

Two surfaces exist, as Unit 1 measured. Both are in CLI 2.1.290 with the same text as in 2.1.289.

- **Surface (a), the automatic continue line.** Seen in tmux `dsp-GROUP-13` on 2026-10-05: `Usage limit reached · continuing automatically at 10:40am · esc to cancel`. The CLI has three forms: `Continuing automatically {when} · esc to cancel`, `Usage limit reached · continuing automatically {when} · esc to cancel` and `Usage limit reached again · continuing automatically {when} · esc to cancel`. `{when}` is `at <time>` or `shortly`. After Esc the CLI shows `Automatic continue cancelled · /rate-limit-options to re-arm`.
- **Surface (b), the rate limit options menu.** Title `What do you want to do?`. The stop option is `Stop and wait for limit to reset`, or `Stop` on usage based billing. Other options: `Wait here, then continue automatically at <time>`, `Continue now at lower priority`, a credits option and `Upgrade your plan`. A flag can put the credits and upgrade options first. So the planner finds the stop option by its text. Surface (b) was not seen on screen. Its text comes from the CLI code.
- **Credits option label.** The CLI builds it as `Switch to ${x}` or `Add funds to continue with ${x}`, where `x` is `usage credits`, or `usage` on usage based billing. `CREDITS_OPTION` (`src/server/services/domain/limit-surface.ts:9`) matches both labels, including `Switch to usage`. `limitChoice` (`:83`) also selects only a row that matches the stop or the wait pattern, and checks the chosen row against `CREDITS_OPTION` again.
- **Reset time in the pane:** a local clock time only (`at 10:40am`). The pane shows no date and no time zone.

Sources:

- Unit 1 captures of the limit surfaces on CLI 2.1.289.
- Unit 1 captures of the keys that the planner sent on the fake surfaces: surface (a), surface (b), surface (b) with the credits option first and surface (b) with the cursor on the credits option.
- Strings read from the CLI 2.1.290 binary: the limit surface texts.

### In the transcript

- At a limit the CLI writes a synthetic assistant message. Its fields are `model` `<synthetic>`, `isApiErrorMessage` true, `error` `rate_limit` and `apiErrorStatus` 429.
- The text has two forms. 5 hour limit: `You've hit your session limit · resets 5:40am (Asia/Calcutta)`. 7 day limit: `You've hit your weekly limit · resets Oct 6 at 8:30am (Asia/Calcutta)`.
- The transcript text gives the time zone. The weekly form also gives the date. So the transcript text is a better source for `limitedUntil` than the pane line.
- 22 such lines exist in the GROUP-13 and GROUP-14 transcripts (CLI 2.1.285 and 2.1.286), 11 of them in subagent transcripts.

Source: the synthetic limit lines found in the transcripts of two Dispatch sessions.

### In a hook event

- The CLI fires `StopFailure` in place of `Stop` when an API error ends the turn. For a usage limit the field `error` is `rate_limit`. The optional fields `error_details` and `last_assistant_message` can carry the text. The exact `error_details` text for a usage limit was not observed.
- The hook output and exit code are ignored. The default hook timeout is 120 s.
- Unit 1 registered `StopFailure` (`src/server/bootstrap/hook-setup.ts:424`). A `rate_limit` error sets the turn state `limit`. Any other error sets `idle` (`src/server/services/orchestration/session-turn.ts:28`).

Sources: the Unit 1 capture of a `StopFailure` hook event, and strings read from the CLI 2.1.290 binary for the limit texts.

## Point 4: Resume under the folder of another account

### Folder layout

- The CLI reads transcripts from `<config folder>/projects`.
- In each added account folder, `projects` is a symlink to `~/.claude/projects`. So all accounts read the same transcripts.
- The Claude Code docs say that each config folder "has its own settings, session history, and claude.ai login or API key". The shared `projects` link is a Dispatch choice. It is not the CLI default.
- `sessions` is on the Dispatch blocklist. It is not a conversation store. It holds one record per running CLI process (`pid`, `sessionId`, `cwd`, `status`) and a key file per process.
- Unit 1 resumed one conversation id on Default after a restart. The id stayed the same, and the CLI wrote no new transcript file (Unit 1 real session capture).
- Resume flags of CLI 2.1.290: `-r, --resume [value]` resumes by session id. `--fork-session` makes a new id. Dispatch does not use `--fork-session`.

Sources:

- The layout of an added account folder on this Mac, listed on 2026-10-06.
- Strings read from the CLI 2.1.290 binary: the transcript folder rule.
- The CLI 2.1.290 version and `--help` output.
- `src/server/services/orchestration/claude-accounts.ts:50` (blocklist).
- https://code.claude.com/docs/en/authentication, "Log in with multiple accounts".

### Resume of one conversation id under the second account folder

- 12:29Z: a session started on Default with the prompt `Reply with the word OK.` The reply was `OK`. Conversation id `3cd42fd4-9ee5-444a-98dc-9412358425fc`.
- 12:30Z: the Unit 1 move service moved the session to the second account. It stopped Claude at idle, set `CLAUDE_CONFIG_DIR` to the second account folder and typed the resume line with that id.
- The CLI showed the workspace trust dialog, because the second account folder did not trust the workspace yet. On CLI 2.1.291 the dialog is `Quick safety check: Is this a project you created or one you trust?` with the options `No, exit` (focused) and `Yes, I trust this folder`.
- Dispatch pressed Enter on the dialog, as `awaitReplReady` does for each trust dialog. Enter chose `No, exit` and the CLI exited after 7 seconds. The move still returned `moved`, and the server logged `claude did not reach READY`.
- The harness typed the same resume line again, moved the cursor to `Yes, I trust this folder` and pressed Enter. The CLI wrote the trust itself. The REPL showed the earlier prompt and reply.
- 12:33Z: the prompt `Reply with the word OK.` ran on the second account. The reply was `OK`. The status line showed the second account usage (5 hours 0%, 7 days 0%).
- The conversation id stayed `3cd42fd4-9ee5-444a-98dc-9412358425fc` through three moves (Default to second, second to Default, Default to second). The transcript folder held one transcript file, before and after. The shared `projects` link made it visible to both accounts.
- Result: a resume of one conversation id under the second account folder works. The id and the transcript file stay the same.
- Finding: on CLI 2.1.291 a blind Enter on the trust dialog exits the CLI. Dispatch seeds trust into each account folder that it owns before a launch, so the dialog does not show there. Only a folder that Dispatch must not write, or a failed trust seed, reaches the dialog.

Sources: the pane captures and the transcript folder of the real session, the sandbox account events and the card record, 2026-10-06.

## Point 5: Subagents

### A subagent at a usage limit

- The subagent stops at once. Its transcript gets the synthetic limit message (point 3).
- The parent gets a task notification with status `failed`. The summary is `Agent "<description>" failed: Agent terminated early due to an API error: You've hit your session limit · resets <time> (<zone>) (error type rate_limit, HTTP 429, request id ...)`. The weekly form was recorded on 2026-10-05.
- The parent and its subagents use one account. In one session the main thread hit the same limit 1.2 s after the notification.
- The subagent transcript stays on disk. After the reset, the parent sent a message to the same agent id. The agent continued with its earlier context and ran tools again (GROUP-14, agent `ac2bd5428500aa8ea`, from 05:11:56Z on 2026-10-02).
- Effect on Unit 2: the continue prompt `Continue.` goes to the main session only. The parent decides how to continue its failed subagents.

Sources: the subagent limit notifications and the synthetic limit lines found in the GROUP-13 and GROUP-14 transcripts.

### A subagent while the account changes

The same real session, on Default, 2026-10-06:

- 12:36:03Z: prompt `Use the Agent tool once to run a subagent that runs sleep 30 and replies OK. Then reply DONE.`
- The CLI started the subagent as a background agent. The main turn ended at 12:36:18Z with `Waiting for 1 background agent to finish`. Dispatch saw the turn state `idle`.
- 12:36:45Z: a move of the session to the second account returned `queued`. The subagent ran on Default and finished at 12:37:15Z. Its transcript is in the `subagents` folder of the conversation.
- About 12:37:44Z the pending move ran and typed `/exit`. The CLI did not exit. It showed `Background work is running` with the options `Exit and stop tasks` (focused), `Move to background and exit` and `Stay`. The subagent result was still waiting for the main thread.
- Dispatch pressed no key on that menu. The shell prompt did not come back within 15 seconds, so the move stopped before the relaunch. The session stayed on Default with the move pending, and the menu blocked the pane.
- 12:40:48Z: the harness pressed Escape (stay). The main thread got the subagent result, replied `DONE` and ended its turn at 12:41:41Z.
- 12:41:46Z: the pending move ran again at that turn end. `/exit` worked, and the session resumed on the second account with the same conversation id.
- An earlier try showed one more effect: a move at idle drops text that is typed in the input box but not sent, because `/exit` replaces it.

Results:

- A foreground subagent keeps the main turn busy. A move waits for the turn end, as for any busy turn.
- A background subagent can run after the main turn ends. A move at that turn end meets the CLI exit menu. Its focused option stops the background work. Dispatch sends Escape there (stay), so no work is lost and the pane is free again; the move stays pending and runs at the next turn end.
- A subagent keeps the account of its parent session at its start. A move never changes the account of a running subagent.

Sources: the pane captures, the timeline of the main transcript and the sandbox account events, 2026-10-06.

## Point 6: Terms for more than one account per person

### Result

No clause expressly allows or forbids one person using several Claude accounts. No clause expressly allows or forbids an automatic move of work between them.

### Clauses

- **Several accounts are a documented setup.** Claude Code docs, "Log in with multiple accounts" (https://code.claude.com/docs/en/authentication): "To stay signed in to multiple accounts at once, such as work and personal accounts, give each account its own configuration directory."
- **Consumer Terms, section 3** (https://www.anthropic.com/legal/consumer-terms, effective October 8, 2025). A reader can apply this clause against automatic moves: "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise." The terms also forbid sharing an account with another person. They have no clause about one person with several accounts.
- **Claude Code legal page** (https://code.claude.com/docs/en/legal-and-compliance): "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." The same page says: "Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens".
- **Usage Policy, "Do Not Abuse our Platform"** (https://www.anthropic.com/legal/aup, effective September 15, 2025). The clause on several accounts is qualified by "malicious": "Coordinate malicious activity across multiple accounts to avoid detection or circumvent product guardrails or generating identical or similar inputs that otherwise violate our Usage Policy".

Source: verbatim quotes from the pages above, fetched 2026-10-06 and checked against research done on 2026-10-05.

### Ruling

The result is not clear, so it went to the user as a decision (LOCAL-94 point 6). Ruling (Yash, 2026-10-05): build automatic moves as LOCAL-94 says. The automatic switch is off by default. The accounts page states: "Anthropic's terms do not address automatic moves between your own accounts. Automatic moves are off by default."
