import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeImages,
  imageExtension,
  screenshotsSection,
} from "./attachments.js";
import { MAX_ATTACHMENT_BYTES } from "../../../shared/types.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 1),
]);
const JPG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(16, 2),
]);
const GIF = Buffer.concat([
  Buffer.from("GIF89a", "latin1"),
  Buffer.alloc(16, 3),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.alloc(4),
  Buffer.from("WEBP", "latin1"),
  Buffer.alloc(16, 4),
]);
const TEXT = Buffer.from("definitely not an image, just text bytes");

test("imageExtension detects the four formats by magic bytes", () => {
  assert.equal(imageExtension(PNG), "png");
  assert.equal(imageExtension(JPG), "jpg");
  assert.equal(imageExtension(GIF), "gif");
  assert.equal(imageExtension(WEBP), "webp");
  assert.equal(imageExtension(TEXT), null);
  assert.equal(imageExtension(Buffer.alloc(3)), null);
});

test("decodeImages names each image by a stable 16-hex hash and its extension", () => {
  const out = decodeImages([PNG.toString("base64"), JPG.toString("base64")]);
  assert.ok(out);
  assert.equal(out.length, 2);
  assert.match(out[0].name, /^[a-f0-9]{16}\.png$/);
  assert.match(out[1].name, /^[a-f0-9]{16}\.jpg$/);
  assert.ok(out[0].bytes.equals(PNG));
  const again = decodeImages([PNG.toString("base64")]);
  assert.equal(again?.[0].name, out[0].name);
});

test("decodeImages collapses byte-identical images to one entry", () => {
  const out = decodeImages([PNG.toString("base64"), PNG.toString("base64")]);
  assert.equal(out?.length, 1);
});

test("decodeImages accepts an empty list", () => {
  assert.deepEqual(decodeImages([]), []);
});

test("decodeImages rejects non-array input and non-string items", () => {
  assert.equal(decodeImages("x"), null);
  assert.equal(decodeImages([1]), null);
  assert.equal(decodeImages(undefined), null);
});

test("decodeImages rejects bytes that are not an image", () => {
  assert.equal(decodeImages([TEXT.toString("base64")]), null);
  assert.equal(decodeImages([""]), null);
});

test("decodeImages rejects more than ten images", () => {
  const ten = Array.from({ length: 10 }, () => PNG.toString("base64"));
  assert.ok(decodeImages(ten));
  assert.equal(decodeImages([...ten, PNG.toString("base64")]), null);
});

test("decodeImages rejects an image over the byte limit", () => {
  const big = Buffer.concat([
    PNG,
    Buffer.alloc(MAX_ATTACHMENT_BYTES - PNG.length + 1),
  ]);
  assert.equal(decodeImages([big.toString("base64")]), null);
  const exact = Buffer.concat([
    PNG,
    Buffer.alloc(MAX_ATTACHMENT_BYTES - PNG.length),
  ]);
  assert.ok(decodeImages([exact.toString("base64")]));
});

test("screenshotsSection links every name in order and is empty for no names", () => {
  assert.equal(screenshotsSection([]), "");
  assert.equal(
    screenshotsSection(["aaaaaaaaaaaaaaaa.png", "bbbbbbbbbbbbbbbb.jpg"]),
    "\n\n## Screenshots\n\n![screenshot 1](attachments/aaaaaaaaaaaaaaaa.png)\n\n![screenshot 2](attachments/bbbbbbbbbbbbbbbb.jpg)",
  );
});
