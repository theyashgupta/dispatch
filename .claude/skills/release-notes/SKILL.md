---
author: yash
name: release-notes
description: Write and publish Dispatch release notes for a shipped milestone, in the house narrative style, with a mandatory screen-recorded demo GIF attached to the GitHub release. Also writes the changelog entry that the Dispatch site shows. Trigger when the user says "release notes", "write the release", "publish the release", "do the release", or at the publish step of a milestone ship ritual.
user-invocable: true
argument-hint: "<version, e.g. v3.2.0> [milestone name]"
allowed-tools: Bash, Read, Write, Skill, AskUserQuestion
---

# Release Notes

This file in the repository is the source of truth for Dispatch release notes. A user-level copy can exist at `~/.claude/skills/release-notes`. That copy is older. When the two differ, follow this file.

Write the release notes for one Dispatch version. Publish them as a GitHub release. Attach a screen-recorded demo GIF. Every release must have a recording. A text-only release is incomplete.

## Sources

Read these before you draft. Do not draft from memory.

1. `.planning/MILESTONES.md`, the entry for this version.
2. `.planning/milestones/<version>-MILESTONE-AUDIT.md`, for requirement coverage and named residuals.
3. `.planning/milestones/<version>-ROADMAP.md`, for the phase list and the "What shipped" summary.
4. Two or three previous release bodies for style: `gh release view v3.0.0 --json body -q .body`.

## Style contract

The house style is narrative prose, not a bullet changelog. Follow these rules:

1. Open with the user's problem, told as a short story. Do not open with a feature list. The narrative opener comes after the hidden title line and the summary sentence (see Changelog entry). Example openers: "A ticket used to mean a session." (v3.0.0).
2. Use `##` sections. Each section tells one part of the story: the main feature, what changed underneath, upgrade notes, known limits.
3. State limits and residuals plainly. Name what does not work. Do not round a partial result up to "done".
4. Include a `## See it` section with the demo GIF and a link to the higher-quality MP4 (see Recording below).
5. End with two lines: the full-changelog compare link (`https://github.com/theyashgupta/dispatch/compare/<prev>...<this>`), then the requirements footer: "Requires Node ≥ 22.22, tmux, ttyd, git, and the Claude Code CLI. Setup is in the README."
6. Apply the `asd-ste100` skill in STE-flavored mode to the draft. Invoke the skill. Do not approximate it.
7. Never use an em dash or a double hyphen. Use a single hyphen, a comma, or a new sentence.
8. Title format: `<tag> - <short name>`. Example: `v3.2.0 - Vault: environment keys inside Dispatch`.

## Changelog entry

The Dispatch site shows every published release in its changelog feed. Every release goes to the changelog.

1. The feed reads the release body.
2. Start the release body with this hidden title line, then one blank line: `[//]: # (Release title: vX.Y.Z - <short name>. This line is hidden when the release renders.)`
3. The title in the hidden line is the same as the release title.
4. After the blank line, write one summary paragraph of exactly one sentence.
5. The site shows this sentence in its feed. It states the user benefit of the release.
6. The summary has no link, no image and no markdown heading.
7. After the summary, write the narrative opener from the style contract, then the other `##` sections.
8. The title format stays `vX.Y.Z - <short name>`. Use a single hyphen with spaces. Do not put a parenthesis in the short name, because it breaks the hidden title line.
9. Publishing the release (draft to published) starts the `Changelog sync` workflow (`.github/workflows/changelog-sync.yml`). The workflow sends the `release-published` event to `theyashgupta/dispatch-site`. The site then redeploys.
10. After the publish, verify: `gh run list --workflow "Changelog sync" --limit 1`.
11. If the repository secret `SITE_DEPLOY_TOKEN` is empty, the job prints one line and skips. Tell the user to add the secret.

Body skeleton:

```
[//]: # (Release title: v3.2.0 - Vault: environment keys inside Dispatch. This line is hidden when the release renders.)

Keep environment keys in Dispatch, so no session needs a pasted secret.

A session used to start with a hunt for the right key.

## Vault

...

## See it

...

Full changelog: https://github.com/theyashgupta/dispatch/compare/v3.1.0...v3.2.0

Requires Node ≥ 22.22, tmux, ttyd, git, and the Claude Code CLI. Setup is in the README.
```

## Recording (mandatory)

Every release carries one screen-recorded flow of the headline feature, shown three ways: an inline player with narration, a short silent GIF preview, and the MP4 as a download.

