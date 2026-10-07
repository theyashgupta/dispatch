---
name: scaffold-module
description: Use for /scaffold-module <feature>. Creates src/web/modules/<feature>/ with six layer folders, a barrel, a view, a query key factory and domain tests.
---

# Scaffold a frontend module

The rules are in `docs/standards/frontend-architecture.md`, in the sections "Layer definitions", "Import matrix", "Naming" and "Tests".

## Names

- `<feature>` is the module name in kebab-case. Example: `card-detail`.
- `<Feature>` is the same name in PascalCase. Example: `CardDetail`.
- `<featureCamel>` is the same name in camelCase. Example: `cardDetail`.

## Before you start

1. Get the module name from the argument of the command.
2. Make sure that the name is kebab-case. If the name is not kebab-case, stop and tell the user.
3. Make sure that `src/web/modules/<feature>/` does not exist. If it exists, stop and tell the user.

## Procedure

1. Create the six layer folders. Use these six commands. Do not use brace expansion.

   ```
   mkdir -p src/web/modules/<feature>/views
   mkdir -p src/web/modules/<feature>/containers
   mkdir -p src/web/modules/<feature>/components
   mkdir -p src/web/modules/<feature>/hooks
   mkdir -p src/web/modules/<feature>/domain
   mkdir -p src/web/modules/<feature>/queries
   ```

2. Write `src/web/modules/<feature>/views/<Feature>View.tsx` with this content:

   ```
   export function <Feature>View() {
     return (
       <section className="flex flex-col gap-2">
         <h1 className="text-lg font-semibold"><Feature></h1>
       </section>
     );
   }
   ```

3. Write `src/web/modules/<feature>/domain/<feature>-label.ts` with this content:

   ```
   /**
    * Return the display label for one <feature> item.
    */
   export function <featureCamel>Label(title: string): string {
     return title.trim() || "Untitled";
   }
   ```

4. Write `src/web/modules/<feature>/domain/<feature>-label.test.ts` with this content:

   ```
   import { test } from "node:test";
   import assert from "node:assert/strict";
   import { <featureCamel>Label } from "./<feature>-label.js";

   test("<featureCamel>Label trims the title", () => {
     assert.equal(<featureCamel>Label("  One  "), "One");
   });

   test("<featureCamel>Label returns Untitled for an empty title", () => {
     assert.equal(<featureCamel>Label("   "), "Untitled");
   });
   ```

5. Write `src/web/modules/<feature>/queries/<feature>-queries.ts` with this content. This file holds the query key factory.

   ```
   export const <featureCamel>Keys = {
     all: ["<feature>"] as const,
     detail: (id: string) => ["<feature>", "detail", id] as const,
   };
   ```

6. Write `src/web/modules/<feature>/queries/<feature>-queries.test.ts` with this content:

   ```
   import { test } from "node:test";
   import assert from "node:assert/strict";
   import { <featureCamel>Keys } from "./<feature>-queries.js";

   test("<featureCamel>Keys.detail starts with the module key", () => {
     assert.deepEqual(<featureCamel>Keys.detail("1"), ["<feature>", "detail", "1"]);
   });
   ```

7. Write `src/web/modules/<feature>/index.ts` with this content:

   ```
   export { <Feature>View } from "@/modules/<feature>/views/<Feature>View";
   ```

## Rules for the next files

1. Put each file in one of the six layer folders. Do not put other files in the module root. The module root holds only `index.ts`.
2. Export only views and `queryOptions` factories from `index.ts`.
3. Import a file in another folder with the `@/` alias. Import a file in the same layer folder with a relative path.
4. Do not import a sibling module.
5. Do not use the JSX `style` prop. Do not write a hex colour. Use Tailwind token classes.
6. Call `fetch` and import `src/web/lib/http.ts` only in `queries/`.
7. Give each new `.tsx` file a PascalCase name. Give each new `.ts` file a kebab-case name.
8. Put a `<subject>.test.ts` file next to each domain file and each `*-queries.ts` file.
9. Do not add comments to a `.tsx` file. Add a JSDoc block only to a function in a `.ts` file.

## Checks

1. Format the new files with `env -u NODE_ENV npx prettier --write <each new file>`. A long name can make a line too long for the template layout.
2. Run these commands. Each command must pass.

   ```
   env -u NODE_ENV npm run format:check
   env -u NODE_ENV npm run lint
   env -u NODE_ENV npm run typecheck
   env -u NODE_ENV npm run depcruise
   env -u NODE_ENV npm run test
   ```

3. Run `env -u NODE_ENV npm run deadcode`. Until a route imports the module barrel, knip reports the files of the new module. This result is correct. Do not add a route for this reason. Add a route only when the user asks for it.
4. Git does not keep an empty folder. The empty layer folders stay on disk until a file goes into them.
