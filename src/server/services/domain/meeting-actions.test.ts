import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  buildMeetingItems,
  buildPastePrompt,
  isActionKey,
  isMeetingId,
  localDate,
  meetingId,
  meetingSlug,
  parseActionItems,
  type ActionDraft,
} from "./meeting-actions.js";

const NOW = "2026-09-25T10:00:00.000Z";

function nameHash(name: string): string {
  return createHash("sha1")
    .update(name.trim().toLowerCase())
    .digest("hex")
    .slice(0, 7);
}

function section(key: string, title: string, body = "> quoted line"): string {
  return `## Action item\nkey: ${key}\ntitle: ${title}\n\n${body}\n`;
}

function draft(key: string, title = `Do ${key}`): ActionDraft {
  return { key, title, description: `About ${key}` };
}

test("the prompt names the user when a name is given", () => {
  const prompt = buildPastePrompt("Design review", "notes body", "Sam");
  assert.match(
    prompt,
    /^You are extracting action items from meeting notes for Dispatch, a local task board\./,
  );
  assert.ok(prompt.includes("The user appears in these notes as: Sam."));
  assert.ok(!prompt.includes("The user is the person who took these notes."));
  assert.ok(
    prompt.includes(
      '- Then a blank line and a markdown description that names the meeting "Design review" and quotes the relevant lines from the notes as a blockquote.',
    ),
  );
  assert.ok(
    prompt.includes(
      "- If the notes hold no action item for the user, output exactly: NO_ACTION_ITEMS",
    ),
  );
  assert.ok(
    prompt.includes(
      '- Never emit the literal text "DISPATCH_STATUS:" anywhere in your output.',
    ),
  );
  assert.ok(prompt.endsWith("Meeting: Design review\nNotes:\nnotes body"));
});

test("the prompt treats the note-taker as the user without a name", () => {
  const prompt = buildPastePrompt("Sync", "n", "  ");
  assert.ok(
    prompt.includes(
      "The user is the person who took these notes. Treat first-person lines (I, me, my) and unassigned follow-ups as the user's.",
    ),
  );
  assert.ok(!prompt.includes("The user appears in these notes as:"));
});

test("the whole prompt matches the PRD contract line for line", () => {
  assert.equal(
    buildPastePrompt("Weekly sync", "line one\nline two", "Sam"),
    [
      "You are extracting action items from meeting notes for Dispatch, a local task board.",
      "List only the action items that belong to the user: commitments the user made, questions directed at the user, and decisions the user must act on. Skip items owned by other people.",
      "The user appears in these notes as: Sam.",
      "",
      "Output rules (follow exactly):",
      "- Output only repeated sections, at most 15, with no preamble, no closing remarks and no code fence.",
      "- Each section starts with the literal line: ## Action item",
      "- Then the line key: <a short kebab-case slug of the action's subject, lowercase letters, digits and hyphens only, at most 48 characters>",
      "- Then the line title: <one plain-text line under 120 characters that starts with a verb>",
      '- Then a blank line and a markdown description that names the meeting "Weekly sync" and quotes the relevant lines from the notes as a blockquote.',
      "- If the notes hold no action item for the user, output exactly: NO_ACTION_ITEMS",
      '- Never emit the literal text "DISPATCH_STATUS:" anywhere in your output.',
      "",
      "Meeting: Weekly sync",
      "Notes:",
      "line one",
      "line two",
    ].join("\n"),
  );
});

test("CRLF output and a 300-character title parse", () => {
  const out = section("crlf-item", "t".repeat(300)).replace(/\n/g, "\r\n");
  const [only] = parseActionItems(out);
  assert.equal(only.key, "crlf-item");
  assert.equal(only.title.length, 300);
  assert.equal(only.description, "> quoted line");
});

test("three valid sections parse to three drafts in order", () => {
  const out = [
    "Here are your items:",
    section("send-report", "Send the report"),
    section("fix-login", "Fix the login bug"),
    section("book-room", "Book the room"),
  ].join("\n");
  const drafts = parseActionItems(out);
  assert.deepEqual(
    drafts.map((d) => [d.key, d.title, d.description]),
    [
      ["send-report", "Send the report", "> quoted line"],
      ["fix-login", "Fix the login bug", "> quoted line"],
      ["book-room", "Book the room", "> quoted line"],
    ],
  );
});

