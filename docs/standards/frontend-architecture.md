# Frontend Architecture Standard (v2)

## Status and scope

This standard governs all new frontend code in `src/web/`. It starts on 2026-09-30. It supersedes the sections of `design-contract.md`, `frontend-design-system.md`, `folder-structure.md` and `code-review-rules.md` that the "Supersede records index" names.

The module pattern, from the initiative brief:

> `src/web/routes/` owns URLs and loaders; `src/web/modules/<feature>/{views,containers,components,hooks,domain,queries}` owns one feature each; `src/web/components/ui/` holds shadcn; `src/web/lib/` holds configured clients; modules never import sibling modules.

The new tree is this list of paths. None of them exists yet, so this list marks each one (new). Later mentions do not repeat the marker.

- `src/web/routes/` (new)
- `src/web/modules/` (new)
- `src/web/components/ui/` (new), short form `components/ui`
- `src/web/components/ui/hooks/` (new)
- `src/web/components/` (new)
- `src/web/queries/` (new)
- `src/web/lib/http.ts` (new)
- `src/web/lib/utils.ts` (new)
- `src/web/lib/query-client.ts` (new)
- `src/web/styles/globals.css` (new)
- `components.json` (new) and the `@/` import alias for `src/web/` (new)

The legacy tree has these parts:

- `src/web/features/`, `src/web/primitives/` and `src/web/hooks/`
- every other file in `src/web/lib/`, such as `api.ts`, `route.ts` and the `format-*.ts` helpers
- `src/web/viewer/` and the web root entry files: `main.tsx`, `App.tsx`, `AppShell.tsx`, `viewer-main.tsx` and the HTML entries

The legacy tree stays until ticket 16. The section "Legacy tree during transition" gives its rules.

## Layer definitions

A module is one folder `src/web/modules/<feature>/`. A module has six layer folders. A route file is a seventh layer outside the module. The app shell is the root route `src/web/routes/__root.tsx`. The root route is exempt from the Route rules below. It renders the shell layout, the `Outlet`, the QueryClientProvider and the transitional providers. The module `index.ts` is the barrel, not a layer. A test file belongs to the layer of its subject.

- **Route.** A file under `src/web/routes/`.
  - Use it when: a URL needs an owner. The route owns the URL, the params and `validateSearch` with zod. Its loader calls `queryOptions` from a module barrel or from `src/web/queries/`. It renders exactly one view, or one shared layout component that gets module views as children.
  - Never: put business logic, JSX layout or a data transform in a route file, or import TanStack Query in it except as a type.
- **View.** The page component in `modules/<feature>/views/`.
  - Use it when: a route needs a page. The view composes containers and layout. It can set layout classes, such as flex, grid, gap and padding.
  - Never: import TanStack Query or call a query hook in a view.
- **Container.** A component in `modules/<feature>/containers/`.
  - Use it when: one region of a view needs data or behaviour. The container gets data through the module's query hooks or a shared query in `src/web/queries/`, for example the board snapshot. It owns mutations, selection state and editing state. It gives plain props to its child components. It is the only layer that calls a query hook, and it uses TanStack Query only through query hooks. A query hook is a wrapper that a `queries/` folder exports. Query files call TanStack `useQuery`, `useSuspenseQuery` and `useMutation` inside those wrappers. When one region fills the whole page, the view still renders that region as one container.
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
  - Use it when: code reads or writes server data. A module `queries/` folder holds the key factory, `queryOptions`, the `useQuery`, `useSuspenseQuery` and `useMutation` wrappers, and the fetch or SSE glue. The `useMutation` wrapper owns optimistic updates and rollback. Only query files, in a module `queries/` folder or in `src/web/queries/`, import `src/web/lib/http.ts`. Return a response with status 400, 409 or 502 and the body `{ "error": "<code>" }` as typed data. Do not throw it. `src/web/lib/api.ts` does this today.
  - Never: render JSX in a query file.

## Shared tiers

- **Shadcn primitives.** Files in `src/web/components/ui/`.
  - Use it when: a visual primitive or an app-wide hook is necessary. A primitive file comes from `npx shadcn@latest add`. An app-wide hook, such as a media query, shortcut or local storage hook, goes in `components/ui/hooks/`.
  - Never: add a primitive by hand. Change a primitive only with a `cva` variant in its own file, or with an edit that "Primitive conventions" names.
- **Shared components.** Files in `src/web/components/`, outside `ui/`.
  - Use it when: two or more modules show the same composition, or a route places views of two modules in one layout. The layout gets the views as children. The folders `icons/` and `markdown/` and the files `AppState.tsx` and `ThemeProvider.tsx` also live here.
  - Never: import a file of a module or TanStack Query in a shared component.
