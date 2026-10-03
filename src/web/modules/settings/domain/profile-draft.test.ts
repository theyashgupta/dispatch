import assert from "node:assert/strict";
import { test } from "node:test";
import { toProfileDraft } from "./profile-draft.js";

void test("an empty profile gives an empty draft", () => {
  assert.deepEqual(toProfileDraft({}), {
    name: "",
    email: "",
    handles: "",
    role: "",
    brief: "",
  });
});

void test("a stored profile fills every field and joins the handles", () => {
  assert.deepEqual(
    toProfileDraft({
      name: "Ada",
      email: "ada@example.com",
      handles: ["ada", "@lovelace"],
      role: "Engineer",
      brief: "Notes",
    }),
    {
      name: "Ada",
      email: "ada@example.com",
      handles: "ada, @lovelace",
      role: "Engineer",
      brief: "Notes",
    },
  );
});