test("field names are read case-insensitively and optional fields are kept", () => {
  const out =
    "## Action item\nKEY: ship-it\nTitle: Ship it\nMeeting: Weekly sync\ndate: 2026-09-18\nlink: https://x.test/m\n\nbody";
  assert.deepEqual(parseActionItems(out), [
    {
      key: "ship-it",
      title: "Ship it",
      description: "body",
      meeting: "Weekly sync",
      date: "2026-09-18",
      link: "https://x.test/m",
    },
  ]);
});

test("NO_ACTION_ITEMS parses to an empty list", () => {
  assert.deepEqual(parseActionItems("  NO_ACTION_ITEMS\n"), []);
  assert.deepEqual(parseActionItems("```\nNO_ACTION_ITEMS\n```\n"), []);
});

test("a section carrying the status marker is dropped", () => {
  const out = [
    section("good", "Keep this"),
    section("bad-title", "DISPATCH_STATUS: done"),
    section("bad-body", "Fine title", "DISPATCH_STATUS: needs_input"),
  ].join("\n");
  assert.deepEqual(
    parseActionItems(out).map((d) => d.key),
    ["good"],
  );
});

test("invalid keys, titles and bodies are dropped", () => {
  const out = [
    section("Upper-Case", "A"),
    section("has space", "B"),
    section("a".repeat(49), "C"),
    section("ok-key", ""),
    section("long-title", "x".repeat(301)),
    "## Action item\nkey: no-body\ntitle: No body\n\n",
    section("a".repeat(48), "Kept at the limit"),
  ].join("\n");
  assert.deepEqual(
    parseActionItems(out).map((d) => d.key),
    ["a".repeat(48)],
  );
});

test("a duplicate key keeps the first section", () => {
  const out = [section("same", "First"), section("same", "Second")].join("\n");
  assert.deepEqual(
    parseActionItems(out).map((d) => d.title),
    ["First"],
  );
});

test("twenty valid sections yield fifteen", () => {
  const out = Array.from({ length: 20 }, (_, i) =>
    section(`item-${i}`, `Item ${i}`),
  ).join("\n");
  const drafts = parseActionItems(out);
  assert.equal(drafts.length, 15);
  assert.equal(drafts[14].key, "item-14");
});

test("prose with no section header throws", () => {
  assert.throws(() => parseActionItems("I could not find anything."));
});

test("output whose every section was dropped throws", () => {
  assert.throws(() =>
    parseActionItems(section("BAD", "x") + section("ok", "DISPATCH_STATUS: x")),
  );
});

test("the meeting slug is a readable prefix of at most 32 characters plus a name hash", () => {
  assert.equal(
    meetingSlug("Weekly Sync!"),
    `weekly-sync-${nameHash("Weekly Sync!")}`,
  );
  assert.equal(meetingSlug("!!!"), `meeting-${nameHash("!!!")}`);
  assert.equal(
    meetingSlug(`${"a".repeat(31)} bcd`),
    `${"a".repeat(31)}-${nameHash(`${"a".repeat(31)} bcd`)}`,
  );
  for (const name of ["x ".repeat(60), "週次定例", `${"b".repeat(80)}`]) {
    assert.match(meetingSlug(name), /^[a-z0-9-]{1,40}$/);
  }
});

test("meetings whose slugs would collide stay distinct", () => {
  assert.notEqual(meetingSlug("週次定例"), meetingSlug("採用面接"));
  const base = "Project Phoenix weekly status sync with";
  assert.notEqual(meetingSlug(`${base} Design`), meetingSlug(`${base} Data`));
  assert.equal(meetingSlug("Design review"), meetingSlug(" design REVIEW "));
});

test("the meeting id carries the feed, the date and the slug", () => {
  assert.equal(
    meetingId("paste", "2026-09-25", "Design review"),
    `paste:2026-09-25-design-review-${nameHash("Design review")}`,
  );
});

test("isMeetingId accepts the id of a 200-character meeting name", () => {
  assert.ok(isMeetingId(meetingId("granola", "2026-09-25", "x".repeat(200))));
});

