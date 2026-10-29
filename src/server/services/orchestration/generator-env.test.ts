import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";
import {
  queueLinearFetch,
  restoreFetch,
} from "../../test-support/linear-fetch.js";

const env = isolateEnv();
const logFile = path.join(env.root, "generator-config-dir.log");
const outFile = path.join(env.root, "generator-stub-output.txt");
process.env.GENERATE_STUB_LOG = logFile;
process.env.GENERATE_STUB_OUT = outFile;
const { generatePlaybookDraft } = await import("./playbook-generate.js");
const { generateGroupTitlePhrase } = await import("./group-title-generate.js");
const { generateMeetingDrafts } = await import("./meeting-draft.js");
const { syncCardToLinear } = await import("./linear-sync.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const accounts = await import("./claude-accounts.js");

fs.writeFileSync(
  path.join(env.binDir, "claude"),
  `#!/bin/sh
echo "$CLAUDE_CONFIG_DIR" >> "$GENERATE_STUB_LOG"
cat "$GENERATE_STUB_OUT"
`,
  { mode: 0o755 },
);
setOrchestrationConfig({ linearApiKey: "fake-key" });

after(() => {
  delete process.env.GENERATE_STUB_LOG;
  delete process.env.GENERATE_STUB_OUT;
  env.cleanup();
});
afterEach(restoreFetch);

const MANAGED_ID = "66666666-6666-4666-8666-666666666666";

/**
 * Run `call` once without a managed default and once after adopting one, then assert the stub saw
 * the baseline config dir first and the managed account dir second.
 */
async function assertRunsOnManagedLogin(
  stubOutput: string,
  call: () => Promise<unknown>,
): Promise<void> {
  fs.writeFileSync(logFile, "");
  fs.writeFileSync(outFile, stubOutput);
  await call();

  const dir = accounts.accountDir(MANAGED_ID);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  await accounts.adoptManagedDefault({
    id: MANAGED_ID,
    email: "managed@example.com",
    orgId: "org-x",
    orgName: "Org X",
    subscriptionType: "pro",
    createdAt: "2026-09-02T00:00:00.000Z",
    lastLoginAt: "2026-09-02T00:00:00.000Z",
  });
  try {
    await call();
  } finally {
    await accounts.removeAccount(MANAGED_ID);
  }
  assert.equal(
    fs.readFileSync(logFile, "utf8"),
    `${process.env.CLAUDE_CONFIG_DIR ?? ""}\n${dir}\n`,
  );
}

test("generatePlaybookDraft runs on the managed login", async () => {
  await assertRunsOnManagedLogin("## Extra direction\n{extra}\n", async () =>
    assert.equal(
      await generatePlaybookDraft({ direction: "do it", sourcePaths: [] }),
      "## Extra direction\n{extra}",
    ),
  );
});

test("generateGroupTitlePhrase runs on the managed login", async () => {
  await assertRunsOnManagedLogin("## Phrase\nShared login fixes\n", async () =>
    assert.equal(
      await generateGroupTitlePhrase([
        { identifier: "ENG-1", title: "Fix login", project: null },
      ]),
      "Shared login fixes",
    ),
  );
});

test("generateMeetingDrafts runs on the managed login", async () => {
  await assertRunsOnManagedLogin(
    "## Action item\nkey: send-recap\ntitle: Send the recap\n\nSend it today.\n",
    async () =>
      assert.deepEqual(
        await generateMeetingDrafts({ meeting: "Weekly sync", notes: "n" }),
        [
          {
            key: "send-recap",
            title: "Send the recap",
            description: "Send it today.",
          },
        ],
      ),
  );
});

test("syncCardToLinear runs on the managed login", async () => {
  await assertRunsOnManagedLogin(
    JSON.stringify({
      identifier: "ENG-7",
      url: "https://linear.app/x/issue/ENG-7",
      title: "Synced",
      description: "Body",
    }),
    async () => {
      queueLinearFetch([
        [
          200,
          {
            data: {
              issue: {
                id: "issue-7",
                description: "Body\ndispatch-sync:LOCAL-1",
                creator: { isMe: true },
              },
            },
          },
        ],
      ]);
      assert.equal(
        (
          await syncCardToLinear({
            id: "LOCAL-1",
            title: "T",
            description: null,
          })
        ).issueId,
        "issue-7",
      );
    },
  );
});
