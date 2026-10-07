import assert from "node:assert/strict";
import { test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { singleFlight } from "./single-flight.js";

test("drops a second call while the first is in flight, then accepts the next", async () => {
  const client = new QueryClient();
  let sent = 0;
  let release: () => void = () => {};
  const observer = new MutationObserver<number, Error, string>(client, {
    mutationFn: () => {
      sent += 1;
      return new Promise<number>((resolve) => {
        release = () => resolve(sent);
      });
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const box = { current: false };
  const settled: (number | undefined)[] = [];
  const mutate = singleFlight<number, Error, string, unknown>(
    box,
    (v: string, o) => {
      void observer.mutate(v, o).catch(() => {});
    },
  );

  mutate("a", { onSettled: (data) => settled.push(data) });
  mutate("b", { onSettled: (data) => settled.push(data) });
  await Promise.resolve();
  assert.equal(sent, 1);

  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(settled, [1]);
  assert.equal(box.current, false);

  mutate("c");
  await Promise.resolve();
  assert.equal(sent, 2);
  release();
  unsubscribe();
});

test("clears the flag after a failed call", async () => {
  const client = new QueryClient();
  const observer = new MutationObserver<number, Error, string>(client, {
    mutationFn: () => Promise.reject(new Error("down")),
  });
  const unsubscribe = observer.subscribe(() => {});
  const box = { current: false };
  let failed = false;
  const mutate = singleFlight<number, Error, string, unknown>(
    box,
    (v: string, o) => {
      void observer.mutate(v, o).catch(() => {});
    },
  );
  mutate("a", { onError: () => (failed = true) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(failed, true);
  assert.equal(box.current, false);

  let retried = false;
  mutate("b", { onError: () => (retried = true) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(retried, true);
  unsubscribe();
});

test("passes the caller's onSuccess through", async () => {
  const client = new QueryClient();
  const observer = new MutationObserver<number, Error, string>(client, {
    mutationFn: (v) => Promise.resolve(v.length),
  });
  const unsubscribe = observer.subscribe(() => {});
  const mutate = singleFlight<number, Error, string, unknown>(
    { current: false },
    (v: string, o) => {
      void observer.mutate(v, o).catch(() => {});
    },
  );
  let got: number | undefined;
  mutate("abc", { onSuccess: (data) => (got = data) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(got, 3);
  unsubscribe();
});
