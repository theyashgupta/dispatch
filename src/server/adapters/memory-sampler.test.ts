import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSysctl,
  parseVmStat,
  readMemory,
  readSampleFile,
} from "./memory-sampler.js";

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    15864.
Pages active:                                  91156.
Pages inactive:                                91429.
Pages speculative:                              1888.
Pages wired down:                             137758.
Pages stored in compressor:                   679586.
Pages occupied by compressor:                 149654.
`;

test("vm_stat text gives free plus inactive and the compressor size in MB", () => {
  assert.deepEqual(parseVmStat(VM_STAT), { freeMb: 1676, compressorMb: 2338 });
});

test("a 4 KB page size from the header is used", () => {
  const intel = VM_STAT.replace("16384 bytes", "4096 bytes");
  assert.deepEqual(parseVmStat(intel), { freeMb: 419, compressorMb: 585 });
});

test("vm_stat text without the compressor line gives no reading", () => {
  const cut = VM_STAT.replace(/Pages occupied by compressor.*\n/, "");
  assert.equal(parseVmStat(cut), null);
});

test("vm_stat text without the page size gives no reading", () => {
  assert.equal(parseVmStat(VM_STAT.split("\n").slice(1).join("\n")), null);
});

test("sysctl text in M gives swap used, swap total and load", () => {
  const text =
    "total = 4096.00M  used = 2968.62M  free = 1127.38M  (encrypted)\n{ 4.90 5.01 9.03 }\n";
  assert.deepEqual(parseSysctl(text), {
    swapUsedMb: 2969,
    swapTotalMb: 4096,
    load1: 4.9,
  });
});

test("sysctl text in G is converted to MB", () => {
  const text =
    "total = 6.00G  used = 4.50G  free = 1.50G  (encrypted)\n{ 1.25 1.00 0.75 }\n";
  assert.deepEqual(parseSysctl(text), {
    swapUsedMb: 4608,
    swapTotalMb: 6144,
    load1: 1.25,
  });
});

test("malformed sysctl text gives no reading, never zero or NaN", () => {
  assert.equal(parseSysctl("vm.swapusage: unknown oid"), null);
  assert.equal(parseSysctl("total = 4096.00M  used = 1.00M\n"), null);
});

test("a platform other than darwin gives no reading", async () => {
  assert.equal(await readMemory("linux"), null);
});

test(
  "on macOS a real read gives every field",
  { skip: process.platform !== "darwin" },
  async () => {
    const sample = await readMemory();
    assert.ok(sample);
    assert.ok(sample.freeMb > 0);
    assert.ok(sample.swapTotalMb >= sample.swapUsedMb);
    assert.ok(Number.isFinite(sample.compressorMb));
    assert.ok(Number.isFinite(sample.load1));
    assert.ok(!Number.isNaN(Date.parse(sample.at)));
  },
);

const FIELDS = {
  freeMb: 900,
  compressorMb: 2000,
  swapUsedMb: 9000,
  swapTotalMb: 16384,
  load1: 3.5,
};

async function sampleFile(content: string): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "memory-sample-")), "m.json");
  await writeFile(path, content);
  return path;
}

test("a valid sample file gives those numbers and a fresh time", async (t) => {
  t.mock.method(console, "warn", () => {});
  const before = Date.now();
  const sample = await readSampleFile(await sampleFile(JSON.stringify(FIELDS)));
  assert.ok(sample);
  assert.deepEqual({ ...sample, at: undefined }, { ...FIELDS, at: undefined });
  assert.ok(Date.parse(sample.at) >= before);
});

test("a missing, malformed or incomplete sample file gives no reading", async (t) => {
  t.mock.method(console, "warn", () => {});
  const dir = await mkdtemp(join(tmpdir(), "memory-sample-"));
  assert.equal(await readSampleFile(join(dir, "absent.json")), null);
  assert.equal(await readSampleFile(await sampleFile("{not json")), null);
  assert.equal(await readSampleFile(await sampleFile("null")), null);
  const short = { ...FIELDS, load1: undefined };
  assert.equal(
    await readSampleFile(await sampleFile(JSON.stringify(short))),
    null,
  );
});

test("a directory, an oversized file and a negative value give no reading", async (t) => {
  t.mock.method(console, "warn", () => {});
  const dir = await mkdtemp(join(tmpdir(), "memory-sample-"));
  assert.equal(await readSampleFile(dir), null);
  const padded = JSON.stringify({ ...FIELDS, pad: "x".repeat(5000) });
  assert.equal(await readSampleFile(await sampleFile(padded)), null);
  const negative = { ...FIELDS, swapUsedMb: -1 };
  assert.equal(
    await readSampleFile(await sampleFile(JSON.stringify(negative))),
    null,
  );
});

test("with the sample file variable set, readMemory reads the file on any platform", async () => {
  const path = await sampleFile(JSON.stringify(FIELDS));
  const saved = process.env.DISPATCH_MEMORY_SAMPLE_FILE;
  process.env.DISPATCH_MEMORY_SAMPLE_FILE = path;
  try {
    const sample = await readMemory("linux");
    assert.equal(sample?.swapUsedMb, 9000);
  } finally {
    if (saved === undefined) delete process.env.DISPATCH_MEMORY_SAMPLE_FILE;
    else process.env.DISPATCH_MEMORY_SAMPLE_FILE = saved;
  }
});
