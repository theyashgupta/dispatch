import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { loadPlaybooks, updatePlaybook } = await import("./playbooks.js");
after(() => env.cleanup());

const playbooksDir = path.join(env.dispatchDir, "playbooks");
fs.mkdirSync(playbooksDir, { recursive: true });
const put = (slug: string, text: string): void =>
  fs.writeFileSync(path.join(playbooksDir, `${slug}.md`), text);
const bySlug = async (slug: string) =>
  (await loadPlaybooks()).find((p) => p.slug === slug);

void test("tags: review gives one tag", async () => {
  put("one", "---\nname: One\ntags: review\n---\nBody");
  assert.deepEqual((await bySlug("one"))?.tags, ["review"]);
});

void test("tags: review, security gives both tags", async () => {
  put("two", "---\nname: Two\ntags: review, security\n---\nBody");
  assert.deepEqual((await bySlug("two"))?.tags, ["review", "security"]);
});

void test("tags are lower cased, trimmed, deduplicated and empties are dropped", async () => {
  put("messy", "---\nname: Messy\ntags: Review,review, \n---\nBody");
  assert.deepEqual((await bySlug("messy"))?.tags, ["review"]);
});

void test("tags: a bracketed list and quoted tags give plain tags", async () => {
  put("brackets", "---\nname: Brackets\ntags: [review]\n---\nBody");
  assert.deepEqual((await bySlug("brackets"))?.tags, ["review"]);
  put("quoted", "---\nname: Quoted\ntags: [\"Review\", 'security']\n---\nBody");
  assert.deepEqual((await bySlug("quoted"))?.tags, ["review", "security"]);
});

void test("no tags line and an empty tags line give no tags field", async () => {
  put("none", "---\nname: None\n---\nBody");
  put("blank", "---\nname: Blank\ntags:  , \n---\nBody");
  const none = await bySlug("none");
  const blank = await bySlug("blank");
  assert.ok(none && blank);
  assert.equal("tags" in none, false);
  assert.equal("tags" in blank, false);
});

void test("an update keeps the stored tags and when", async () => {
  put(
    "keep",
    "---\nname: Keep\nwhen: Stored.\ntags: review, security\n---\nOld",
  );
  const result = await updatePlaybook("keep", { name: "Keep", body: "New" });
  assert.ok(result.ok);
  assert.deepEqual(result.playbook.tags, ["review", "security"]);
  assert.equal(
    fs.readFileSync(path.join(playbooksDir, "keep.md"), "utf8"),
    "---\nname: Keep\nwhen: Stored.\ntags: review, security\n---\nNew",
  );
  assert.deepEqual((await bySlug("keep"))?.tags, ["review", "security"]);
});
