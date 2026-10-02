import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LICENSE_NAME, REPOSITORY_URL } from "./about-meta.js";

const pkg = JSON.parse(
  readFileSync(new URL("../../../../../package.json", import.meta.url), "utf8"),
) as { license: string; repository: { url: string } };

test("the repository link matches package.json without the .git suffix", () => {
  assert.equal(REPOSITORY_URL, pkg.repository.url.replace(/\.git$/, ""));
});

test("the license name matches package.json", () => {
  assert.equal(LICENSE_NAME, pkg.license);
});
