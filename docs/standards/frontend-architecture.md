# Frontend Architecture Standard (v2)

## Status and scope

This standard governs all frontend code in `src/web/`. It started on 2026-09-30 for new code. Since 2026-10-07 (LOCAL-77) it governs the whole web tree. It supersedes the sections of `design-contract.md`, `folder-structure.md` and `code-review-rules.md` that the "Supersede records index" names. It also holds the one surviving rule of `frontend-design-system.md`, in the section "Focus versus selection".

The module pattern, from the initiative brief:

> `src/web/routes/` owns URLs and loaders; `src/web/modules/<feature>/{views,containers,components,hooks,domain,queries}` owns one feature each; `src/web/components/ui/` holds shadcn; `src/web/lib/` holds configured clients; modules never import sibling modules.

The web tree has these parts:

- `src/web/routes/`
- `src/web/modules/`
- `src/web/components/ui/`, short form `components/ui`, with the app-wide hooks in `src/web/components/ui/hooks/`
- `src/web/components/`
- `src/web/queries/`
- `src/web/lib/`
- `src/web/styles/`
- `components.json` and the `@/` import alias for `src/web/`
- the web root entry files (`main.tsx`, `viewer-main.tsx`, `gallery-main.tsx` and `terminal-main.ts`) and the HTML entries
- `src/web/viewer/`, which keeps one dated lint exception (U4-13)

One lint scope, one dependency rule set and one agent hook rule set cover the web tree.

Records, 2026-10-07 (LOCAL-77):

- The legacy tree is deleted: the legacy feature, primitive and hook folders, the legacy helpers and barrels in `src/web/lib/`, and the root component. The section "Legacy tree during transition" is removed, because its rules applied only to the legacy tree.
- This section no longer marks paths as new and no longer lists a legacy tree.
- "Providers" no longer allows the transitional app state context (R-15). The app store replaces it (U4-06).
- Route file names follow a lint pattern instead of the R-14 exemption (U4-14). The `useX.ts` hook file rule is removed.

## Layer definitions

A module is one folder `src/web/modules/<feature>/`. A module has six layer folders. A route file is a seventh layer outside the module. The app shell is the root route `src/web/routes/__root.tsx`. The root route is exempt from the Route rules below. It renders the shell view with the `Outlet` and module views in its slots. `main.tsx` renders the providers (see "Providers"). The module `index.ts` is the barrel, not a layer. A test file belongs to the layer of its subject.

- **Route.** A file under `src/web/routes/`.
  - Use it when: a URL needs an owner. The route owns the URL, the params and `validateSearch` with zod. Its loader calls `queryOptions` from a module barrel or from `src/web/queries/`. It renders exactly one view, or one shared layout component that gets module views as children.
  - Never: put business logic, JSX layout or a data transform in a route file, or import TanStack Query in it except as a type.
- **View.** The page component in `modules/<feature>/views/`.
  - Use it when: a route needs a page. The view composes containers and layout. It can set layout classes, such as flex, grid, gap and padding.
  - Never: import TanStack Query or call a query hook in a view.
- **Container.** A component in `modules/<feature>/containers/`.
  - Use it when: one region of a view needs data or behaviour. The container gets data through the module's query hooks or a shared query in `src/web/queries/`, for example the board snapshot. It owns mutations, selection state and editing state. It gives plain props to its child components. It is the only layer that calls a query hook, and it uses TanStack Query only through query hooks. A query hook is a wrapper that a `queries/` folder exports. Query files call TanStack `useQuery`, `useSuspenseQuery` and `useMutation` inside those wrappers. When one region fills the whole page, the view still renders that region as one container. A container-family hook file `use-<name>.ts` that composes query and mutation hooks for its module's containers may sit in `containers/`.
  - Never: render a host element that has a `className` in a container. A bare wrapper element without a `className` is allowed. A container renders components and `components/ui` primitives.
- **Component.** A component in `modules/<feature>/components/`.
  - Use it when: UI code takes props and returns JSX. A component composes `components/ui` primitives. It can hold local UI state, such as hover, open or pressed. It can call third-party UI hooks, such as the dnd-kit hooks.
  - Never: import TanStack Query, TanStack Router or the HTTP client in a component, or call `fetch` in it.
- **Hook.** A hook in `modules/<feature>/hooks/`.
  - Use it when: module logic is reusable and is not a query. Examples are drag reorder, module keyboard shortcuts and imperative DOM helpers, such as a move animation or a focus helper.
  - Never: import TanStack Query in a `hooks/` file. A wrapper of `useQuery` or `useMutation` goes in a `queries/` folder.
