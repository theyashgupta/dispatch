import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const logFile = path.join(env.root, "generate-config-dir.log");
process.env.GENERATE_STUB_LOG = logFile;
const { generateTicketDraft } = await import("./ticket-generate.js");
const accounts = await import("./claude-accounts.js");

fs.writeFileSync(
  path.join(env.binDir, "claude"),
  `#!/bin/sh
echo "$CLAUDE_CONFIG_DIR" >> "$GENERATE_STUB_LOG"
printf '## Title\\nStub title\\n\\n## Description\\nStub description\\n'
`,
  { mode: 0o755 },
);

after(() => {
  delete process.env.GENERATE_STUB_LOG;
  env.cleanup();
});

const MANAGED_ID = "55555555-5555-4555-8555-555555555555";

test("generateTicketDraft runs on the home login without a managed default and on the managed dir with one", async () => {
  const first = await generateTicketDraft("make a ticket");
  assert.deepEqual(first, {
    title: "Stub title",
    description: "Stub description",
  });

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
    await generateTicketDraft("make a ticket");
  } finally {
    await accounts.removeAccount(MANAGED_ID);
  }
  assert.equal(
    fs.readFileSync(logFile, "utf8"),
    `${process.env.CLAUDE_CONFIG_DIR ?? ""}\n${dir}\n`,
  );
});
