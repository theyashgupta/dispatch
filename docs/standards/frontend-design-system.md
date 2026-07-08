# Frontend Design System

A "primitives + tokens" design system — not a theming framework, not a component-doc site. The goal is to kill the style-object and JSX duplication in the board UI (most visible in `DetailPanel.tsx`) by extracting a small set of presentational primitives, while keeping the existing styling approach unchanged.

## The problem

The frontend has massive style-object and JSX duplication: the secondary-button shape is re-inlined at many call sites, the "warning block" pattern (icon + label + muted body) is copy-pasted across Status / Start warning / Cleanup / stderr / Session-lost, and modal scaffolding is duplicated across `StartModal` and `CleanupModal`. That duplication is the extraction target.

## The five primitives (`src/web/primitives/`)

| Primitive    | Replaces today                                                                                       | Notes                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`     | The `secondaryButtonStyle` object and its inline copies (Retry, Reconnect, Restart, VS Code, Cursor) | One `variant` prop (`secondary` is the only current variant); owns the hover-lift logic currently repeated across `onMouseEnter`/`onMouseLeave`.       |
| `IconButton` | The 28px X / fullscreen icon buttons                                                                 | Icon-only affordance sharing `Button`'s hover behavior.                                                                                                |
| `Notice`     | The warning-block pattern: Status, Start warning, Cleanup, provisioning-error, Session-lost          | Props: `tone: "muted" \| "destructive"`, `label`, `icon?`, `children`, optional action slot. Collapses ~150 lines of `DetailPanel` into ~5 call sites. |
| `Modal`      | `StartModal` and `CleanupModal` scaffolding                                                          | Owns the scrim, Esc handling, and heading semantics (fixes a known v1.1 residual).                                                                     |
| `Field`      | The repeated `<span>` label + body pairs                                                             | Small, high-frequency label/value building block.                                                                                                      |

## Styling approach — DECISIVE

**Keep inline styles + `tokens.css`, and extract the repeated style objects into typed `CSSProperties` constants colocated in the primitives.** `tokens.css` survives unchanged as the single source of design tokens. Because the extracted style objects are byte-identical to today's inline ones, the refactor is diff-free at the pixel level.

**No new styling technology.** No CSS Modules, no vanilla-extract, no Tailwind, no styled-components. These are out of scope for v1.2:

- **vanilla-extract** — new build-time dependency and a new paradigm; violates "no new heavy deps" and "zero behavior change." Reject.
- **CSS Modules** — not a dependency (Vite supports it natively), but migrating the entire inline-styled surface is a large, churny paradigm switch that risks visual diffs. Defer (a viable future option, not now).
- **Keep everything inline as-is** — rejected, because duplication is the stated problem.

## Component architecture — hooks-first

The app is already hooks-first: `useBoardStream`, `useUnseenActivity`, and `useTransitionNotifications` own data and effects; components render. Keep it that way — do **not** impose a container/presentational split (a dated post-Hooks pattern its own popularizer walked back). Keep data and effects in hooks, UI and local state in components, and keep the new primitives purely presentational: props in, no data fetching.

## Depth

Medium depth. Build the five primitives and the typed style-object module; do **not** build a variant/theme engine, a Storybook, or a component-doc site — all over-engineering for a one-user tool with no test code. Each primitive lands as a pure refactor, smoke-gated on sync → start → terminal → markers → cleanup, with pixel-identical rendering at every adopted call site.