test("local date is YYYY-MM-DD in local time", () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("a weekly meeting's repeated action gets a new id each week", () => {
  const week = (date: string) =>
    buildMeetingItems({
      feed: "granola",
      meeting: "Weekly sync",
      meetingDate: date,
      drafts: [draft("send-report")],
      now: NOW,
    })[0].id;
  assert.equal(
    week("2026-09-18"),
    `meeting:granola:2026-09-18-weekly-sync-${nameHash("Weekly sync")}:send-report`,
  );
  assert.notEqual(week("2026-09-18"), week("2026-09-25"));
});

test("items carry the meta keys, the snippet and siblings without self", () => {
  const items = buildMeetingItems({
    feed: "paste",
    meeting: "Design review",
    meetingDate: "2026-09-25",
    drafts: [draft("a", "Do A"), draft("b", "Do B"), draft("c", "Do C")],
    now: NOW,
  });
  assert.equal(items.length, 3);
  const b = items[1];
  const id = `paste:2026-09-25-design-review-${nameHash("Design review")}`;
  assert.equal(b.id, `meeting:${id}:b`);
  assert.equal(b.source, "meeting");
  assert.equal(b.type, "action_item");
  assert.equal(b.title, "Do B");
  assert.equal(b.priority, 76);
  assert.equal(b.state, "unread");
  assert.equal(b.createdAt, NOW);
  assert.equal(b.snippet, "From Design review on 2026-09-25.\n\nAbout b");
  assert.deepEqual(b.meta, {
    feed: "paste",
    meeting: "Design review",
    meetingDate: "2026-09-25",
    meetingId: id,
    key: "b",
    siblings: JSON.stringify(["Do A", "Do C"]),
  });
});

test("siblings are capped at 14 and the snippet at 20000 characters", () => {
  const drafts = Array.from({ length: 16 }, (_, i) => draft(`k${i}`));
  drafts[0] = { ...drafts[0], description: "x".repeat(30000) };
  const items = buildMeetingItems({
    feed: "paste",
    meeting: "M",
    meetingDate: "2026-09-25",
    drafts,
    now: NOW,
  });
  assert.equal((JSON.parse(items[0].meta.siblings) as string[]).length, 14);
  assert.equal(items[0].snippet.length, 20000);
});

test("a blank line after the header, a capitalised header and a code fence are tolerated", () => {
  const out = [
    "```markdown",
    "## Action Item",
    "",
    "key: first",
    "title: First",
    "",
    "body one",
    "## action item",
    "key: second",
    "title: Second",
    "",
    "body two",
    "```",
  ].join("\n");
  assert.deepEqual(
    parseActionItems(out).map((d) => [d.key, d.description]),
    [
      ["first", "body one"],
      ["second", "body two"],
    ],
  );
});

test("the cap comes from the options object", () => {
  const out = Array.from({ length: 5 }, (_, i) =>
    section(`k-${i}`, `T ${i}`),
  ).join("\n");
  assert.equal(parseActionItems(out, { max: 2 }).length, 2);
});

test("a description longer than 20000 characters is cut, not dropped", () => {
  const drafts = parseActionItems(
    section("long", "Long quote", "x".repeat(25000)),
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].description.length, 20000);
});

test("a code fence with any word tag is ignored", () => {
  const out = [
    "```MARKDOWN",
    section("a", "A"),
    "```md2",
    section("b", "B"),
    "```",
  ].join("\n");
  assert.deepEqual(
    parseActionItems(out).map((d) => d.key),
    ["a", "b"],
  );
});

test("isActionKey accepts kebab keys up to 48 characters only", () => {
  assert.equal(isActionKey("send-report"), true);
  assert.equal(isActionKey("a".repeat(48)), true);
  assert.equal(isActionKey("a".repeat(49)), false);
  assert.equal(isActionKey("Bad-Key"), false);
  assert.equal(isActionKey("trailing-"), false);
});

test("granola items use the granola id and keep only an https link as the url", () => {
  const links = [
    "https://notes.granola.ai/d/abc",
    "http://x",
    "javascript:x",
    "none",
    "https://sso.example.com@evil.example/",
  ];
  const items = buildMeetingItems({
    feed: "granola",
    meeting: "Weekly sync",
    meetingDate: "2026-09-24",
    drafts: links.map((link, i) => ({ ...draft(`k${i}`), link })),
    now: NOW,
  });
  assert.equal(
    items[0].id,
    `meeting:granola:2026-09-24-weekly-sync-${nameHash("Weekly sync")}:k0`,
  );
  assert.equal(items[0].meta.feed, "granola");
  assert.deepEqual(
    items.map((i) => i.url),
    [
      "https://notes.granola.ai/d/abc",
      undefined,
      undefined,
      undefined,
      undefined,
    ],
  );
  assert.ok(items.slice(1).every((i) => !("url" in i)));
});
