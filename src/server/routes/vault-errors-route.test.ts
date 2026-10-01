import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const paths = await import("../services/infra/paths.js");
for (const p of [
  paths.VAULT_METADATA_PATH,
  paths.ENV_VAULT_SCHEMA_PATH,
  paths.ENV_VAULT_VALUES_PATH,
]) {
  assert.ok(p.startsWith(env.root), `${p} escaped the isolated root`);
}
const { rebuildSources } = await import("../adapters/source-gateway.js");
const express = (await import("express")).default;
const { vaultRouter } = await import("./vault.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
const app = express();
app.use("/api", express.json(), vaultRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function expectBody(
  method: string,
  route: string,
  body: unknown,
  status: number,
  text: string,
): Promise<void> {
  const res = await call(method, route, body);
  assert.equal(
    res.status,
    status,
    `${method} ${route} ${JSON.stringify(body)}`,
  );
  assert.equal(res.text, text);
}

const err = (error: string, name?: string) =>
  JSON.stringify(name === undefined ? { error } : { error, name });

async function withCorruptMetadata<T>(run: () => Promise<T>): Promise<T> {
  const good = fs.existsSync(paths.VAULT_METADATA_PATH)
    ? fs.readFileSync(paths.VAULT_METADATA_PATH)
    : null;
  fs.mkdirSync(path.dirname(paths.VAULT_METADATA_PATH), { recursive: true });
  fs.writeFileSync(paths.VAULT_METADATA_PATH, "not json");
  try {
    return await run();
  } finally {
    if (good) fs.writeFileSync(paths.VAULT_METADATA_PATH, good);
    else fs.rmSync(paths.VAULT_METADATA_PATH, { force: true });
  }
}

const LONG_NAME = "A".repeat(65);
const BAD_NAMES = ["lower", "A-B", "1ABC", "a b", LONG_NAME];

test("POST /vault answers 400 invalid-name without a name detail", async () => {
  const bodies: unknown[] = [
    undefined,
    [],
    {},
    { name: 5 },
    { name: null },
    { name: "" },
    ...BAD_NAMES.map((name) => ({ name, purpose: "p" })),
    { name: "lower", purpose: "", value: "" },
  ];
  for (const body of bodies) {
    await expectBody("POST", "/vault", body, 400, err("invalid-name"));
  }
});

test("POST /vault answers 400 invalid-purpose with the name", async () => {
  const purposes: unknown[] = [
    undefined,
    null,
    5,
    "",
    "   ",
    "a\nb",
    "a\rb",
    "p".repeat(201),
  ];
  for (const purpose of purposes) {
    await expectBody(
      "POST",
      "/vault",
      { name: "ABC", purpose },
      400,
      err("invalid-purpose", "ABC"),
    );
  }
  await expectBody(
    "POST",
    "/vault",
    { name: "ABC", purpose: "", value: "a\nb" },
    400,
    err("invalid-purpose", "ABC"),
  );
});

test("POST /vault answers 400 missing-value and invalid-value with the name", async () => {
  for (const value of ["", 5, null, false]) {
    await expectBody(
      "POST",
      "/vault",
      { name: "ABC", purpose: "p", value },
      400,
      err("missing-value", "ABC"),
    );
  }
  for (const value of ["a\nb", "a\rb", "v".repeat(8193), "é".repeat(4097)]) {
    await expectBody(
      "POST",
      "/vault",
      { name: "ABC", purpose: "p", value },
      400,
      err("invalid-value", "ABC"),
    );
  }
});

test("POST /vault answers 409 name-exists for a duplicate", async () => {
  const created = await call("POST", "/vault", { name: "DUP", purpose: "p" });
  assert.equal(created.status, 200);
  await expectBody(
    "POST",
    "/vault",
    { name: "DUP", purpose: "other" },
    409,
    err("name-exists", "DUP"),
  );
});

test("PUT /vault/:name/value answers 400 invalid-name without a name detail", async () => {
  for (const name of BAD_NAMES) {
    await expectBody(
      "PUT",
      `/vault/${name}/value`,
      { value: "v" },
      400,
      err("invalid-name"),
    );
  }
  await expectBody(
    "PUT",
    "/vault/lower/value",
    { value: "" },
    400,
    err("invalid-name"),
  );
});

test("PUT /vault/:name/value answers 400 missing-value and invalid-value with the name", async () => {
  for (const body of [undefined, [], {}, { value: "" }, { value: 5 }]) {
    await expectBody(
      "PUT",
      "/vault/DUP/value",
      body,
      400,
      err("missing-value", "DUP"),
    );
  }
  for (const value of ["a\nb", "a\rb", "v".repeat(8193)]) {
    await expectBody(
      "PUT",
      "/vault/DUP/value",
      { value },
      400,
      err("invalid-value", "DUP"),
    );
  }
});

test("PUT /vault/:name/value answers 404 not-found with the name", async () => {
  await expectBody(
    "PUT",
    "/vault/NOPE/value",
    { value: "v" },
    404,
    err("not-found", "NOPE"),
  );
});

test("GET value and previous answer 400 invalid-name and 404 not-found with the name", async () => {
  for (const which of ["value", "previous"]) {
    for (const name of BAD_NAMES) {
      await expectBody(
        "GET",
        `/vault/${name}/${which}`,
        undefined,
        400,
        err("invalid-name"),
      );
    }
    await expectBody(
      "GET",
      `/vault/NOPE/${which}`,
      undefined,
      404,
      err("not-found", "NOPE"),
    );
  }
  await expectBody(
    "GET",
    "/vault/DUP/previous",
    undefined,
    404,
    err("not-found", "DUP"),
  );
  await expectBody(
    "GET",
    "/vault/DUP/value",
    undefined,
    404,
    err("not-found", "DUP"),
  );
});

test("PATCH /vault/:name answers 400 invalid-name, 400 invalid-purpose with the name and 404", async () => {
  for (const name of BAD_NAMES) {
    await expectBody(
      "PATCH",
      `/vault/${name}`,
      { purpose: "p" },
      400,
      err("invalid-name"),
    );
  }
  for (const body of [
    undefined,
    [],
    {},
    { purpose: 5 },
    { purpose: "" },
    { purpose: "  " },
    { purpose: "a\nb" },
    { purpose: "a\rb" },
    { purpose: "p".repeat(201) },
  ]) {
    await expectBody(
      "PATCH",
      "/vault/DUP",
      body,
      400,
      err("invalid-purpose", "DUP"),
    );
  }
  await expectBody(
    "PATCH",
    "/vault/NOPE",
    { purpose: "p" },
    404,
    err("not-found", "NOPE"),
  );
});

test("DELETE /vault/:name answers 400 invalid-name and 404 not-found with the name", async () => {
  for (const name of BAD_NAMES) {
    await expectBody(
      "DELETE",
      `/vault/${name}`,
      undefined,
      400,
      err("invalid-name"),
    );
  }
  await expectBody(
    "DELETE",
    "/vault/NOPE",
    undefined,
    404,
    err("not-found", "NOPE"),
  );
});

test("a malformed metadata file answers 500 on every route that reads it", async () => {
  await withCorruptMetadata(async () => {
    await expectBody("GET", "/vault", undefined, 500, err("vault-read-failed"));
    await expectBody(
      "POST",
      "/vault",
      { name: "ABC", purpose: "p" },
      500,
      err("vault-write-failed"),
    );
    await expectBody(
      "PUT",
      "/vault/DUP/value",
      { value: "v" },
      500,
      err("vault-write-failed"),
    );
    await expectBody(
      "PATCH",
      "/vault/DUP",
      { purpose: "p" },
      500,
      err("vault-write-failed"),
    );
    await expectBody(
      "DELETE",
      "/vault/DUP",
      undefined,
      500,
      err("vault-write-failed"),
    );
  });
});

test("POST /vault/import answers 500 vault-import-failed when the metadata is malformed", async () => {
  fs.mkdirSync(path.dirname(paths.ENV_VAULT_SCHEMA_PATH), { recursive: true });
  fs.writeFileSync(paths.ENV_VAULT_SCHEMA_PATH, "ONE=  # first\n");
  try {
    await withCorruptMetadata(() =>
      expectBody(
        "POST",
        "/vault/import",
        undefined,
        500,
        err("vault-import-failed"),
      ),
    );
  } finally {
    fs.rmSync(paths.ENV_VAULT_SCHEMA_PATH, { force: true });
  }
});
