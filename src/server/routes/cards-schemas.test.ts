import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import {
  attachmentParamsSchema,
  commentBodySchema,
  createCardBodySchema,
  createGroupBodySchema,
  draftBodySchema,
  groupTitleBodySchema,
  linearStateBodySchema,
  moveBodySchema,
  openEditorBodySchema,
  sessionBodySchema,
  startBodySchema,
  syncBodySchema,
  unwindBodySchema,
} from "./cards-schemas.js";

/** The object without its undefined fields, since a caught field may be present as undefined. */
function defined(value: object): object {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  );
}

function firstCode(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 5),
]).toString("base64");
const MARKER = "x DISPATCH_STATUS: DONE";
const MARKER_CODE = "content contains the DISPATCH_STATUS marker";
const MEMBERS = "memberIds must be an array of >=2 distinct card ids";
const COLUMN =
  "invalid column; must be one of: todo, in_progress, needs_input, agent_done, in_review, parked, done, inbox";
const workspace = { folder: "/f", repos: [{ path: "/r", base: "main" }] };

test("commentBodySchema passes a comment through and answers the validator message", () => {
  assert.deepEqual(commentBodySchema.parse({ body: " hi " }), { body: " hi " });
  for (const input of [undefined, [], {}, { body: 5 }, { body: " " }]) {
    assert.equal(firstCode(commentBodySchema, input), "Comment is empty.");
  }
  assert.equal(
    firstCode(commentBodySchema, { body: "a".repeat(20001) }),
    "Comment is longer than 20000 characters.",
  );
  assert.equal(
    firstCode(commentBodySchema, { body: MARKER }),
    "Comment cannot contain DISPATCH_STATUS:.",
  );
});

test("linearStateBodySchema bounds stateId to 1 to 200 UTF-16 units", () => {
  const code = "stateId must be a string of 1 to 200 characters";
  assert.deepEqual(linearStateBodySchema.parse({ stateId: "s".repeat(200) }), {
    stateId: "s".repeat(200),
  });
  for (const input of [undefined, {}, { stateId: 7 }, { stateId: "" }]) {
    assert.equal(firstCode(linearStateBodySchema, input), code);
  }
  assert.equal(
    firstCode(linearStateBodySchema, { stateId: "\u{1F600}".repeat(101) }),
    code,
  );
});

test("moveBodySchema accepts the board columns and the Inbox only", () => {
  assert.deepEqual(moveBodySchema.parse({ column: "inbox" }), {
    column: "inbox",
  });
  assert.deepEqual(moveBodySchema.parse({ column: "done", x: 1 }), {
    column: "done",
  });
  for (const input of [undefined, [], {}, { column: "Done" }, { column: 1 }]) {
    assert.equal(firstCode(moveBodySchema, input), COLUMN);
  }
});

test("startBodySchema reads every field leniently and forms the workspace", () => {
  const empty = { extraDirection: "", newSession: false };
  for (const input of [undefined, [], "x", {}]) {
    assert.deepEqual(defined(startBodySchema.parse(input)), empty);
  }
  assert.deepEqual(
    defined(
      startBodySchema.parse({
        extraDirection: 5,
        playbook: 5,
        newSession: "true",
        inheritFrom: 5,
        folder: "/f",
        repos: [],
      }),
    ),
    empty,
  );
  assert.deepEqual(
    startBodySchema.parse({
      extraDirection: "go",
      playbook: "p",
      newSession: true,
      inheritFrom: "s1",
      folder: "/f",
      repos: [{ base: "main", path: "/r", extra: 1 }],
    }),
    {
      extraDirection: "go",
      playbook: "p",
      newSession: true,
      inheritFrom: "s1",
      workspace,
    },
  );
  for (const repos of [[null], [["a"]], [{ path: "/r" }], "a"]) {
    assert.equal(
      startBodySchema.parse({ folder: "/f", repos }).workspace,
      undefined,
    );
  }
});

test("sessionBodySchema needs a non-empty sessionId", () => {
  assert.deepEqual(sessionBodySchema.parse({ sessionId: "s" }), {
    sessionId: "s",
  });
  for (const input of [undefined, {}, { sessionId: "" }, { sessionId: 1 }]) {
    assert.equal(firstCode(sessionBodySchema, input), "invalid sessionId");
  }
});

test("openEditorBodySchema accepts code and cursor only", () => {
  assert.deepEqual(openEditorBodySchema.parse({ editor: "cursor" }), {
    editor: "cursor",
  });
  for (const input of [undefined, {}, { editor: "vim" }]) {
    assert.equal(
      firstCode(openEditorBodySchema, input),
      "invalid editor; must be one of: code, cursor",
    );
  }
});

