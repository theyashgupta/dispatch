<div align="center">

<img src="docs/assets/hero-banner.png" width="720" alt="Dispatch">

**Drag a ticket. Dispatch an agent.**

A local kanban board that turns your Linear tickets into live Claude Code sessions:
each in its own git worktree, each with a real terminal in your browser.

[![CI](https://github.com/theyashgupta/dispatch/actions/workflows/ci.yml/badge.svg)](https://github.com/theyashgupta/dispatch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.22-brightgreen)](https://nodejs.org)
[![Made with tmux + ttyd](https://img.shields.io/badge/made%20with-tmux%20%2B%20ttyd-1f2937)](https://github.com/tsl0922/ttyd)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

![Dispatch demo: drag a ticket, pick its workspace, and a live Claude Code session plans then implements in the same conversation](docs/assets/hero.gif)

</div>

---

Dispatch puts a board in front of your agents. Tickets assigned to you in Linear appear in **To Do** on their own. Dragging one to **In Progress** cuts a worktree per repo, starts a plain `claude` REPL in tmux, and hands it the ticket. The board tells you which sessions actually need you, and clicking a card gives you the real terminal, not a chat transcript.

One user, one machine, localhost only. That's the design, not a limitation we're working around.

## What it does

- **Linear in, no writes back.** A poller pulls issues assigned to you in unstarted states. Descriptions render as proper markdown in the detail panel.
- **One drag = one agent.** To Do → In Progress cuts a worktree for each configured repo, starts `claude` in tmux, and sends a kickoff prompt built from the ticket (plus anything extra you type in the start modal).
- **Real terminals in the browser.** Each session gets its own [ttyd](https://github.com/tsl0922/ttyd) instance bound to loopback. What you see is the actual REPL: type into it, go fullscreen, or pop the workspace open in your editor.
- **Attention routing.** A watcher scans tmux panes every 2 seconds for status markers the agent prints. `NEEDS_INPUT` moves the card to Needs Input and shows the reason right on it; `DONE` moves it to Agent Done. Reply in the terminal and the card flips back on its own.
- **In Review keeps everything alive.** A finished ticket can sit in In Review with its session, terminal, and worktree intact. Prompt the agent with follow-ups whenever you like. Nothing is torn down until _you_ drop the card on Done.
- **Sessions survive restarts.** tmux is the source of truth, so the backend can restart (or your laptop can reboot) and the board reconciles. If a session died but the worktree survived, In Review offers **Resume**: `claude --continue` in the same worktree, same conversation, no kickoff re-sent.
- **Done means cleanup.** Dropping a card on Done confirms, kills the session and terminal, and removes the worktrees. Branches are always kept; they're the whole point.

<div align="center">

![Session lost? Resume continues the same conversation in the same worktree](docs/assets/resume.png)

</div>

## How it works

```
Linear ──poll──▶ board store (board.json) ──SSE──▶ React board
                      │                              │
                      │                        drag to In Progress
                      ▼                              ▼
              2s pane watcher ◀──── tmux session (claude REPL)
              DISPATCH_STATUS markers    │
                                         ├── git worktree per repo
                                         └── ttyd ──▶ <iframe> terminal
```

The kickoff prompt asks the agent to print standalone status lines:

```
DISPATCH_STATUS: NEEDS_INPUT — should the status line use plain text or a flash animation?
DISPATCH_STATUS: DONE — built the board UI, committed on branch YAS-22
```

The watcher parses those from the visible pane (it survives TUI repaints, recap overlays, and prompt echoes), applies one atomic board mutation per tick, and a manual drag always wins over a marker.

The board itself is seven columns:

| Column          | Meaning                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| **To Do**       | Synced from Linear, ordered by priority                                    |
| **In Planning** | Agent drafts a plan first; hands off to In Progress once the plan is ready |
| **In Progress** | Agent working; card shows provisioning steps and errors                    |
| **Needs Input** | Agent asked something; the reason is on the card                           |
| **Agent Done**  | Agent finished and said so                                                 |
| **In Review**   | Holding state: session/terminal/worktree stay fully alive                  |
| **Done**        | Deliberate human action: confirm → cleanup, branches kept                  |

## Getting started

You need macOS or Linux with:

- **Node ≥ 22.22**
- **tmux** and **ttyd** (`brew install tmux ttyd`)
- **git**, and the **[Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI** (`claude`) logged in
- A **Linear** account and a [personal API key](https://linear.app/settings/api)

Dispatch checks all four binaries at startup and tells you exactly what's missing.

```bash
npx @theyashgupta/dispatch      # or: npm i -g @theyashgupta/dispatch && dispatch
```

It picks a free port, prints the URL, and opens your browser. The first run lands on a setup screen: paste your Linear key and confirm the prereq checklist. The board starts syncing — no config file to edit, no restart.

`dispatch doctor` reports which binaries are present or missing. Use `dispatch --port <n>`, `--no-open`, `--help`, or `--version` as needed.

Tickets assigned to you show up within a minute. Worktrees land in `workspaceRoot/<ticket>/<repo>/` on a branch named after the ticket. If a ticket touches more than one of your repos, the agent decides which ones to work in. There's no repo picker.

Running from source instead? `git clone`, `npm install`, `npm run dev` — see [CONTRIBUTING.md](CONTRIBUTING.md#dev-setup).

## Learn more

Architecture — including the invariants that let the pane watcher survive Claude's TUI chrome — is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The engineering standards are in [docs/standards/](docs/standards/).

## Status

Dispatch is young and shaped by one person's daily use. It works well for that person. Issues and PRs are welcome, especially around Linux support, other ticket sources, and other agent CLIs.

## Roadmap

What's planned and why lives in the issue tracker. See the [`roadmap` label](https://github.com/theyashgupta/dispatch/issues?q=label%3Aroadmap).

## Contributing

New contributors: the [good first issues](https://github.com/theyashgupta/dispatch/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are the place to start. Bugs and features go through the [issue forms](https://github.com/theyashgupta/dispatch/issues/new/choose); open-ended questions and ideas live in [Discussions](https://github.com/theyashgupta/dispatch/discussions). Before sending a PR, read [CONTRIBUTING.md](CONTRIBUTING.md). It covers dev setup, the `npm run check` gate, and how behavior is verified while a proper test suite is still being built out (test contributions welcome). Security issues go through [private reporting](SECURITY.md), never a public issue. Everyone participating agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © Yash Gupta
