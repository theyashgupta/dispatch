import assert from "node:assert/strict";
import { test } from "node:test";
import { imageFilesFromClipboard, reserveRoom } from "./usePastedImages.js";

function item(kind: string, type: string, file: File | null): DataTransferItem {
  return {
    kind,
    type,
    getAsFile: () => file,
  } as unknown as DataTransferItem;
}

function list(...items: DataTransferItem[]): DataTransferItemList {
  return items as unknown as DataTransferItemList;
}

const png = new File([new Uint8Array([1, 2, 3])], "shot.png", {
  type: "image/png",
});

test("only image files come back, in order, from a mixed paste", () => {
  const files = imageFilesFromClipboard(
    list(
      item("string", "text/plain", null),
      item("file", "image/png", png),
      item("file", "application/pdf", new File([], "doc.pdf")),
      item("file", "image/jpeg", png),
    ),
  );
  assert.equal(files.length, 2);
  assert.equal(files[0], png);
});

test("image types the server would reject are skipped", () => {
  const svg = new File([], "x.svg", { type: "image/svg+xml" });
  const tiff = new File([], "x.tiff", { type: "image/tiff" });
  assert.deepEqual(
    imageFilesFromClipboard(
      list(
        item("file", "image/svg+xml", svg),
        item("file", "image/tiff", tiff),
      ),
    ),
    [],
  );
});

test("reserveRoom keeps what fits under the cap and flags the overflow", () => {
  assert.deepEqual(reserveRoom(0, 3), { kept: 3, limitHit: false });
  assert.deepEqual(reserveRoom(0, 11), { kept: 10, limitHit: true });
  assert.deepEqual(reserveRoom(9, 2), { kept: 1, limitHit: true });
  assert.deepEqual(reserveRoom(10, 1), { kept: 0, limitHit: true });
  assert.deepEqual(reserveRoom(10, 0), { kept: 0, limitHit: false });
});

test("a text-only paste yields nothing", () => {
  assert.deepEqual(
    imageFilesFromClipboard(list(item("string", "text/plain", null))),
    [],
  );
  assert.deepEqual(imageFilesFromClipboard(list()), []);
  assert.deepEqual(imageFilesFromClipboard(null), []);
});

test("an image item whose file is unavailable is skipped", () => {
  assert.deepEqual(
    imageFilesFromClipboard(list(item("file", "image/png", null))),
    [],
  );
});
