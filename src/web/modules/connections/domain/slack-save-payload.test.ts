import assert from "node:assert/strict";
import { test } from "node:test";
import { slackSavePayload } from "./slack-save-payload.js";

test("the payload carries each picked channel as id and name", () => {
  assert.deepEqual(
    slackSavePayload([
      { id: "C1", name: "general" },
      { id: "C2", name: "random" },
    ]),
    {
      channels: [
        { id: "C1", name: "general" },
        { id: "C2", name: "random" },
      ],
    },
  );
});

test("the payload drops fields beyond id and name", () => {
  const picked = [{ id: "C1", name: "general", private: true }];
  assert.equal(
    JSON.stringify(slackSavePayload(picked)),
    '{"channels":[{"id":"C1","name":"general"}]}',
  );
});

test("an empty pick saves an empty list", () => {
  assert.deepEqual(slackSavePayload([]), { channels: [] });
});
