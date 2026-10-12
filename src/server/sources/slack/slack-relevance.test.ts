import assert from "node:assert/strict";
import { test } from "node:test";
import { slackRelevance } from "./slack-relevance.js";

interface Fixture {
  name: string;
  text: string;
  subtype?: string;
  botId?: string;
  needsSession: boolean;
  reason: string;
}

const BULLETS = "Daily report\n- build ok\n- tests ok\n- deploy ok\n- lint ok";
const REQUEST = "Request with an action verb: ";

const FIXTURES: Fixture[] = [
  {
    name: "ticket fixture: request phrase without a question mark",
    text: "can you check why the deploy failed",
    needsSession: true,
    reason: `${REQUEST}can you`,
  },
  {
    name: "a thanks with punctuation is an acknowledgement",
    text: "thanks!",
    needsSession: false,
    reason: "Acknowledgement",
  },
  {
    name: "a bot digest is a bot message first",
    text: BULLETS,
    botId: "B1",
    needsSession: false,
    reason: "Bot or app message",
  },
  {
    name: "a bot subtype without a bot id is a bot message",
    text: "can you check this?",
    subtype: "bot_message",
    needsSession: false,
    reason: "Bot or app message",
  },
  {
    name: "a digest by shape from a human",
    text: BULLETS,
    needsSession: false,
    reason: "Digest",
  },
  {
    name: "a digest by word",
    text: "Here is the weekly summary of the board",
    needsSession: false,
    reason: "Digest",
  },
  {
    name: "four bullets in four lines are not a digest",
    text: "- one\n- two\n- three\n- four",
    needsSession: false,
    reason: "No question or request",
  },
  {
    name: "a greeting",
    text: "hi there",
    needsSession: false,
    reason: "Greeting",
  },
  {
    name: "a good morning greeting",
    text: "Good morning team",
    needsSession: false,
    reason: "Greeting",
  },
  {
    name: "a greeting with a question mark is not a greeting",
    text: "hey, are you around?",
    needsSession: true,
    reason: "Direct question",
  },
  {
    name: "a channel broadcast",
    text: "<!channel> the staging box restarts tonight",
    needsSession: false,
    reason: "FYI or broadcast",
  },
  {
    name: "a broadcast token before an action verb is a request",
    text: "<!channel> deploy at 5pm",
    needsSession: true,
    reason: `${REQUEST}deploy`,
  },
  {
    name: "a labelled here broadcast",
    text: "<!here|here> standup moved",
    needsSession: false,
    reason: "FYI or broadcast",
  },
  {
    name: "an fyi prefix",
    text: "FYI the staging box restarts tonight",
    needsSession: false,
    reason: "FYI or broadcast",
  },
  {
    name: "a broadcast with a question mark is a direct question",
    text: "<!here> can anyone check the build?",
    needsSession: true,
    reason: "Direct question",
  },
  {
    name: "a mention then lgtm",
    text: "<@U123> lgtm",
    needsSession: false,
    reason: "Acknowledgement",
  },
  {
    name: "a thumbs up shortcode only",
    text: ":+1:",
    needsSession: false,
    reason: "Reaction or emoji only",
  },
  {
    name: "two shortcodes and a unicode emoji",
    text: ":thumbsup::tada: \u{1F389}",
    needsSession: false,
    reason: "Reaction or emoji only",
  },
  {
    name: "a mention only",
    text: "<@U123|ana>",
    needsSession: false,
    reason: "Reaction or emoji only",
  },
  {
    name: "empty text",
    text: "",
    needsSession: false,
    reason: "Reaction or emoji only",
  },
  {
    name: "a thumbs up beside text no longer forces an acknowledgement",
    text: "looks right :+1:",
    needsSession: false,
    reason: "No question or request",
  },
  {
    name: "a thumbs up after ok is still an acknowledgement",
    text: "ok :+1:",
    needsSession: false,
    reason: "Acknowledgement",
  },
  {
    name: "a thumbs up on an outage report is not an acknowledgement",
    text: "prod is down :+1:",
    needsSession: false,
    reason: "No question or request",
  },
  {
    name: "a digest word does not hide a question",
    text: "can you check why the daily summary job failed?",
    needsSession: true,
    reason: "Direct question",
  },
  {
    name: "a digest word does not hide a request",
    text: "the weekly digest email is broken, can you fix it",
    needsSession: true,
    reason: `${REQUEST}can you`,
  },
  {
    name: "a bullet list does not hide a question",
    text: "Can you review these?\n- PR 1\n- PR 2\n- PR 3\n- PR 4",
    needsSession: true,
    reason: "Direct question",
  },
  {
    name: "a human digest with no question or request is a digest",
    text: "weekly summary of the release notes",
    needsSession: false,
    reason: "Digest",
  },
  {
    name: "a leading fyi does not hide a request",
    text: "FYI please review PR 42 before 5",
    needsSession: true,
    reason: `${REQUEST}please`,
  },
  {
    name: "a broadcast token does not hide a request",
    text: "<!here> can someone deploy the hotfix",
    needsSession: true,
    reason: `${REQUEST}can someone`,
  },
  {
    name: "a question mark inside a link is not a question (thanks)",
    text: "thanks <https://github.com/x/y/pull/1?tab=files|PR>",
    needsSession: false,
    reason: "Acknowledgement",
  },
  {
    name: "a question mark inside a link is not a question (fyi)",
    text: "fyi <https://x.com/a?b=c>",
    needsSession: false,
    reason: "FYI or broadcast",
  },
  {
    name: "a question",
    text: "is the release out?",
    needsSession: true,
    reason: "Direct question",
  },
  {
    name: "a request question: rule 7 beats rule 8",
    text: "can you check why the deploy failed?",
    needsSession: true,
    reason: "Direct question",
  },
  {
    name: "please",
    text: "please review PR 42",
    needsSession: true,
    reason: `${REQUEST}please`,
  },
  {
    name: "a first-word action verb",
    text: "review the PR when free",
    needsSession: true,
    reason: `${REQUEST}review`,
  },
  {
    name: "a first-word action verb after a mention",
    text: "<@U123> deploy the hotfix",
    needsSession: true,
    reason: `${REQUEST}deploy`,
  },
  {
    name: "okta is not ok",
    text: "okta login is broken for the team today and blocks the release",
    needsSession: false,
    reason: "No question or request",
  },
  {
    name: "a short okta line is not an acknowledgement",
    text: "okta is down",
    needsSession: false,
    reason: "No question or request",
  },
  {
    name: "a plain statement",
    text: "the build went green",
    needsSession: false,
    reason: "No question or request",
  },
  {
    name: "rule order: thanks then a request in six words skips rule 3 and is a request (rule 8)",
    text: "thanks, can you check the logs",
    needsSession: true,
    reason: `${REQUEST}can you`,
  },
  {
    name: "a greeting then a request phrase skips rule 4",
    text: "hi, can you review PR 42",
    needsSession: true,
    reason: `${REQUEST}can you`,
  },
  {
    name: "a greeting, a mention, then an action verb skips rule 4",
    text: "hey <@U1> look at the deploy",
    needsSession: true,
    reason: `${REQUEST}look`,
  },
  {
    name: "a second acknowledgement word stays an acknowledgement",
    text: "ok thanks",
    needsSession: false,
    reason: "Acknowledgement",
  },
  {
    name: "a greeting with a question mark is a direct question",
    text: "hey, is the build green?",
    needsSession: true,
    reason: "Direct question",
  },
  {
    name: "rule order: the same thanks with a question mark skips rule 3 and is a direct question (rule 7)",
    text: "thanks, can you check the logs?",
    needsSession: true,
    reason: "Direct question",
  },
  {
    name: "rule order: a seven-word thanks is too long for rule 3 and is a request (rule 8)",
    text: "thanks, can you check the logs today",
    needsSession: true,
    reason: `${REQUEST}can you`,
  },
  {
    name: "an emoji before an action verb is a request",
    text: ":eyes: check this",
    needsSession: true,
    reason: `${REQUEST}check`,
  },
  {
    name: "a mention then an emoji then an action verb is a request",
    text: "<@U1> :eyes: check the logs",
    needsSession: true,
    reason: `${REQUEST}check`,
  },
  {
    name: "an acknowledgement then an emoji then an action verb is a request",
    text: "ok :eyes: check it",
    needsSession: true,
    reason: `${REQUEST}check`,
  },
  {
    name: "a here token before an action verb is a request",
    text: "<!here> deploy the hotfix",
    needsSession: true,
    reason: `${REQUEST}deploy`,
  },
  {
    name: "a heads up before an action verb is a request",
    text: "heads up, deploy the thing",
    needsSession: true,
    reason: `${REQUEST}deploy`,
  },
  {
    name: "a heads up with no request stays a broadcast",
    text: "heads up, the build is green",
    needsSession: false,
    reason: "FYI or broadcast",
  },
];

for (const f of FIXTURES) {
  test(`slackRelevance: ${f.name}`, () => {
    assert.deepEqual(
      slackRelevance({ text: f.text, subtype: f.subtype, botId: f.botId }),
      { needsSession: f.needsSession, reason: f.reason },
    );
  });
}

test("slackRelevance: text past 4000 characters is not read", () => {
  assert.deepEqual(
    slackRelevance({ text: "a ".repeat(2000) + "can you check" }),
    {
      needsSession: false,
      reason: "No question or request",
    },
  );
});