- **Shared queries.** Files in `src/web/queries/`.
  - Use it when: two or more modules read the same server data. An example is the board snapshot and its SSE stream.
  - Never: put a query in this tier when only one module reads it.
- **Configured clients.** The new files in `src/web/lib/`: `http.ts`, `query-client.ts` and `utils.ts`.
  - Use it when: a third-party client needs one configured instance, or code needs `cn`. `utils.ts` holds `cn`.
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

- A route imports module barrels, `src/web/queries/`, `src/web/lib/query-client.ts`, `src/web/lib/utils.ts`, `components/ui` and shared components.
- A module barrel imports the views and query files of its module.
- A view imports containers and components of its module, `components/ui`, shared components and `src/web/lib/utils.ts`.
- A container imports components, hooks, query files and domain files of its module, `src/web/queries/`, `components/ui`, shared components and `src/web/lib/utils.ts`.
- A component imports components, hooks and domain files of its module, `components/ui`, shared components and `src/web/lib/utils.ts`.
- A hook imports hooks and domain files of its module and `components/ui/hooks/`.
- A query file imports domain files of its module, `src/web/lib/http.ts` and `src/web/queries/`.
- A domain file imports other domain files of its module.
- A `components/ui` file imports other `components/ui` files and `src/web/lib/utils.ts`. It does not import a hook from outside `components/ui/`.
- A shared component imports `components/ui`, `src/web/lib/utils.ts` and other shared components.
- A shared query imports `src/web/lib/http.ts` and other shared queries.
- A configured client file imports `src/shared/` only.
- A test file also imports `node:test`, `node:assert` and files in its own folder.

Global bans:

1. Only query files and `src/web/lib/http.ts` call `fetch`. Only query files create an `EventSource`.
2. A module does not import a sibling module. Compose modules in `src/web/routes/` or a shared layout component.
3. A file in a layer folder does not import the legacy tree.

## Naming

- Files in `components/ui/` are kebab-case `.tsx`, as the shadcn CLI writes them.
- Every other `.tsx` file is PascalCase, except route files.
- Every `.ts` file in the new tree is kebab-case. A file in a `hooks/` folder that exports a React hook is `use-<name>.ts`, for example `use-drag-reorder.ts` exports `useDragReorder`. A file that exports no React hook has no `use-` prefix. A `*-queries.ts` file keeps its name.
- A view name ends in `View`, and no other name does. A container name ends in `Container`, and no other name does.
- A module `queries/` folder holds `<feature>-api.ts` for the fetch glue and `<feature>-queries.ts` for the key factory, `queryOptions` and query hooks. `src/web/queries/` uses the same pattern with the data name, for example `board-api.ts` and `board-queries.ts`.
- Routes use TanStack Router file-based routing. Route file names follow its conventions (`__root.tsx`, `index.tsx`, `$param.tsx`). The generated file `src/web/routeTree.gen.ts` is exempt from naming and lint rules.
- The legacy rule for `src/web/hooks/useX.ts` stays until ticket 16.

## Tests

- Each non-test domain file and each `*-queries.ts` file, in a module or in `src/web/queries/`, has a colocated `node:test` file named `<subject>.test.ts`. The `*-queries.ts` tests cover the `*-api.ts` glue.
- The repo has no `.tsx` test runner. Check views, containers and components in a browser.

## The only-shadcn rule

The rule, from the initiative brief:

> every visual primitive is a shadcn-generated file under `src/web/components/ui/` or a composition of those files. Custom pieces (kanban card, terminal frame, flow stage, brand badge) live in a module's `components/` folder and compose shadcn primitives internally. Extend a primitive by adding a `cva` variant inside its shadcn file; never fork it and never hand-build a lookalike. No inline `style` objects, no hex outside `src/web/styles/tokens.css`.

The inline style ban: a file in the new tree does not use the JSX `style` prop. The exceptions are `components/ui/` files, which set CSS variables through `style`, and `modules/<feature>/components/dnd/` files, which pass the dnd-kit transform through `style`. A DOM helper in a hook can set a CSS variable or a transform for an animation.

Primitive conventions. These are the only edits to a generated file other than a `cva` variant:

1. Replace each generated `ring-*` class with `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`. Invalid state keeps `aria-invalid:border-destructive`. A `components/ui` file has no `ring-*` class.
2. Replace each Tailwind default palette class with a token class, for example `text-white` with `text-on-accent` or `text-on-danger`.
3. Replace a raw colour variable in a class, such as `hsl(var(...))`, with the plain `var(...)` form.
4. Remove the `next-themes` import from the Sonner file. The Sonner toaster gets its theme as a prop from its consumer.

