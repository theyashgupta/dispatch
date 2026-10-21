import assert from "node:assert/strict";
import { test } from "node:test";
import { accountMeta } from "./account-meta.js";

test("a managed Default row reads as a Dispatch login", () => {
  assert.equal(
    accountMeta({ managedDefault: true, isDefault: false, orgName: "Org" }),
    "Default (Dispatch login)",
  );
});

test("the home Default row reads as the home login", () => {
  assert.equal(
    accountMeta({ isDefault: true, orgName: "Org" }),
    "Default (your home login)",
  );
});

test("an added account reads as its organization", () => {
  assert.equal(accountMeta({ isDefault: false, orgName: "Org" }), "Org");
});
