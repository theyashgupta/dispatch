import assert from "node:assert/strict";
import { test } from "node:test";
import { createGithubReposReader } from "./github-repos.js";

function origins(map: Record<string, string | null>) {
  const calls: string[] = [];
  const read = (repoPath: string): Promise<string | null> => {
    calls.push(repoPath);
    return Promise.resolve(map[repoPath] ?? null);
  };
  return { read, calls };
}

test("two repositories with the same remote give one sorted entry", async () => {
  const { read } = origins({
    "/a": "https://github.com/acme/web.git",
    "/b": "git@github.com:acme/web.git",
    "/c": "https://github.com/acme/api",
  });
  const reader = createGithubReposReader(
    () => Promise.resolve(["/a", "/b", "/c"]),
    read,
  );
  assert.deepEqual(await reader(), ["acme/api", "acme/web"]);
});

test("a non-GitHub remote and a repository with no remote are skipped", async () => {
  const { read } = origins({
    "/a": "https://gitlab.com/acme/web.git",
    "/b": null,
    "/c": "https://github.com/acme/api.git",
  });
  const reader = createGithubReposReader(
    () => Promise.resolve(["/a", "/b", "/c"]),
    read,
  );
  assert.deepEqual(await reader(), ["acme/api"]);
});

test("the answer is cached for 10 minutes and read again after", async () => {
  const { read, calls } = origins({ "/a": "https://github.com/acme/api.git" });
  let clock = 1_000;
  const reader = createGithubReposReader(
    () => Promise.resolve(["/a"]),
    read,
    () => clock,
  );
  await reader();
  clock += 9 * 60_000;
  await reader();
  assert.equal(calls.length, 1);
  clock += 60_000;
  await reader();
  assert.equal(calls.length, 2);
});

test("an empty answer is not cached, so a new repository shows at the next poll", async () => {
  const map: Record<string, string | null> = {};
  const { read } = origins(map);
  const paths: string[] = [];
  const reader = createGithubReposReader(() => Promise.resolve(paths), read);
  assert.deepEqual(await reader(), []);
  paths.push("/a");
  map["/a"] = "https://github.com/acme/api.git";
  assert.deepEqual(await reader(), ["acme/api"]);
});
