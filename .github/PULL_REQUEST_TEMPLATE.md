<!-- Thanks for contributing to Dispatch. Keep this short and honest. -->

## What & why

<!-- What does this change, and what problem does it solve? Link the issue: Closes #123 -->

## How I verified

<!--
Dispatch doesn't have a test suite yet — for now, behavior is pinned by the check gate and proven
against the running app, so tell us how you know this works. Adding tests is welcome; if this PR does,
say how to run them. Delete lines that don't apply.
-->

- [ ] `npm run check` passes locally (format, lint, typecheck, deadcode, replay-gate)
- [ ] I ran the change against the live app (`npm run dev`) and confirmed the behavior:

<!-- e.g. "dragged a ticket to In Progress, watched the session provision, card moved on DONE marker" -->

- [ ] If I changed watcher decision logic, I re-recorded the replay fixtures (`tsx scripts/replay-watcher.ts --record`) and the diff is intentional.
- [ ] If I added or changed a cross-module invariant, it has a durable home (JSDoc in `src/**` or `docs/ARCHITECTURE.md`) and `npm run check` still passes.
- [ ] I enabled **Allow edits from maintainers** so small fixups don't need a round-trip.

## Screenshots / recording

<!-- For any UI change, show before → after. A short clip of the board behavior is even better. Delete this section if the change isn't visual. -->

## Notes for the reviewer

<!-- Anything you're unsure about, tradeoffs you made, or areas that need a closer look. -->
