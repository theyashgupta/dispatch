import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { loadPlaybooks, loadPlaybooksForPicker, updatePlaybook, seedPlaybooks } =
  await import("./playbooks.js");
after(() => env.cleanup());

const playbooksDir = path.join(env.dispatchDir, "playbooks");
fs.mkdirSync(playbooksDir, { recursive: true });
const MARKER = "DISPATCH_STATUS:";
const put = (slug: string, text: string): void =>
  fs.writeFileSync(path.join(playbooksDir, `${slug}.md`), text);
const stored = (slug: string): string =>
  fs.readFileSync(path.join(playbooksDir, `${slug}.md`), "utf8");
const bySlug = async (slug: string) =>
  (await loadPlaybooks()).find((p) => p.slug === slug);

void test("front-matter without a when line has no when", async () => {
  put("no-when", "---\nname: No When\n---\nBody");
  assert.equal((await bySlug("no-when"))?.when, undefined);
});

void test("an empty when is dropped and the playbook stays valid", async () => {
  put("empty-when", "---\nname: Empty When\nwhen:   \n---\nBody");
  const p = await bySlug("empty-when");
  assert.ok(p);
  assert.equal(p.when, undefined);
});

void test("a normal when is kept", async () => {
  put("normal-when", "---\nname: Normal When\nwhen: A small fix.\n---\nBody");
  assert.equal((await bySlug("normal-when"))?.when, "A small fix.");
});

void test("a when of exactly 300 characters is kept and 301 is dropped without invalidating", async () => {
  put("w300", `---\nname: W300\nwhen: ${"a".repeat(300)}\n---\nBody`);
  put("w301", `---\nname: W301\nwhen: ${"a".repeat(301)}\n---\nBody`);
  assert.equal((await bySlug("w300"))?.when?.length, 300);
  const long = await bySlug("w301");
  assert.ok(long);
  assert.equal(long.when, undefined);
  const picker = await loadPlaybooksForPicker();
  assert.ok(picker.valid.some((p) => p.slug === "w301"));
});

void test("a when with a colon keeps the text after the first colon", async () => {
  put(
    "colon-when",
    "---\nname: Colon When\nwhen: Use it: always, at 10:30\n---\nBody",
  );
  assert.equal((await bySlug("colon-when"))?.when, "Use it: always, at 10:30");
});

void test("a marker in when is skipped by loadPlaybooks and invalid in the picker", async () => {
  put(
    "marker-when",
    `---\nname: Marker When\nwhen: has ${MARKER} inside\n---\nBody`,
  );
  assert.equal(await bySlug("marker-when"), undefined);
  const picker = await loadPlaybooksForPicker();
  assert.ok(!picker.valid.some((p) => p.slug === "marker-when"));
  assert.deepEqual(
    picker.invalid.find((i) => i.name === "Marker When"),
    { name: "Marker When", reason: "contains a reserved marker" },
  );
});

void test("updatePlaybook keeps the stored when line and refuses a marker in the body", async () => {
  put("keep", "---\nname: Keep\nwhen: Stored when.\n---\nOld");
  const kept = await updatePlaybook("keep", { name: "Keep", body: "New" });
  assert.ok(kept.ok);
  assert.equal(kept.playbook.when, "Stored when.");
  assert.equal(stored("keep"), "---\nname: Keep\nwhen: Stored when.\n---\nNew");
  const bad = await updatePlaybook("keep", { name: "Keep", body: MARKER });
  assert.deepEqual(bad, { ok: false, error: "footgun" });
});

void test("an edited seed file without a when loads with the seed when, and its own when wins", async () => {
  await seedPlaybooks();
  const seedWhen = (await bySlug("prd-ralph-loop"))?.when;
  assert.ok(seedWhen);
  put("prd-ralph-loop", "---\nname: PRD + Ralph Loop\n---\nMy custom body");
  const edited = await bySlug("prd-ralph-loop");
  assert.equal(edited?.body, "My custom body");
  assert.equal(edited?.when, seedWhen);
  const picker = await loadPlaybooksForPicker();
  assert.equal(
    picker.valid.find((p) => p.slug === "prd-ralph-loop")?.when,
    seedWhen,
  );

  put(
    "prd-ralph-loop",
    "---\nname: PRD + Ralph Loop\nwhen: Mine.\n---\nMy custom body",
  );
  assert.equal((await bySlug("prd-ralph-loop"))?.when, "Mine.");
});
