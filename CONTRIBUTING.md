# Contributing to Dispatch

Dispatch is young and shaped by one person's daily use. Contributions are welcome — especially Linux
support, other ticket sources, and other agent CLIs. This doc is how to work on it without surprises.

By contributing you agree to the [Code of Conduct](CODE_OF_CONDUCT.md) and that your work ships under
the [MIT License](LICENSE).

## Ways to help

- **File a bug.** Use the bug report form. A reliable repro is worth more than anything else.
- **Suggest a feature.** Use the feature form, or float it in [Discussions](https://github.com/theyashgupta/dispatch/discussions) first if it's open-ended.
- **Send a PR.** Small and focused merges fastest. For anything large, open an issue first so we agree on the shape before you build it.
- **Add tests.** Dispatch has no test suite yet and wants one. Unit and end-to-end tests are wide-open, welcome contributions — pick any module and start.

## Dev setup

Prerequisites and config are in the [README](README.md#getting-started): Node ≥ 22.22, `tmux`, `ttyd`,
`git`, and the `claude` CLI logged in. Then:

```bash
git clone https://github.com/theyashgupta/dispatch.git
cd dispatch
npm install
npm run dev
```

First run writes a config template to `~/.dispatch/config.json` and exits — fill it in, then `npm run dev`
again. Dispatch is localhost only: everything binds to `127.0.0.1` and there is no auth layer. Don't
develop against a network-exposed instance.

## The check gate

Everything is gated by one command:

```bash
npm run check
```

It runs, in order:

| Step        | Command                                 | What it enforces                                                       |
| ----------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Format      | `prettier --check .`                    | Consistent formatting (`npm run format` to fix)                        |
| Lint        | `eslint .`                              | Style + module-boundary rules (`npm run lint:fix` to autofix)          |
| Types       | `tsc --noEmit`                          | Strict TypeScript, no `any` escapes                                    |
| Dead code   | `knip`                                  | No unused exports, deps, or files                                      |
| Replay gate | `tsx scripts/replay-watcher.ts --check` | The pane watcher's decisions are byte-identical to the recorded golden |

CI runs the same command on every PR. A green `npm run check` locally means a green CI run.

## How we verify today

Dispatch doesn't have a test suite yet. The focus so far has been getting the core to production
quality, so tests haven't been written — but they're wanted, and adding them is one of the most useful
contributions you can make. Until that suite exists, behavior is held in place by:

- **The replay gate** — 16 recorded watcher fixtures (`scripts/replay-fixtures/`) diffed byte-for-byte
  against their golden decisions. This is what catches a silent watcher regression.
- **The invariant checker** — 81 documented cross-module invariants (`scripts/check-invariants.mjs`),
  each with a durable home in a JSDoc block or `docs/ARCHITECTURE.md`, machine-verified.
- **Strict TypeScript and lint**, gated above.
- **The running app** — the pieces that matter (tmux, ttyd, real Claude sessions) are exercised by
  actually running Dispatch.

So today a PR proves itself two ways: `npm run check` is green, **and** you've run the change against
the live app and can describe what you saw. The PR template asks for both.

**Adding tests?** Even better. There's no runner wired up yet, so a test PR can bring its own — pick a
framework that fits (Vitest pairs naturally with this Vite/TypeScript stack), add the dev dependency and
an `npm test` script, and note how to run it in the PR. Start with whatever module you know best; small
focused test PRs are easier to review than a sweeping one.

### If you change watcher decision logic

The replay gate will fail, because you changed a decision it froze. When the new behavior is what you
intend, re-record the golden and commit it:

```bash
tsx scripts/replay-watcher.ts --record
```

Review the golden diff before committing — it _is_ your change's behavioral footprint. If the diff
surprises you, that's a bug, not a re-record.

### If you add or change an invariant

Give it a durable home: a JSDoc block in `src/**` or a line in `docs/ARCHITECTURE.md`. A bare `//` body
comment doesn't count. Then `npm run check` (the replay gate step won't complain, but the invariant
audit will if an ID is homeless).

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), lowercase, imperative, no trailing period:

```
feat: add github issues poller
fix: keep card in place when a manual drag races a DONE marker
docs: clarify ttyd install on linux
```

Types: `feat`, `fix`, `refactor`, `test`, `chore`, `perf`, `docs`, `ci`, `style`, `build`. Keep the
subject under 72 characters; put the why in a body paragraph if it needs one.

## Opening a PR

1. Branch off `main`.
2. Make the change; keep it focused.
3. `npm run check` until green.
4. Run it against the live app and note what you verified.
5. Open the PR and fill in the template. Link the issue it closes.

CI must pass before merge. Review is by the maintainer; expect questions, especially on anything that
touches the watcher, the mutation queue, or the localhost security boundary.

## Code style

The conventions that matter are written down in [`docs/standards/`](docs/standards/): backend design,
the frontend design system, folder structure, and how we comment. Match the surrounding code, and skim
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing anything structural.

## Scope

Dispatch is one user, one machine, localhost only — that's the design, not a limitation to fix. PRs that
turn it into a multi-user or hosted service are out of scope. Everything else is fair game.