- **Domain utility.** A file in `modules/<feature>/domain/`.
  - Use it when: code is a pure function, a constant or a type. A map from domain data to a `var()` token reference is a domain constant.
  - Never: import React, TanStack Query, TanStack Router or the HTTP client in a domain file, or use `fetch`, `window`, `document`, `localStorage` or `EventSource` in it.
- **Query.** A file in `modules/<feature>/queries/`.
  - Use it when: code reads or writes server data. A module `queries/` folder holds the key factory, `queryOptions`, the `useQuery`, `useSuspenseQuery` and `useMutation` wrappers, and the fetch or SSE glue. The `useMutation` wrapper owns optimistic updates and rollback. Only query files, in a module `queries/` folder or in `src/web/queries/`, import `src/web/lib/http.ts`. Return a response with status 400, 409 or 502 and the body `{ "error": "<code>" }` as typed data. Do not throw it. `http()` in `src/web/lib/http.ts` returns this typed result.
  - Never: render JSX in a query file.

## Shared tiers

- **Shadcn primitives.** Files in `src/web/components/ui/`.
  - Use it when: a visual primitive or an app-wide hook is necessary. A primitive file comes from `npx shadcn@latest add`. An app-wide hook, such as a media query, shortcut or local storage hook, goes in `components/ui/hooks/`.
  - Never: add a primitive by hand. Change a primitive only with a `cva` variant in its own file, or with an edit that "Primitive conventions" names.
- **Shared components.** Files in `src/web/components/`, outside `ui/`.
  - Use it when: two or more modules show the same composition, or a route places views of two modules in one layout. The layout gets the views as children. The folders `icons/`, `markdown/` and `splash/` and the file `ThemeProvider.tsx` also live here.
  - Never: import a file of a module or TanStack Query in a shared component.
- **Shared queries.** Files in `src/web/queries/`.
  - Use it when: two or more modules read the same server data. An example is the board snapshot and its SSE stream.
  - Never: put a query in this tier when only one module reads it.
- **Configured clients.** The files in `src/web/lib/`: `app-store.ts`, `http.ts`, `query-client.ts` and `utils.ts`. `md-links.ts` also stays in `src/web/lib/`, because only the fenced terminal client reads it (2026-10-07).
  - Use it when: a third-party client needs one configured instance, cross-module UI state needs the app store (see "Providers"), or code outside `components/ui` needs `cn`. `utils.ts` re-exports `cn` for that code.
  - Never: import a module or a component in a configured client file, or hold React state in it.
- **Styles.** Files in `src/web/styles/`.
  - Use it when: a value is a design token or a global stylesheet rule. `globals.css` maps shadcn names to tokens through `var()`.
  - Never: write a colour value outside `src/web/styles/tokens.css`.

A colour value is one of these:

- a hex literal
- an `rgb()`, `hsl()` or `oklch()` call
- a named CSS colour, except `transparent` and `currentColor`
- a Tailwind default palette class, such as `text-white`
- an arbitrary colour class, such as `bg-[#fff]`

You can use the keywords `transparent`, `currentColor` and `inherit` and the Tailwind classes that use them. A `color-mix()` call whose colour inputs are all `var()` token references is not a colour value. An SVG asset uses `currentColor` or a token class.

## Import matrix

The matrix covers project files only. The bans in each layer definition govern third-party packages. Every layer and every shared tier can import `src/shared/`. That folder holds types, constants and pure logic that the server, the app shell or two or more modules use. Each new file in it has a colocated `node:test` file.

Import a file in another folder of `src/web/` with the `@/` alias. Import a file in the same layer folder with a relative path. Import `src/shared/` with a relative path. A file can import other files in its own layer folder.

- A route imports module barrels, `src/web/queries/`, `src/web/lib/app-store.ts` (a type), `src/web/lib/query-client.ts`, `src/web/lib/utils.ts`, `components/ui` and shared components.
- A module barrel imports the views and query files of its module.
- A view imports containers and components of its module, `components/ui`, shared components and `src/web/lib/utils.ts`.
- A container imports components, hooks, query files and domain files of its module, `src/web/queries/`, `components/ui`, shared components and `src/web/lib/utils.ts`.
- A component imports components, hooks and domain files of its module, `components/ui`, shared components and `src/web/lib/utils.ts`.
- A hook imports hooks and domain files of its module and `components/ui/hooks/`.
- A query file imports domain files of its module, `src/web/lib/http.ts` and `src/web/queries/`.
- A domain file imports other domain files of its module.
- A `components/ui` file imports other `components/ui` files and `cn` from the `cn` package. It does not import a hook from outside `components/ui/`.
- A shared component imports `components/ui`, `src/web/lib/utils.ts` and other shared components.
- A shared query imports `src/web/lib/http.ts` and other shared queries.
- A configured client file imports `src/shared/` only.
- A test file also imports `node:test`, `node:assert` and files in its own folder.

