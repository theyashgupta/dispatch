# Frontend agent rules

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

# Backend agent rules

1. Parse each route input with a zod schema in the route file.
2. Throw a typed error from `services/domain/errors.ts`. Do not call `res.status` with a 4xx or 5xx code.
3. Keep routes free of `exec`, tmux and git calls. A new route file calls `boardRepository`, not `board.store.ts`.
4. Keep business logic in services, not in routes or handlers.
5. Do not read `req` or `res` in a service.
6. Write board state only through the store.
7. Spawn a subprocess only through `adapters/exec.ts` or a named exception in `code-review-rules.md`.
8. Put a `node:test` file next to each new route, service and domain file.
9. A file imports only from its own folder and from folders earlier in this list: `src/shared/`, `store/` and `sources/`, `adapters/`, `services/infra/`, `services/orchestration/`, `routes/`. `store/` and `sources/` do not import each other, and among these folders only `adapters/` imports `sources/`. A file in `services/domain/` imports `src/shared/` only; orchestration files and routes can import it. The one exception is `adapters/image-proxy.ts`, which imports `services/infra/config-holder.ts`.
10. Use `bootstrap/` as the composition root. It can import every folder. Only `bootstrap/index.ts` calls `setBoardRepository(store)` in source code. A test can call `setBoardRepository` to install `fakeBoardRepository`.