Theme facts:

1. The shadcn name `accent` maps to the card hover surface. The shadcn name `ring` maps to the Dispatch accent token, the focus outline colour. The accent token in `tokens.css` keeps the jobs that `design-contract.md` lists for it.
2. The Tailwind `dark` variant matches `[data-theme="dark"]`. One `:root` block maps each shadcn name to a token.
3. The main app loads Tailwind without preflight until ticket 9 (the shadcn shell). The gallery page loads preflight for itself only.
4. Forms use the shadcn Field component. Do not use the registry Form component.

## Allowed custom families

The only-shadcn rule does not apply to these families. All other visual code composes `components/ui` primitives.

1. SVG assets in `src/web/components/icons/` or `modules/<feature>/components/icons/`: Glyph, WarningIcon, QrCode, ImageWithFallback, Splash, the brand marks and the SVG drawing inside FlowStage.
2. The dnd-kit board mechanics in `modules/<feature>/components/dnd/`: droppable columns, draggable card wrappers and the drag overlay. The drag context is in a container, because its handlers start mutations.
3. The fenced terminal page: `terminal.html` and `terminal-main.ts` (invariant NEW-20).
4. react-markdown output in `src/web/components/markdown/`, styled with Tailwind typography classes. Typography is not a shadcn registry item.

## Providers

- Use `createContext` only in `components/ui/` files, `src/web/components/AppState.tsx` (the `AppState` context and its `useAppState` hook) and `src/web/components/ThemeProvider.tsx` (a theme context, if one exists). `__root.tsx` renders both providers. Ticket 9 can move the last two files. Ticket 9 then updates this list.
- The app-level contexts are QueryClientProvider, RouterProvider and the theme context.
- A `components/ui` file can create a context, such as SidebarProvider or TooltipProvider.
- From 2026-09-30, the app can use one transitional `AppState` context. Ticket 16 removes it.

## Invariants

These invariants stay unchanged:

- NEW-20: `terminal.html` and `terminal-main.ts` are the only `terminal*` files directly in `src/web/`.
- NEW-22: the attention predicate has one definition, in `card-attention.ts`. If that file moves, update its path in `scripts/check-invariants.mjs` in the same change.
- NEW-24: the palette hex values are only in `tokens.css`. Each accent map has one source.
- PANEL-03: the ttyd iframe is one always-rendered element. Never give it a `key`.

Ticket 16 replaces these invariant checks with lint rules:

- NEW-15 (accent box-shadow focus): the outline-only focus classes in `components/ui`.
- NEW-16 (raw float shadow) and NEW-17 (`fontWeight: 800`): the inline style ban and a ban on arbitrary shadow and weight classes.
- NEW-19 (reading-surface in the board): a class name rule for the board module.

The design contract values stay: the density scale, source colors, contrast floors, elevation ladder and motion budget. The focus outline rule in `frontend-design-system.md` stays.

## Legacy tree during transition

1. The legacy tree keeps its own rules in `folder-structure.md`, `frontend-design-system.md`, `design-contract.md` and `code-review-rules.md` until ticket 16.
2. Do not add a new feature to the legacy tree. Put new code in a module.
3. Write a fix in a legacy file in the legacy style. Do not migrate part of a file.
4. A migration ticket uses the layer definitions in this standard to map each legacy file to a layer.
5. The lint rules and the agent hook rules for the new tree cover the new tree list in "Status and scope". Two hook rules also cover the legacy tree: the Radix import rule and the new `.tsx` file rule.

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
13. Do not use the JSX `style` prop, except in `components/ui/` files and `modules/<feature>/components/dnd/` files. Use Tailwind token classes.
14. Do not write a colour value outside `src/web/styles/tokens.css`.
15. Show focus with an outline, not a ring or a box-shadow.
16. Name `.tsx` files in PascalCase, except in `components/ui/` and route files. Name `.ts` files in kebab-case.
17. Put a `<subject>.test.ts` file next to each non-test domain file and each `*-queries.ts` file.
18. Do not add a new feature to the legacy tree. Do not migrate part of a legacy file.

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

Each record has the date 2026-09-30 and names this document. The section names below are the start of each heading.

- `design-contract.md`: "Component library".
- `frontend-design-system.md`: "The primitives", "Styling approach", "Component architecture", "Depth", "Component anatomy".
- `folder-structure.md`: "Frontend target tree", "Component placement (frontend)", the Frontend paragraph of "Import direction", the web rows of "Naming convention".
- `code-review-rules.md`: each legacy "Frontend:" section.