Global bans:

1. Only query files and `src/web/lib/http.ts` call `fetch`. Only query files create an `EventSource`.
2. A module does not import a sibling module. Compose modules in `src/web/routes/` or a shared layout component.

## Naming

- Files in `components/ui/` are kebab-case `.tsx`, as the shadcn CLI writes them.
- Every other `.tsx` file is PascalCase, except route files.
- Every `.ts` file in `src/web/` is kebab-case. A file in a `hooks/` folder that exports a React hook is `use-<name>.ts`, for example `use-drag-reorder.ts` exports `useDragReorder`. A file that exports no React hook has no `use-` prefix. A `*-queries.ts` file keeps its name.
- A view name ends in `View`, and no other name does. A container name ends in `Container`, and no other name does.
- A module `queries/` folder holds `<feature>-api.ts` for the fetch glue and `<feature>-queries.ts` for the key factory, `queryOptions` and query hooks. `src/web/queries/` uses the same pattern with the data name, for example `board-api.ts` and `board-queries.ts`.
- Routes use TanStack Router file-based routing. A file under `src/web/routes/` is `__root.tsx`, `<page>.{-$id}.tsx` or `<page>.{-$id}.lazy.tsx` (the optional id segment, and a lazy split file), with `<page>` in kebab-case. Since 2026-10-07 a lint pattern enforces these three forms (U4-14), so a file such as `index.tsx` or `$param.tsx` fails lint. The generated file `src/web/routeTree.gen.ts` is exempt from naming and lint rules.

## Tests

- Each non-test domain file and each `*-queries.ts` file, in a module or in `src/web/queries/`, has a colocated `node:test` file named `<subject>.test.ts`. The `*-queries.ts` tests cover the `*-api.ts` glue.
- The repo has no `.tsx` test runner. Check views, containers and components in a browser.
- The screenshot suite in `tests/visual/` (Playwright) compares seven screens in the light and the dark theme, at desktop and phone width, with committed baselines per platform, and opens every route to fail on a console or page error. It runs locally and in the CI `visual` job after the `check` job. A changed pixel fails it.

## The only-shadcn rule

The rule, from the initiative brief:

> every visual primitive is a shadcn-generated file under `src/web/components/ui/` or a composition of those files. Custom pieces (kanban card, terminal frame, flow stage, brand badge) live in a module's `components/` folder and compose shadcn primitives internally. Extend a primitive by adding a `cva` variant inside its shadcn file; never fork it and never hand-build a lookalike. No inline `style` objects, no hex outside `src/web/styles/tokens.css`.

The inline style ban: a file in `src/web/` does not use the JSX `style` prop. The exceptions are `components/ui/` files, which set CSS variables through `style`, `modules/<feature>/components/dnd/` files, which pass the dnd-kit transform through `style`, and the viewer, which keeps its style constants under the dated exception U4-13. A DOM helper in a hook can set a CSS variable or a transform for an animation. `components/ui/hooks/use-css-vars.ts` may also set static layout variables computed in code, such as the FlowStage geometry and the flow frame width, because the JSX `style` prop is banned.

Primitive conventions. These are the only edits to a generated file other than a `cva` variant:

1. Replace each generated `ring-*` class with `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`. Invalid state keeps `aria-invalid:border-destructive`. A `components/ui` file has no `ring-*` class. If the class string also has `outline-hidden` or `outline-none`, add `focus-visible:outline-solid`; focus-outline.test.ts enforces it. Menu and select items use the inset form `focus-visible:-outline-offset-2`.
2. Replace each Tailwind default palette class with a token class, for example `text-white` with `text-on-accent` or `text-on-danger`.
3. Replace a raw colour variable in a class, such as `hsl(var(...))`, with the plain `var(...)` form.
4. Remove the `next-themes` import from the Sonner file. The Sonner toaster gets its theme as a prop from its consumer.
5. Replace a token class that breaks design-contract.md (the contrast floor, the focus rule, or a radius, motion or pressed-state token) with the token class the contract names. Record the edit in the unit's decisions.

Theme facts:

