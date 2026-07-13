# Contributing to Dispatch

Dispatch is young and shaped by one person's daily use. Contributions are welcome, especially Linux
support, other ticket sources, and other agent CLIs. This doc is how to work on it without surprises.

By contributing you agree to the [Code of Conduct](CODE_OF_CONDUCT.md), and that your work ships under
the [MIT License](LICENSE).

## Ways to help

- **File a bug.** Use the bug report form. A reliable repro is worth more than anything else.
- **Suggest a feature.** Use the feature form, or float it in [Discussions](https://github.com/theyashgupta/dispatch/discussions) first if it's open-ended.
- **Send a PR.** Small and focused merges fastest. For anything large, open an issue first so we agree on the shape before you build it.
- **Add tests.** Dispatch has no test suite yet and wants one. Unit and end-to-end tests are wide-open, welcome contributions. Pick any module and start.
- **Improve docs or triage.** Fixing a typo, clarifying the README, or reproducing an open bug all count. You don't have to write code to help.

## Finding something to work on

New here? Start with an issue that's already scoped for newcomers:

- [**Good first issues**](https://github.com/theyashgupta/dispatch/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22): small, self-contained, no deep codebase context needed.
- [**Help wanted**](https://github.com/theyashgupta/dispatch/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22): anything where an extra pair of hands is welcome.
- [**By area**](https://github.com/theyashgupta/dispatch/labels?q=area): browse the `area:*` labels (`area:linear`, `area:tmux`, `area:board`, `area:ui`, `area:worktree`) to find a subsystem you want to live in.

You don't need to ask for permission to start. Comment on the issue so others know it's taken, then open
a PR. For anything large or structural, open an issue first so we agree on the shape before you build it.

## Dev setup

Prerequisites and config are in the [README](README.md#getting-started): Node ≥ 22.22, `tmux`, `ttyd`,
`git`, and the `claude` CLI logged in. Then:

```bash
git clone https://github.com/theyashgupta/dispatch.git
cd dispatch
npm install
npm run dev
```

The first run lands on an in-browser setup screen: paste your Linear key there and confirm the prereq
checklist — no config file to hand-edit, no restart. Dispatch is localhost only: everything binds to
`127.0.0.1` and there is no auth layer. Don't develop against a network-exposed instance.

## The check gate

Everything is gated by one command:

```bash
npm run check
```

It runs, in order:

| Step        | Command                                 | What it enforces                                                 |
| ----------- | --------------------------------------- | ---------------------------------------------------------------- |
| Format      | `prettier --check .`                    | Consistent formatting (`npm run format` to fix)                  |
| Lint        | `eslint .`                              | Style and module-boundary rules (`npm run lint:fix`)             |
| Types       | `tsc --noEmit`                          | Strict TypeScript, no `any` escapes                              |
| Dead code   | `knip`                                  | No unused exports, deps, or files                                |
| Replay gate | `tsx scripts/replay-watcher.ts --check` | Watcher decisions still match the recorded golden, byte for byte |

CI runs the same command on every PR. A green `npm run check` locally means a green CI run.

## How we verify today

Dispatch doesn't have a test suite yet. The focus so far has been getting the core to production quality,
so tests haven't been written. They're wanted, though, and adding them is one of the most useful things
you can contribute. Until that suite exists, behavior is held in place by:

- **The replay gate.** 16 recorded watcher fixtures (`scripts/replay-fixtures/`) diffed byte for byte
  against their golden decisions. This is what catches a silent watcher regression.
- **The invariant checker.** 81 documented cross-module invariants (`scripts/check-invariants.mjs`),
  each with a durable home in a JSDoc block or `docs/ARCHITECTURE.md`, machine-verified.
- **Strict TypeScript and lint**, gated above.
- **The running app.** The pieces that matter (tmux, ttyd, real Claude sessions) get exercised by
  actually running Dispatch.

So today a PR proves itself two ways: `npm run check` is green, and you've run the change against the
live app and can describe what you saw. The PR template asks for both.

**Adding tests?** Even better. There's no runner wired up yet, so a test PR can bring its own. Pick a
framework that fits (Vitest pairs naturally with this Vite and TypeScript stack), add the dev dependency
and an `npm test` script, and note how to run it in the PR. Start with whatever module you know best.
A small focused test PR is easier to review than a sweeping one.

### If you change watcher decision logic

The replay gate will fail, because you changed a decision it froze. When the new behavior is what you
intend, re-record the golden and commit it:

```bash
tsx scripts/replay-watcher.ts --record
```

Review the golden diff before committing. It _is_ your change's behavioral footprint. If the diff
surprises you, that's a bug, not a re-record.

### If you add or change an invariant

Give it a durable home: a JSDoc block in `src/**` or a line in `docs/ARCHITECTURE.md`. A bare `//` body
comment doesn't count. Then run `npm run check`. The replay gate step won't complain, but the invariant
audit will if an ID is homeless.

## Releasing

Maintainer-only. Dispatch ships to npm as the public scoped package `@theyashgupta/dispatch`; a version
tag triggers the publish.

**One-time setup.** Create an npm **Automation** token (bypasses 2FA for CI, publish-only, revocable) and
add it as the repo secret `NPM_TOKEN`. The scope publishes public via `publishConfig.access:public` in
`package.json` plus `--access public` on the command — both are set, so nothing lands as restricted. The
first publish claims the public scope for the name.

**Per release.**

1. Verify before tagging (local): `npm run check` green, then `npm run build && npm pack --dry-run`. The
   tarball must be `dist/**` + `README.md` + `LICENSE` + `package.json` and nothing from `src/`,
   `.planning/`, or `docs/`. Optionally clean-room smoke it: `npm i <tgz> --omit=dev` in a temp dir and run
   `dispatch --version`.
2. Bump `version` in `package.json`, commit.
3. `git tag vX.Y.Z`, then `git push --tags` (maintainer does this — YubiKey).
4. The [`publish.yml`](.github/workflows/publish.yml) workflow fires on the `v*` tag, runs `npm ci`,
   `npm run build`, and `npm publish --access public` with `NODE_AUTH_TOKEN` from `NPM_TOKEN`. Pushing to
   `main` or creating the tag file alone does not publish — only a pushed tag does.

The milestone number equals the public release tag. Release notes and the demo recording happen at
publish time as part of the maintainer's release-notes ritual — out of scope for a normal PR.

npm provenance (`--provenance` with `id-token: write`) is available as an opt-in for extra supply-chain
trust; it's kept off by default to stay on the locked publish steps.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), lowercase, imperative, no trailing period:

```
feat: add github issues poller
fix: keep card in place when a manual drag races a DONE marker
docs: clarify ttyd install on linux
```

Types: `feat`, `fix`, `refactor`, `test`, `chore`, `perf`, `docs`, `ci`, `style`, `build`. Keep the
subject under 72 characters, and put the why in a body paragraph if it needs one.

## Opening a PR

1. Branch off `main`.
2. Make the change; keep it focused.
3. Run `npm run check` until it's green.
4. Run it against the live app and note what you verified.
5. Open the PR and fill in the template. Link the issue it closes.

CI must pass before merge. Review is by the maintainer, so expect questions, especially on anything that
touches the watcher, the mutation queue, or the localhost security boundary.

## AI-assisted contributions

Dispatch is built with agents, so using one to help write a PR is completely fine. That's the whole
point of the tool. Two conditions. You understand and stand behind every line you submit, as if you'd
typed it yourself. And the PR is _yours_, not an autonomous agent's dropped over the wall. PRs that are
clearly unreviewed agent output (wrong-shaped changes, invented APIs, `npm run check` never run) get
closed without much ceremony. Bring judgment, not just generation.

## Code style

The conventions that matter are written down in [`docs/standards/`](docs/standards/): backend design,
the frontend design system, folder structure, and how we comment. Match the surrounding code, and skim
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing anything structural.

## Scope

Dispatch is one user, one machine, localhost only. That's the design, not a limitation to fix. PRs that
turn it into a multi-user or hosted service are out of scope. Changes to the core Linear, tmux, and
worktree integration model should be discussed in an issue first. Everything else is fair game.
