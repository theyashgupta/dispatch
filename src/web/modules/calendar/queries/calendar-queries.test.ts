import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  CALENDAR_POLL_MS,
  calendarPollQueryOptions,
  prepareTicketMutationOptions,
} from "./calendar-queries.js";
import {
  calendarStatusKeys,
  calendarStatusQueryOptions,
} from "@/queries/calendar-status-queries";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

function reply(status: number, body: unknown): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

test("calendarStatusQueryOptions keys on the calendar status", () => {
  assert.deepEqual(
    calendarStatusQueryOptions().queryKey,
    calendarStatusKeys.status,
  );
});

test("calendarPollQueryOptions polls the status every 30 seconds", () => {
  const options = calendarPollQueryOptions();
  assert.equal(CALENDAR_POLL_MS, 30_000);
  assert.deepEqual(options.queryKey, calendarStatusKeys.status);
  assert.equal(options.refetchInterval, 30_000);
  assert.equal(options.refetchIntervalInBackground, true);
  assert.equal(options.refetchOnMount, "always");
});

test("the shared calendar status query does not poll", () => {
  assert.equal(calendarStatusQueryOptions().refetchInterval, undefined);
});

test("prepareTicketMutationOptions posts the ticket and resolves the card", async () => {
  const card = { id: "c1" };
  reply(201, card);
  const result = await prepareTicketMutationOptions.mutationFn({
    title: "Prepare: Sync",
    description: "Brief",
  });
  assert.deepEqual(result, { ok: true, card });
  assert.equal(calls[0]?.url, "/api/cards");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({
      title: "Prepare: Sync",
      description: "Brief",
      images: [],
    }),
  );
});

test("prepareTicketMutationOptions resolves ok false on a failed status and a network error", async () => {
  reply(500, {});
  assert.deepEqual(
    await prepareTicketMutationOptions.mutationFn({
      title: "T",
      description: "D",
    }),
    { ok: false, error: null },
  );
  globalThis.fetch = () => Promise.reject(new Error("offline"));
  assert.deepEqual(
    await prepareTicketMutationOptions.mutationFn({
      title: "T",
      description: "D",
    }),
    { ok: false, error: null },
  );
});