1. The shadcn name `accent` maps to the card hover surface. The shadcn name `ring` maps to the Dispatch accent token, the focus outline colour. The accent token in `tokens.css` keeps the jobs that `design-contract.md` lists for it.
2. The Tailwind `dark` variant matches `[data-theme="dark"]`. One `:root` block maps each shadcn name to a token.
3. The main app loads Tailwind without preflight (R-17; U4-19 keeps this on 2026-10-07). The scoped base reset in `globals.css` applies only to elements with a `data-slot` attribute. The gallery page loads preflight for itself only.
4. Forms use the shadcn Field component. Do not use the registry Form component.

## Focus versus selection

This rule moved here from `frontend-design-system.md` on 2026-10-07 (LOCAL-77, U4-28). `design-contract.md` authors it.

**A keyboard focus ring must never look identical to selection.**

- Show focus with an outline: the classes of "Primitive conventions" item 1, in the `ring` colour, which maps to the Dispatch accent token.
- Selection and needs-attention use the card border and the card shadow ring (the `identity` variants in `components/ui/card.tsx`). They never use the focus outline.
- Do not show focus with an accent box-shadow ring. It looks the same as the selection ring, and a keyboard user cannot see where focus is.
- If an `overflow: hidden` ancestor clips the outline, set the offset to 0 at that call site. If the outline is still clipped at offset 0, draw it inside the element with a negative offset (`-outline-offset-2`), and keep the element inside the clipping ancestor. Menu and select items use this inset form, `focus-visible:-outline-offset-2`.
- The accent row of the "Color roles" table in `design-contract.md` lists the jobs of the accent. That row wins on a conflict with this standard.
- The UI font token in `tokens.css` names Inter first, but the app does not load Inter as a webfont: no `@font-face`, no webfont link and no bundled font file. The app renders in the OS system font. This is a deliberate decline (`design-contract.md`, "Deferred decisions" rows 8 and 9).

## Allowed custom families

The only-shadcn rule does not apply to these families. All other visual code composes `components/ui` primitives.

1. SVG assets in `src/web/components/icons/` or `modules/<feature>/components/icons/`: Glyph, QrCode, ImageWithFallback, the brand marks in `icons/brands/` and the SVG drawing inside FlowStage.
2. The dnd-kit board mechanics in `modules/<feature>/components/dnd/`: droppable columns, draggable card wrappers and the drag overlay. The drag context is in a container, because its handlers start mutations.
3. The fenced terminal page: `terminal.html` and `terminal-main.ts` (invariant NEW-20).
4. react-markdown output in `src/web/components/markdown/`, styled with Tailwind typography classes. Typography is not a shadcn registry item.
5. The segmented group progress bar in `modules/dashboard/components/GroupProgressBar.tsx`: plain list elements with token classes. No shadcn primitive draws one segment for each unit with a pattern for each state (LOCAL-84 U2-07).

## Providers

- Use `createContext` only in `components/ui/` files and in `src/web/components/ThemeProvider.tsx`.
- `main.tsx` renders the provider stack: QueryClientProvider, then ThemeProvider, then RouterProvider and the splash. ThemeProvider holds one theme instance that the shell toaster and Settings Appearance share (2026-10-07, U4-07).
- A `components/ui` file can create a context, such as SidebarProvider or TooltipProvider.
- Cross-module UI state is in the app store `src/web/lib/app-store.ts`, not in a context (U4-06). The store is plain TypeScript with one action per change. `main.tsx` creates it and puts it in the router context next to `queryClient`. A container gets it with `useRouteContext({ from: "__root__" })` and reads one field with `useAppStore` from `components/ui/hooks/use-app-store.ts`. State that one module owns stays in that module.
- Record, 2026-10-07 (LOCAL-77): the transitional app state context (R-15) and its provider in the root route are deleted. The app store replaces them, and ThemeProvider moved from the root route to `main.tsx`.

## Invariants

These invariants stay unchanged:

- NEW-20: `terminal.html` and `terminal-main.ts` are the only `terminal*` files directly in `src/web/`.
- NEW-22: the attention predicate has one definition, in `src/shared/card-attention.ts`. If that file moves, update its path in `scripts/check-invariants.mjs` in the same change.
- NEW-24: the palette hex values are only in `tokens.css`. Each accent map has one source.
- PANEL-03: the ttyd iframe is one always-rendered element. Never give it a `key`.

These invariant checks retired on 2026-10-07 (LOCAL-77). A lint rule in `eslint.config.ts` replaces each one:

