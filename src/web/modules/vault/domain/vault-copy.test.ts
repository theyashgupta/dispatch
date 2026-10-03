import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vaultAddErrorCopy,
  vaultPurposeErrorCopy,
  vaultValueErrorCopy,
} from "./vault-copy.js";

test("add errors map to their copy and unknown codes to the fallback", () => {
  assert.match(vaultAddErrorCopy("invalid-name"), /uppercase letters/);
  assert.equal(
    vaultAddErrorCopy("name-exists"),
    "A key with this name already exists.",
  );
  assert.equal(
    vaultAddErrorCopy("invalid-purpose"),
    "Enter a one-line purpose.",
  );
  assert.equal(vaultAddErrorCopy("nope"), "Couldn't add key, try again.");
});

test("value errors map to their copy and unknown codes to the fallback", () => {
  assert.equal(vaultValueErrorCopy("missing-value"), "Enter a value.");
  assert.match(vaultValueErrorCopy("invalid-value"), /single line/);
  assert.match(vaultValueErrorCopy("not-found"), /no longer exists/);
  assert.equal(vaultValueErrorCopy("nope"), "Couldn't save value, try again.");
});

test("purpose errors map to their copy and unknown codes to the fallback", () => {
  assert.equal(
    vaultPurposeErrorCopy("invalid-purpose"),
    "Enter a one-line purpose.",
  );
  assert.match(vaultPurposeErrorCopy("not-found"), /no longer exists/);
  assert.equal(
    vaultPurposeErrorCopy("nope"),
    "Couldn't update purpose, try again.",
  );
});
