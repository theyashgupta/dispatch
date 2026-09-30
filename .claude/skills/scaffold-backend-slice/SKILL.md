---
name: scaffold-backend-slice
description: Use for /scaffold-backend-slice <slice> <resources>. Creates a zod-validated route with typed errors, a domain service stub and colocated node:test files.
---

# Scaffold a backend slice

The rules are in `docs/standards/backend-design.md`, in the sections "Layer definitions", "Validation", "Errors", "Naming" and "Tests".

## Names

- `<slice>` is the slice name in kebab-case. Example: `note-draft`.
- `<Slice>` is the same name in PascalCase. Example: `NoteDraft`.
- `<sliceCamel>` is the same name in camelCase. Example: `noteDraft`.
- `<resources>` is the plural resource name in kebab-case. Example: `note-drafts`. The route file uses this name.
- `<resourcesCamel>` is the plural name in camelCase. Example: `noteDrafts`.

## Before you start

1. Get the slice name and the resource name from the arguments of the command. If the resource name is missing, use the plural form of the slice name.
2. Make sure that both names are kebab-case. If a name is not kebab-case, stop and tell the user.
3. Make sure that `src/server/routes/<resources>.route.ts` and `src/server/services/domain/<slice>.ts` do not exist. If one exists, stop and tell the user.

## Procedure

1. Write the service stub `src/server/services/domain/<slice>.ts` with this content. A domain file does not import an adapter, the store, infra or orchestration.

   ```
   export interface <Slice>Input {
     title: string;
   }

   export interface <Slice>Result {
     title: string;
     length: number;
   }

   /**
    * Build the <slice> result from validated input.
    */
   export function build<Slice>(input: <Slice>Input): <Slice>Result {
     return { title: input.title, length: input.title.length };
   }
   ```

2. Write `src/server/services/domain/<slice>.test.ts` with this content:

   ```
   import test from "node:test";
   import assert from "node:assert/strict";
   import { build<Slice> } from "./<slice>.js";

   test("build<Slice> returns the title and its length", () => {
     assert.deepEqual(build<Slice>({ title: "One" }), { title: "One", length: 3 });
   });
   ```

3. Write the route `src/server/routes/<resources>.route.ts` with this content:

   ```
   import { Router } from "express";
   import { z } from "zod";
   import { parseOrThrow } from "./parse-input.js";
   import { build<Slice> } from "../services/domain/<slice>.js";

   const MAX_TITLE_LEN = 200;
   const invalidTitle = { error: "invalid-title" } as const;

   const <sliceCamel>Schema = z.object(
     {
       title: z
         .string(invalidTitle)
         .trim()
         .min(1, invalidTitle)
         .refine((title) => title.length <= MAX_TITLE_LEN, invalidTitle),
     },
     invalidTitle,
   );

   export const <resourcesCamel>Router = Router();

   <resourcesCamel>Router.post("/<resources>", (req, res) => {
     const input = parseOrThrow(<sliceCamel>Schema, req.body);
     res.json(build<Slice>(input));
   });
   ```

4. Mount the router in `src/server/routes/index.ts`:
   1. Add `import { <resourcesCamel>Router } from "./<resources>.route.js";` after the other router imports.
   2. Add `apiRouter.use(<resourcesCamel>Router);` after the other `apiRouter.use` lines.

5. Write the route test `src/server/routes/<resources>-route.test.ts` with this content:

   ```
   import test, { after } from "node:test";
   import assert from "node:assert/strict";
   import type { Server } from "node:http";
   import { isolateEnv } from "../test-support/fixtures.js";

   const env = isolateEnv();
   const express = (await import("express")).default;
   const { <resourcesCamel>Router } = await import("./<resources>.route.js");
   const { httpErrorHandler } = await import("./error-handler.js");

   const app = express();
   app.use("/api", express.json(), <resourcesCamel>Router);
   app.use(httpErrorHandler);
   const server: Server = await new Promise((resolve) => {
     const s = app.listen(0, "127.0.0.1", () => resolve(s));
   });
   const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
   after(() => {
     server.close();
     env.cleanup();
   });

   /**
    * Post a JSON body to the <resources> route and return the status and the body text.
    */
   async function post(body: unknown): Promise<{ status: number; text: string }> {
     const res = await fetch(`${base}/<resources>`, {
       method: "POST",
       headers: { "content-type": "application/json" },
       body: JSON.stringify(body),
     });
     return { status: res.status, text: await res.text() };
   }

   test("POST /<resources> returns the trimmed title", async () => {
     assert.deepEqual(await post({ title: "  One  " }), {
       status: 200,
       text: JSON.stringify({ title: "One", length: 3 }),
     });
   });

   test("POST /<resources> rejects an empty title with invalid-title", async () => {
     assert.deepEqual(await post({ title: "   " }), {
       status: 400,
       text: JSON.stringify({ error: "invalid-title" }),
     });
   });

   test("POST /<resources> rejects an array body with invalid-title", async () => {
     assert.deepEqual(await post(["x"]), {
       status: 400,
       text: JSON.stringify({ error: "invalid-title" }),
     });
   });
   ```

## Rules for the next edits

1. Parse each route input with a zod schema in the route file. Give each field schema its error code as the message.
2. Throw a typed error from `src/server/services/domain/errors.ts`, for example `NotFoundError("<slice>-not-found")`. Do not call `res.status` with a 4xx or 5xx code.
3. Keep business logic in the service. Do not read `req` or `res` in a service.
4. Do not call `exec`, tmux or git in the route. Call the board store only through `boardRepository` from `src/server/store/board-repository.ts`.
5. Use `.refine((s) => s.length <= MAX)` for a length limit. The zod `.max()` counts code points, not the JavaScript `length`.
6. Put a `node:test` file next to each new route, service and domain file.

## Checks

Format the new files with `env -u NODE_ENV npx prettier --write <each new file>`. A long name can make a line too long for the template layout.

Then run these commands. Each command must pass.

```
env -u NODE_ENV npm run format:check
env -u NODE_ENV npm run lint
env -u NODE_ENV npm run typecheck
env -u NODE_ENV npm run depcruise
env -u NODE_ENV npm run test
env -u NODE_ENV npm run deadcode
```