- NEW-15 (accent box-shadow focus): `components/ui/focus-outline.test.ts`, the style ban, the shadow class ban in `designLiteralBan` and the focus shadow value in `retiredLiteralBan`.
- NEW-16 (raw float shadow): the shadow class ban in `designLiteralBan` and the float shadow value in `retiredLiteralBan`.
- NEW-17 (weight 800): the weight class ban in `designLiteralBan` and the `fontWeight` 800 property in `retiredLiteralBan`.
- NEW-19 (reading rhythm in the board): `boardZoneBan` on `src/web/modules/board/**`.

The design contract values stay: the density scale, source colors, contrast floors, elevation ladder and motion budget. The focus outline rule stays, in the section "Focus versus selection".

## Agent rules block

1. Put each new frontend file in a route, a layer folder of `src/web/modules/<feature>/` or a shared tier.
2. Use only these layer folders: `views`, `containers`, `components`, `hooks`, `domain`, `queries`.
3. A route renders one view, or one shared layout component that gets module views as children. Keep business logic, JSX layout and data transforms out of routes.
4. Get server data only in query files. Only query files import the HTTP client.
5. Call query and mutation hooks only in containers.
6. Keep components free of TanStack Query, TanStack Router and the HTTP client. Only query files and `http.ts` call `fetch`.
7. Keep domain files pure. Do not import React, and do not use `fetch`, `window`, `document`, `localStorage` or `EventSource`.
8. Do not import a sibling module. Compose modules in a route or a shared layout component.
9. Export only views and `queryOptions` factories from a module `index.ts`.
10. Build UI from `src/web/components/ui/` primitives, except the allowed custom families.
11. Add a primitive with `npx shadcn@latest add`. Do not write a lookalike.
12. Change a primitive with a `cva` variant in its own file, or with an edit that "Primitive conventions" names.
13. Do not use the JSX `style` prop, except in `components/ui/` files, `modules/<feature>/components/dnd/` files, `src/web/viewer/` files and `src/web/viewer-main.tsx` (U4-13). Use Tailwind token classes.
14. Do not write a colour value outside `src/web/styles/tokens.css`.
15. Show focus with an outline, not a ring or a box-shadow.
16. Name `.tsx` files in PascalCase, except in `components/ui/` and route files. Name `.ts` files in kebab-case.
17. Put a `<subject>.test.ts` file next to each non-test domain file and each `*-queries.ts` file.

## Agent tooling

1. Git tracks these agent files: `CLAUDE.md`, `.claude/settings.json`, and the files in `.claude/hooks/` and `.claude/skills/`.
2. `.gitignore` ignores all other paths in `.claude/`, for example `.claude/settings.local.json`. It uses `.claude/*` and one negation for each tracked path, because git cannot include a file again when its parent folder is ignored.
3. `CLAUDE.md` holds the "Agent rules block" of this standard and the "Agent rules block (backend)" of `backend-design.md`, with no changes. When you change a rule in one of these blocks, make the same change in `CLAUDE.md`.
4. `.claude/settings.json` holds only hook entries. Put personal settings, for example `env` values, in `.claude/settings.local.json`.
5. `.gitignore` also ignores a `.claude/` folder below the repo root, with the line `*/**/.claude/`.
6. The `PreToolUse` hook `.claude/hooks/pretooluse-rules.mjs` denies an edit that breaks one of six rules: inline style, hex colour, Radix import, new `.tsx` file location, server data outside a query file, module folder shape. The deny reason names the fix and the section of this standard. `scripts/check-hooks.mjs` checks these decisions in `npm run check`.
7. The `PostToolUse` hook `.claude/hooks/format-edited-file.mjs` runs prettier on each edited file. It skips config files and `.claude/`.
8. The `Stop` hook `.claude/hooks/stop-static-check.mjs` runs `format:check`, `lint`, `typecheck` and `depcruise` when the working tree has changes. If a step fails, the session cannot stop. Set `DISPATCH_SKIP_STOP_CHECK=1` in `.claude/settings.local.json` to turn off this check.

## Supersede records index

Each record names this document. The section names below are the start of each heading.

- `design-contract.md`: "Component library" (2026-09-30).
- `frontend-design-system.md`: the whole file (2026-10-07). The file holds only a redirect note. Its focus versus selection rule is in this standard.
- `folder-structure.md`: "Frontend tree", the Frontend paragraph of "Import direction" and the web rows of "Naming convention" (2026-09-30). On 2026-10-07 each became a pointer to this standard.
- `code-review-rules.md`: each legacy "Frontend:" section (2026-09-30). The sections were removed on 2026-10-07.