1. Invoke the `record-flow` skill to record the flow in a real browser against a running app. For Dispatch, start the built tree with `/Users/yash/dispatch-workspaces/release-sandbox.sh start <worktree> <port above 48800> <label>` (stub claude, fresh HOME, no sources). Show the caption list to the user and get approval before recording.
2. Render twice from the same `raw.mp4`: the narrated take with `render.py <job>/video <slug>` and a silent take for the GIF with `render.py <job>/video <slug>-gif --silent --pace fast --no-zoom`.
3. Name the files `dispatch-<tag>-<slug>.mp4` (the narrated take) and `dispatch-<tag>-<slug>.gif`. Make the GIF with a two-pass palette and a 2 second end hold so the loop restarts cleanly: `ffmpeg -i <silent>.mp4 -vf "tpad=stop_mode=clone:stop_duration=2,fps=12,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 <out>.gif`.
4. Upload both as release assets: `gh release upload <tag> <files>` (works on a draft release too).
5. Inline player: GitHub renders a video player only for files dropped into its own markdown editor (`github.com/user-attachments/assets/<id>`), never for release assets. From the repository root, run `node .claude/skills/release-notes/gh-attach.js upload "https://github.com/theyashgupta/dispatch/releases/edit/<tag or untagged id>" <mp4> --save`. The script loads playwright from `~/.cache/record-flow/node_modules` by absolute path, so the working directory does not matter. It drives a signed-in Chromium profile (`~/.cache/record-flow/github-profile`) headlessly and prints `ATTACHMENT_URL=<url>`. If it reports "not signed in", run `node .claude/skills/release-notes/gh-attach.js login` once: a window opens, the user signs in, the script closes it.
6. The `## See it` section is, in order: the attachment URL on its own line (the inline player), the GIF as an image with a descriptive alt text, then "Higher-quality video with narration:" linking the MP4 asset by its download URL `https://github.com/theyashgupta/dispatch/releases/download/<tag>/<file>`.

## Process

0. One version per PR. Main takes squash merges, so a PR that bundles two milestones collapses them into one commit: the tags share a commit, the between-tags changelog compare is empty, and npm can never publish the earlier version. If a branch spans milestones, ship the earlier version's PR first, merge and tag it, then open the next. Write every release PR's description with the standard template from the `pr-description-standard` memory (Summary, Type of Change, What Changed, Why, Risk & Edge Cases, Testing, Reviewer Focus). Never write an ad hoc PR body.
1. Read the sources. Pick the one headline feature. The headline is what the recording shows.
2. Draft the notes to a scratch file. Apply the style contract and the changelog entry rules.
3. Show the full draft to the user. Wait for approval. Do not publish an unapproved draft.
4. Create the release as a DRAFT first: `gh release create <tag> --draft --target <full-sha> --title "<title>" --notes-file <draft>`. A draft creates no tag, so the body can be completed before anything is public. The target is the squash commit on main, or the bump branch tip when the release is cut behind main (see the release-split memory). Confirm with the user before this step anyway, because the publish that follows creates the tag.
5. Record the flow, render, upload the assets, run `gh-attach.js upload` for the inline player, fill the asset URLs into the notes, then publish: `gh release edit <tag> --notes-file <final> --draft=false --latest`. Verify with `gh release view <tag>` and `git fetch --tags`. Then verify the changelog sync (see Changelog entry).
6. npm ritual: the version bump lands via the release PR. Publishing is AUTOMATIC: `.github/workflows/publish.yml` runs on a pushed `v*` tag, and publishing the release creates that tag. After the publish, verify with `npm view @theyashgupta/dispatch version` (expect the new version within ~2 minutes) and check `gh run list --workflow Publish --limit 1`. ONLY if the workflow is missing or failed, publish manually with the vault token, never an interactive login: `NPM_CONFIG_USERCONFIG=$HOME/.claude/env-vault/publish.npmrc ~/.claude/scripts/with-env.sh npm publish`. The token is `NPM_TOKEN` in the env-vault (see the npm-publish-token memory). Only if the token is missing or rejected, ask the user to run `! npm login` and flag the token for regeneration. The version-bump commit must reach main signed. If the YubiKey is not connected, commit locally unsigned and flag the commit for re-sign at the next `/ship`.

## Boundaries

- Do not publish a release body the user did not approve.
- Do not skip the recording. If recording is impossible now, publish only with the user's explicit consent, and record the gap as a follow-up task.
- Do not run `git push`. Only `/ship` pushes.
- Do not invent facts absent from the source documents.
