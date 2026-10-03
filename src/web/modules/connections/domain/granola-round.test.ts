import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GRANOLA_POLL_MS,
  granolaCheckLine,
  granolaPollInterval,
} from "./granola-round.js";

test("a running round polls every 5000 ms", () => {
  assert.equal(GRANOLA_POLL_MS, 5000);
  assert.equal(granolaPollInterval({ running: true }), 5000);
});

test("an idle, unknown or missing status does not poll", () => {
  assert.equal(granolaPollInterval({ running: false }), false);
  assert.equal(granolaPollInterval({}), false);
  assert.equal(granolaPollInterval(null), false);
  assert.equal(granolaPollInterval(undefined), false);
});

test("no check result gives no line", () => {
  assert.equal(granolaCheckLine(null), null);
});

test("a connected check names the server", () => {
  assert.equal(
    granolaCheckLine({ state: "connected", server: "granola" }),
    "Connected: granola",
  );
});

test("a failed check gives its error copy", () => {
  assert.equal(
    granolaCheckLine({ state: "needs-auth" }),
    "The Granola connector needs you to sign in. Open Claude Code and authenticate it.",
  );
});
