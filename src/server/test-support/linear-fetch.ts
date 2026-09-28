import { readFileSync } from "node:fs";
import { DEFAULT_FILTERS } from "../../shared/types.js";
import { LinearSource } from "../sources/linear/linear.source.js";

export interface SentGraphQL {
  query: string;
  variables: Record<string, unknown>;
}

const realFetch = globalThis.fetch;

/**
 * Replace global fetch with a canned Linear response and record every GraphQL body sent.
 *
 * @remarks Pair with {@link restoreFetch} in `afterEach`; no request ever leaves the process.
 */
export function stubLinearFetch(status: number, body: unknown): SentGraphQL[] {
  const sent: SentGraphQL[] = [];
  globalThis.fetch = (_input, init) => {
    sent.push(JSON.parse(init?.body as string) as SentGraphQL);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return sent;
}

/** Put the real global fetch back after {@link stubLinearFetch}. */
export function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

/** Read a recorded GraphQL response body from `src/server/sources/linear/fixtures/`. */
export function linearFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../sources/linear/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  );
}

/** A LinearSource with a fake key and the default filters, for request-shape tests. */
export function testLinearSource(): LinearSource {
  return new LinearSource("fake-key", () => DEFAULT_FILTERS, 60_000);
}

/**
 * Serve queued Linear responses in order, passing requests to `passthrough` URLs to the real fetch.
 *
 * @remarks Route tests run their own loopback server, so only non-loopback calls are stubbed.
 */
export function queueLinearFetch(
  responses: [number, unknown][],
  passthrough = "http://127.0.0.1",
): SentGraphQL[] {
  const real = globalThis.fetch;
  const sent: SentGraphQL[] = [];
  globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith(passthrough)) return real(input, init);
    sent.push(JSON.parse(init?.body as string) as SentGraphQL);
    const [status, body] = responses.shift() ?? [500, {}];
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return sent;
}
