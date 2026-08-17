# Frontend Design System

A "primitives + tokens" design system — not a theming framework, not a component-doc site. The goal is to kill the style-object and JSX duplication in the board UI (most visible in `DetailPanel.tsx`) by extracting a small set of presentational primitives, while keeping the existing styling approach unchanged.

`design-contract.md` is the source of visual direction for the current milestone; the primitives documented here render against the type scale, spacing rhythm, radius, color, elevation, and motion values it fixes. The focus-versus-selection rule it authors is recorded below.

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

## Focus versus selection — DECISIVE

**a keyboard focus ring must never look identical to selection.**

What this means in this codebase: focus is expressed as `outline: 2px solid var(--accent)` with `outline-offset: 2px`, defined once in `src/web/primitives/focus-ring.ts` and consumed everywhere by spreading its return value onto a style object. Selection and needs-attention are expressed separately, as a border plus a 1px ring on the card itself. The failure mode this rule prevents: writing the focus ring as an accent box-shadow ring makes it structurally identical to the selection ring, indistinguishable to a keyboard user — exactly what shipped before this rule was written.

Where an `overflow: hidden` ancestor clips the outline, drop the offset to 0 at that site. Never revert to an accent box-shadow ring to work around clipping.

The accent's job, quoted verbatim from `design-contract.md`'s `## Color roles` accent row: "interactive/selected-state signal only: active view toggle, active inbox badge, drag-target highlight, needs-attention card border, resize-handle hover, active search result row." `docs/standards/design-contract.md` is the source of that job list and wins on any conflict with this file.

Inter is named first in `--font-ui` but is not loaded as a webfont — there is no `@font-face`, no webfont link, and no bundled font file, so the app renders in the OS system font on every real machine. This is a deliberate decline for the current milestone, not an oversight: loading Inter would add bundle weight and FOUT/FOIT risk on the mobile tunnel path for no hierarchy gain, and hierarchy is what this milestone buys. Revisit only if a future milestone wants a genuinely different typographic voice.

## Component architecture — hooks-first

The app is already hooks-first: `useBoardStream`, `useUnseenActivity`, and `useTransitionNotifications` own data and effects; components render. Keep it that way — do **not** impose a container/presentational split (a dated post-Hooks pattern its own popularizer walked back). Keep data and effects in hooks, UI and local state in components, and keep the new primitives purely presentational: props in, no data fetching.

## Depth

Medium depth. Build the five primitives and the typed style-object module; do **not** build a variant/theme engine, a Storybook, or a component-doc site — all over-engineering for a young, one-user tool. Each primitive lands as a pure refactor, smoke-gated on sync → start → terminal → markers → cleanup, with pixel-identical rendering at every adopted call site.

## Component anatomy

A checklist for what's inside a component file, not where the file lives — `folder-structure.md` is the file/folder-naming source of truth and isn't restated here. Derived by grep from the settled post-restructure tree (barrels, `AppShell`, compound `Modal`, and the two compound-section conversions), not invented.

- [ ] **Props types** — every component with props declares a named type immediately above the function: `interface ModalProps { ... }` (`primitives/Modal.tsx`), `interface StartModalProps { ... }` (`features/modals/StartModal.tsx`). Slot content is typed `ReactNode` (`ModalProps.children`; `AppShell`'s `header`/`content`/`detail`/`children`). Optional props are marked with `?` (`ModalProps.controlRef?`; `AppShell`'s `children?`). No `any` in a props type anywhere in the tree. Plain props over Context: `createContext`/`useContext` appear nowhere in `src/web` — `AppShell.tsx` is the load-bearing example, a shell wrapper with zero Context and no SSE-derived state in its props (verified live in the 55-02 PANEL-03 proof).
- [ ] **Hook ordering** — within a component body: data/subscription hooks first, then local `useState`, then any owned custom hooks, then derived values, then effects, then event handlers, then early returns and JSX. `App.tsx` is the clearest instance: `useActivityFeed()` / `useBoardStream()` (data/subscription) → the `useState` block → `useEffect`s interleaved with the derived values they read → handlers (`requestStart`) → three early returns → the `AppShell` composition. `StartModal.tsx` follows the same shape one level down: refs and `useState` first, then its own `useWorkspacePicker`/`usePlaybookPicker` calls, then destructured derived values (`checkedCount`, `startDisabled`), then `handleStart`.
- [ ] **Handler naming** — two distinct forms, confirmed by grep across `src/web`:
  - Props (a function a component receives from its parent): `on<Noun><Verb?>` — `onClose`, `onCleanupRequest`, `onSelectCard`, `onEditPlaybooks`, `onOpenSettings`.
  - Internals (a function a component defines and calls itself): `handle<Verb>` — `handleStart` (`StartModal.tsx`), `handleSave` (`SettingsScreen.tsx`'s `useFiltersTab`), `handleDelete` (`SettingsScreen.tsx`'s `PlaybookDeleteConfirm`), `handleDragEnd` / `handleSelectCard` (`Board.tsx`).
- [ ] **Naming conventions** (component-internal only — file/folder naming stays in `folder-structure.md`):
  - Compound statics: a component that owns fixed structural slots attaches its section components as dot-notation statics assigned right after the function — `Modal.Header = ModalHeader`, `Modal.Body = ModalBody`, `Modal.Actions = ModalActions` (`primitives/Modal.tsx`); `StartModal.WorkspacePicker = WorkspacePickerSection`, `StartModal.PlaybookPicker = PlaybookPickerSection` (`features/modals/StartModal.tsx`); `SettingsScreen.FiltersTab = FiltersTabSection`, `SettingsScreen.PlaybooksTab = PlaybooksTabSection` (`features/settings/SettingsScreen.tsx`). The pattern shipped on all three eligible consumers this phase — the FE-05 and FE-06 spikes both resolved `SEPARABLE` — so it is not a `Modal`-only pattern; any component with two or more owned content clusters may adopt it.
  - Section/hook pairing: a compound section's data and behavior live in a same-named `use<Section>` hook, invoked once by the owning component and passed down as a single named prop — `useWorkspacePicker` feeds `StartModal.WorkspacePicker`, `usePlaybookPicker` feeds `StartModal.PlaybookPicker`, `useFiltersTab` feeds `SettingsScreen.FiltersTab`, `usePlaybooksTab` feeds `SettingsScreen.PlaybooksTab`.
  - Derived-value naming: a value computed from state/props for render (not itself state) is named for what it is, not how it's computed — `checkedCount`, `startDisabled`, `selectedCard`, `cardIdentifiers` — never a `get`/`compute` prefix.
