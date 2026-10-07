import assert from "node:assert/strict";
import {
  createDecipheriv,
  createECDH,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { after, beforeEach, mock, test } from "node:test";
import type { Card } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { sendPush, sendPushForCard } = await import("./push-send.js");
await store.load();

after(() => env.cleanup());

interface Sent {
  endpoint: string;
  payload: Record<string, unknown>;
}

const sent: Sent[] = [];
const subscribers = new Map<
  string,
  { ua: ReturnType<typeof createECDH>; auth: Buffer }
>();

function subscribe(endpoint: string, origin: string): void {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  subscribers.set(endpoint, { ua, auth });
  store.addPushSubscription({
    endpoint,
    p256dh: ua.getPublicKey().toString("base64url"),
    auth: auth.toString("base64url"),
    origin,
    createdAt: "2026-10-05T00:00:00.000Z",
  });
}

function decrypt(endpoint: string, body: Buffer): Record<string, unknown> {
  const { ua, auth } = subscribers.get(endpoint)!;
  const salt = body.subarray(0, 16);
  const serverKey = body.subarray(21, 21 + body[20]);
  const record = body.subarray(21 + body[20]);
  const prk = Buffer.from(
    hkdfSync(
      "sha256",
      ua.computeSecret(serverKey),
      auth,
      Buffer.concat([
        Buffer.from("WebPush: info\0"),
        ua.getPublicKey(),
        serverKey,
      ]),
      32,
    ),
  );
  const derive = (info: string, length: number) =>
    Buffer.from(hkdfSync("sha256", prk, salt, Buffer.from(info), length));
  const decipher = createDecipheriv(
    "aes-128-gcm",
    derive("Content-Encoding: aes128gcm\0", 16),
    derive("Content-Encoding: nonce\0", 12),
  );
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  return JSON.parse(plain.subarray(0, plain.length - 1).toString()) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  sent.length = 0;
  for (const sub of store.listPushSubscriptions()) {
    store.removePushSubscription(sub.endpoint);
  }
  mock.method(globalThis, "fetch", (endpoint: string, init: RequestInit) => {
    sent.push({
      endpoint,
      payload: decrypt(endpoint, Buffer.from(init.body as Uint8Array)),
    });
    return Promise.resolve(new Response(null, { status: 201 }));
  });
});

test("sendPush sends the title and body to every subscription", async () => {
  subscribe("https://push.example.com/one", "127.0.0.1:4700");
  subscribe("https://push.example.com/two", "dispatch.example.com");
  await sendPush({ title: "Claude account moved", body: "Work to Personal" });
  assert.deepEqual(sent.map((s) => s.endpoint).sort(), [
    "https://push.example.com/one",
    "https://push.example.com/two",
  ]);
  for (const { payload } of sent) {
    assert.equal(payload.title, "Claude account moved");
    assert.equal(payload.body, "Work to Personal");
    assert.equal(payload.cardId, undefined);
  }
});

test("sendPush turns a url path into a link on each row's own origin", async () => {
  subscribe("https://push.example.com/one", "127.0.0.1:4700");
  subscribe("https://push.example.com/two", "dispatch.example.com");
  await sendPush({ title: "t", body: "b", url: "/#/accounts" });
  const urls = Object.fromEntries(sent.map((s) => [s.endpoint, s.payload.url]));
  assert.equal(
    urls["https://push.example.com/one"],
    "http://127.0.0.1:4700/#/accounts",
  );
  assert.equal(
    urls["https://push.example.com/two"],
    "https://dispatch.example.com/#/accounts",
  );
});

test("sendPush drops the link of a row whose origin smuggles userinfo", async () => {
  subscribe(
    "https://push.example.com/bad",
    "evil.example.com@good.example.com",
  );
  await sendPush({ title: "t", body: "b", url: "/#/accounts" });
  assert.equal(sent[0]?.payload.url, undefined);
});

test("sendPushForCard keeps its card title, fallback body and card link", async () => {
  subscribe("https://push.example.com/one", "127.0.0.1:4700");
  const card = { id: "card-1", identifier: "LOCAL-7" } as Card;
  await sendPushForCard(card, undefined);
  await sendPushForCard(card, "  Pick a file  ");
  assert.equal(sent[0]?.payload.title, "LOCAL-7 - Needs Input");
  assert.equal(sent[0]?.payload.body, "Waiting on your input");
  assert.equal(sent[1]?.payload.body, "Pick a file");
  assert.equal(sent[0]?.payload.cardId, "card-1");
  assert.equal(sent[0]?.payload.url, "http://127.0.0.1:4700/?card=card-1");
});

test("sendPushForCard caps a long reason at 500 characters", async () => {
  subscribe("https://push.example.com/one", "127.0.0.1:4700");
  await sendPushForCard(
    { id: "c", identifier: "L-1" } as Card,
    "x".repeat(900),
  );
  assert.equal((sent[0]?.payload.body as string).length, 500);
});
