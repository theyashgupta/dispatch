import assert from "node:assert/strict";
import { test } from "node:test";
import {
  carriesSyncToken,
  syncToken,
  withoutSyncTokens,
} from "./sync-token.js";

test("the token is matched only as a whole line", () => {
  const token = syncToken("LOCAL-1");
  assert.equal(carriesSyncToken(`Body\n\n${token}`, token), true);
  assert.equal(carriesSyncToken(`Body\n\n${token}  `, token), true);
  assert.equal(
    carriesSyncToken("Body\n\ndispatch-sync:LOCAL-12", token),
    false,
  );
  assert.equal(carriesSyncToken(`see ${token} above`, token), false);
  assert.equal(carriesSyncToken(null, token), false);
});

test("every sync token line is dropped from an outgoing description", () => {
  assert.equal(
    withoutSyncTokens(
      "Body\n dispatch-sync:LOCAL-7 \nMore\n\ndispatch-sync:LOCAL-8",
    ),
    "Body\nMore",
  );
  assert.equal(
    withoutSyncTokens("see dispatch-sync:LOCAL-7 inline"),
    "see dispatch-sync:LOCAL-7 inline",
  );
  assert.equal(withoutSyncTokens("dispatch-sync:LOCAL-7"), "");
});