test("createGroupBodySchema checks the title, then the marker, then the member ids", () => {
  assert.deepEqual(
    defined(
      createGroupBodySchema.parse({
        title: " grp ",
        memberIds: ["a", "b"],
        playbook: 5,
        ...workspace,
      }),
    ),
    { title: "grp", memberIds: ["a", "b"], extraDirection: "", workspace },
  );
  for (const input of [
    undefined,
    [],
    {},
    { title: " ", memberIds: [] },
    { title: `${MARKER}${"t".repeat(300)}` },
  ]) {
    assert.equal(firstCode(createGroupBodySchema, input), "invalid-title");
  }
  assert.equal(
    firstCode(createGroupBodySchema, { title: MARKER, memberIds: [] }),
    MARKER_CODE,
  );
  for (const memberIds of [undefined, ["a"], ["a", 1], ["a", "a"]]) {
    assert.equal(
      firstCode(createGroupBodySchema, { title: "t", memberIds }),
      MEMBERS,
    );
  }
  assert.equal(
    createGroupBodySchema.parse({ title: "t", memberIds: ["a", "b"] })
      .workspace,
    undefined,
  );
});

test("unwindBodySchema defaults an absent destination to To Do", () => {
  for (const input of [undefined, [], {}]) {
    assert.deepEqual(unwindBodySchema.parse(input), { to: "todo" });
  }
  assert.deepEqual(unwindBodySchema.parse({ to: "inbox" }), { to: "inbox" });
  for (const to of [null, "", "done", 1]) {
    assert.equal(
      firstCode(unwindBodySchema, { to }),
      "to must be todo or inbox",
    );
  }
});

test("draftBodySchema checks the direction before the images", () => {
  const parsed = draftBodySchema.parse({ direction: " d ", images: [PNG] });
  assert.equal(parsed.direction, "d");
  assert.equal(parsed.images.length, 1);
  assert.deepEqual(draftBodySchema.parse({ direction: "d" }).images, []);
  for (const input of [
    undefined,
    { direction: " " },
    { direction: "d".repeat(10001), images: "x" },
  ]) {
    assert.equal(firstCode(draftBodySchema, input), "invalid-direction");
  }
  for (const images of [null, "x", [5], [""]]) {
    assert.equal(
      firstCode(draftBodySchema, { direction: "d", images }),
      "invalid-images",
    );
  }
});

test("groupTitleBodySchema needs 2 to 50 distinct string ids", () => {
  const ids = Array.from({ length: 50 }, (_, i) => `id-${i}`);
  assert.deepEqual(groupTitleBodySchema.parse({ memberIds: ids }), {
    memberIds: ids,
  });
  for (const memberIds of [
    undefined,
    ["a"],
    ["a", "a"],
    ["a", 1],
    [...ids, "id-50"],
  ]) {
    assert.equal(
      firstCode(groupTitleBodySchema, { memberIds }),
      "invalid-member-ids",
    );
  }
});

test("createCardBodySchema checks title, description, marker, images, then the full length", () => {
  assert.deepEqual(
    createCardBodySchema.parse({ title: " t ", description: " d " }),
    {
      title: "t",
      fullDescription: "d",
      images: [],
    },
  );
  const withImage = createCardBodySchema.parse({
    title: "t",
    description: "d",
    images: [PNG],
  });
  assert.match(
    withImage.fullDescription,
    /^d\n\n## Screenshots\n\n!\[screenshot 1\]/,
  );
  assert.equal(firstCode(createCardBodySchema, undefined), "invalid-title");
  assert.equal(
    firstCode(createCardBodySchema, { title: MARKER, description: 5 }),
    "invalid-description",
  );
  assert.equal(
    firstCode(createCardBodySchema, {
      title: "t",
      description: MARKER,
      images: "x",
    }),
    MARKER_CODE,
  );
  assert.equal(
    firstCode(createCardBodySchema, {
      title: "t",
      description: "d",
      images: {},
    }),
    "invalid-images",
  );
  assert.equal(
    firstCode(createCardBodySchema, {
      title: "t",
      description: "d".repeat(19990),
      images: [PNG],
    }),
    "invalid-description",
  );
});

test("attachmentParamsSchema checks the card id and the file name", () => {
  const name = "0123456789abcdef.png";
  assert.deepEqual(attachmentParamsSchema.parse({ id: "LOCAL-1", name }), {
    id: "LOCAL-1",
    name,
  });
  for (const params of [
    { id: "a.b", name },
    { id: "LOCAL-1", name: "x.png" },
    { id: "LOCAL-1", name: "../0123456789abcdef.png" },
  ]) {
    assert.equal(
      firstCode(attachmentParamsSchema, params),
      "invalid-attachment",
    );
  }
});

test("syncBodySchema forms the direct target only from a non-empty teamId", () => {
  for (const input of [undefined, [], {}, { teamId: "" }, { teamId: 5 }]) {
    assert.equal(syncBodySchema.parse(input), undefined);
  }
  assert.deepEqual(syncBodySchema.parse({ teamId: "t", stateId: "" }), {
    teamId: "t",
  });
  assert.deepEqual(syncBodySchema.parse({ stateId: "s", teamId: "t" }), {
    teamId: "t",
    stateId: "s",
  });
});
