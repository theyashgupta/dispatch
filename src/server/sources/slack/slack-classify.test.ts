import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyMessage } from "./slack-message.js";

const ME = "U0G6USER";
const msg = (extra: Record<string, unknown>) => ({
  ts: "1700000000.000100",
  user: "U0G6ANA",
  text: "hello",
  ...extra,
});

test("a channel message with either mention encoding is a mention", () => {
  assert.equal(
    classifyMessage(msg({ text: `ping <@${ME}> please` }), "channel", ME),
    "mention",
  );
  assert.equal(
    classifyMessage(msg({ text: `ping <@${ME}|g6-tester>` }), "channel", ME),
    "mention",
  );
});

test("a message from someone else in an im or an mpim is a dm", () => {
  assert.equal(classifyMessage(msg({}), "im", ME), "dm");
  assert.equal(classifyMessage(msg({}), "mpim", ME), "dm");
});

test("a plain channel message and a mention of someone else are dropped", () => {
  assert.equal(classifyMessage(msg({}), "channel", ME), null);
  assert.equal(
    classifyMessage(msg({ text: "<@U0G6BEN> look" }), "channel", ME),
    null,
  );
  assert.equal(
    classifyMessage(msg({ text: `<@${ME}X> near miss` }), "channel", ME),
    null,
  );
});

test("own, bot and user-less messages are dropped, even in a DM", () => {
  assert.equal(classifyMessage(msg({ user: ME }), "im", ME), null);
  assert.equal(classifyMessage(msg({ bot_id: "B1" }), "im", ME), null);
  assert.equal(classifyMessage(msg({ user: undefined }), "im", ME), null);
  assert.equal(
    classifyMessage(msg({ user: ME, text: `<@${ME}>` }), "channel", ME),
    null,
  );
});

test("thread_broadcast and file_share keep their mention; every other subtype is dropped", () => {
  const text = `<@${ME}> see this`;
  assert.equal(
    classifyMessage(msg({ text, subtype: "thread_broadcast" }), "channel", ME),
    "mention",
  );
  assert.equal(
    classifyMessage(msg({ text, subtype: "file_share" }), "channel", ME),
    "mention",
  );
  for (const subtype of [
    "channel_join",
    "pinned_item",
    "channel_topic",
    "bot_message",
  ]) {
    assert.equal(classifyMessage(msg({ text, subtype }), "channel", ME), null);
  }
  assert.equal(
    classifyMessage(msg({ subtype: "channel_join" }), "im", ME),
    null,
  );
});
