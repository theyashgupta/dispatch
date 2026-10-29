import fs from "node:fs";
import test from "node:test";
import { BOARD_DB_PATH } from "../../../../src/server/store/board-db.js";
import { store } from "../../../../src/server/store/board.store.js";
import { isolateEnv } from "../../../../src/server/test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../../../src/shared/board-key.js";

const env = isolateEnv();

void test("early import probe", async () => {
  fs.writeFileSync(process.env.PROBE_OUT ?? "", BOARD_DB_PATH);
  await store.load();
  await store.createLocalCard(DEFAULT_BOARD_KEY, "early import probe", "");
});

void test.after(() => env.cleanup());
