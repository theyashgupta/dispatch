import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { seedPlaybooks, loadPlaybooks, hasDispatchMarker } =
  await import("./playbooks.js");
after(() => env.cleanup());

const playbooksDir = path.join(env.dispatchDir, "playbooks");
const fixturePath = path.join(
  import.meta.dirname,
  "../../test-support/fixtures/playbooks/board-orchestrator-v450.md",
);
const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");
const read = (slug: string): string =>
  fs.readFileSync(path.join(playbooksDir, `${slug}.md`), "utf8");
const write = (slug: string, text: string): void =>
  fs.writeFileSync(path.join(playbooksDir, `${slug}.md`), text);

const D9_RULES = [
  "1. Writes or edits product code or any file in a repository.",
  "2. Commits, pushes, merges or rebases outside the ship flow of D-8.",
  "3. Selects usage credits.",
  "4. Reads the vault or an env file.",
  "5. Changes a policy, its own or another one.",
  "6. Kills a process or a port holder.",
  "7. Starts a loop above the concurrency cap.",
  "8. Acts on another board, or on a card outside its scope (D-7).",
  "9. Answers its own decision item, or approves a permission prompt.",
  "10. Deletes a branch, a worktree or a card that it did not create.",
];

await seedPlaybooks();
const all = await loadPlaybooks();
const orchestrator = all.find((p) => p.name === "Board Orchestrator");

void test("the seed adds the Roadmap Loop and the Board Orchestrator to the four earlier playbooks", () => {
  assert.equal(all.length, 6);
  assert.ok(orchestrator);
  assert.equal(orchestrator.slug, "board-orchestrator");
});

void test("the body holds the extra direction slot and a Workflow section", () => {
  assert.ok(orchestrator);
  assert.ok(orchestrator.body.startsWith("## Extra direction\n{extra}\n"));
  assert.ok(orchestrator.body.includes("\n## Workflow\n"));
});

void test("the body introduces the ten D-9 rules with An orchestrator never: and holds each one verbatim", () => {
  assert.ok(orchestrator);
  const lines = orchestrator.body.split("\n");
  const at = lines.indexOf("An orchestrator never:");
  assert.ok(at > 0);
  assert.deepEqual(lines.slice(at + 1, at + 11), D9_RULES);
});

void test("the body holds the loader duties", () => {
  assert.ok(orchestrator);
  const body = orchestrator.body;
  for (const part of [
    "Call read_state first.",
    "Your state lives in the tools, never in your memory.",
    "get_rulebook",
    "A user turn typed in your terminal is a direction from the user.",
    "Dispatch wake:",
    "End every turn with wait_for_event.",
    "HANDOFF_READY",
    "write_state",
    "data.orchestratorId",
  ]) {
    assert.ok(body.includes(part), part);
  }
});

void test("the body carries no status marker, no em dash and no double hyphen", () => {
  assert.ok(orchestrator);
  assert.equal(hasDispatchMarker(orchestrator.body), false);
  assert.doesNotMatch(orchestrator.body, /\u2014/);
  assert.equal(orchestrator.body.includes("-".repeat(2)), false);
});

const currentOrchestrator = read("board-orchestrator");
const currentPrd = read("prd-ralph-loop");

void test("each seeded playbook has a non-empty when", () => {
  for (const p of all) assert.ok(p.when && p.when.length > 0, p.name);
});

void test("the Roadmap Loop seed sits before the Board Orchestrator and holds its workflow", () => {
  const roadmap = all.find((p) => p.name === "Roadmap Loop");
  assert.equal(roadmap?.slug, "roadmap-loop");
  assert.ok(
    roadmap?.body.includes("Run the roadmap-loop skill on the roadmap."),
  );
});

void test("a v4.5.0 Board Orchestrator file is rewritten with the current seed", async () => {
  const old = fs.readFileSync(fixturePath, "utf8");
  assert.equal(
    sha256(old),
    "20ec6f18f070b4abd7a6677127bcd9955140bb7a465f6a08253e88772c75f057",
  );
  write("board-orchestrator", old);
  await seedPlaybooks();
  assert.equal(read("board-orchestrator"), currentOrchestrator);
});

void test("an edited seed file stays byte for byte", async () => {
  const edited = `${currentPrd}\nMy own extra line.\n`;
  write("prd-ralph-loop", edited);
  await seedPlaybooks();
  assert.equal(read("prd-ralph-loop"), edited);
  write("prd-ralph-loop", currentPrd);
});

void test("a user file at the roadmap-loop slug before the first seed stays as it is", async () => {
  const mine = "---\nname: My roadmap\n---\nMine.";
  fs.unlinkSync(path.join(playbooksDir, "roadmap-loop.md"));
  const tombstone = path.join(playbooksDir, ".seeded.json");
  const slugs = (
    JSON.parse(fs.readFileSync(tombstone, "utf8")) as string[]
  ).filter((s) => s !== "roadmap-loop");
  fs.writeFileSync(tombstone, JSON.stringify(slugs));
  write("roadmap-loop", mine);
  await seedPlaybooks();
  assert.equal(read("roadmap-loop"), mine);
});

void test("a second seed call rewrites nothing", async () => {
  const names = fs.readdirSync(playbooksDir).filter((n) => n.endsWith(".md"));
  const before = names.map(
    (n) => fs.statSync(path.join(playbooksDir, n)).mtimeMs,
  );
  const contents = names.map((n) =>
    fs.readFileSync(path.join(playbooksDir, n), "utf8"),
  );
  await seedPlaybooks();
  assert.deepEqual(
    names.map((n) => fs.statSync(path.join(playbooksDir, n)).mtimeMs),
    before,
  );
  assert.deepEqual(
    names.map((n) => fs.readFileSync(path.join(playbooksDir, n), "utf8")),
    contents,
  );
});

void test("a retired seed file whose upgrade write fails does not reject the seed and logs a warning", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root ignores directory permissions");
    return;
  }
  const old = fs.readFileSync(fixturePath, "utf8");
  write("board-orchestrator", old);
  const warn = t.mock.method(console, "warn", () => undefined);
  fs.chmodSync(playbooksDir, 0o555);
  try {
    await seedPlaybooks();
  } finally {
    fs.chmodSync(playbooksDir, 0o700);
  }
  assert.equal(read("board-orchestrator"), old);
  const messages = warn.mock.calls.map((c) => String(c.arguments[0]));
  assert.equal(
    messages.filter((m) =>
      m.startsWith("[playbooks] could not upgrade seed board-orchestrator"),
    ).length,
    1,
  );
  write("board-orchestrator", currentOrchestrator);
});
