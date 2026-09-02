import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDraftInput, extractResultText } from "./ticket-generate.js";

const png = {
  bytes: Buffer.from("png-bytes"),
  name: "0123456789abcdef.png",
  ext: "png" as const,
};
const jpg = {
  bytes: Buffer.from("jpg-bytes"),
  name: "fedcba9876543210.jpg",
  ext: "jpg" as const,
};

function parseInput(line: string): {
  type: string;
  message: {
    role: string;
    content: {
      type: string;
      text?: string;
      source?: { type: string; media_type: string; data: string };
    }[];
  };
} {
  assert.ok(line.endsWith("\n"));
  return JSON.parse(line) as ReturnType<typeof parseInput>;
}

test("buildDraftInput with no images is a single text block", () => {
  const msg = parseInput(buildDraftInput("prompt here", []));
  assert.equal(msg.type, "user");
  assert.equal(msg.message.role, "user");
  assert.deepEqual(msg.message.content, [
    { type: "text", text: "prompt here" },
  ]);
});

test("buildDraftInput adds one base64 image block per image with the right media type", () => {
  const msg = parseInput(buildDraftInput("p", [png, jpg]));
  assert.equal(msg.message.content.length, 3);
  assert.deepEqual(msg.message.content[1], {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: png.bytes.toString("base64"),
    },
  });
  assert.equal(msg.message.content[2].source?.media_type, "image/jpeg");
  assert.equal(
    buildDraftInput("p", [
      { bytes: png.bytes, name: "a".repeat(16) + ".webp", ext: "webp" },
    ]).includes('"media_type":"image/webp"'),
    true,
  );
  assert.equal(
    buildDraftInput("p", [
      { bytes: png.bytes, name: "a".repeat(16) + ".gif", ext: "gif" },
    ]).includes('"media_type":"image/gif"'),
    true,
  );
});

const TRANSCRIPT = [
  '{"type":"system","subtype":"init","cwd":"/x","session_id":"s","tools":[],"model":"m"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"## Title\\nT"}]}}',
  '{"type":"result","subtype":"success","is_error":false,"result":"## Title\\nT\\n\\n## Description\\nD","session_id":"s"}',
  "",
].join("\n");

test("extractResultText returns the result event's text", () => {
  assert.equal(
    extractResultText(TRANSCRIPT),
    "## Title\nT\n\n## Description\nD",
  );
});

test("extractResultText throws when no result event is present", () => {
  assert.throws(() =>
    extractResultText(TRANSCRIPT.split("\n").slice(0, 2).join("\n")),
  );
  assert.throws(() => extractResultText("not json at all\n"));
  assert.throws(() => extractResultText(""));
});
