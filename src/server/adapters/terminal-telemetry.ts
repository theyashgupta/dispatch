import { appendFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { DISPATCH_DATA_DIR } from "../store/data-dir.js";
import type { Duplex } from "node:stream";

/**
 * True only when the opt-in telemetry environment variable is set to `"1"`, read exactly once at
 * module import and never re-read anywhere else in this file, so no request can ever flip it. When
 * false, the default on every real terminal session, this boolean is the ONLY allocation this
 * module makes: no listener is attached, no timer is armed, no buffer is held, no file is created,
 * and the sink directory is never created.
 * @remarks Mirrors the `DISPATCH_PERF_EXEC` opt-in shape (`exec.ts:22`): one module-level `const`
 * guarding every side effect below behind a single `if`.
 */
export const telemetryOn = process.env.DISPATCH_TERM_TELEMETRY === "1";

const TELEMETRY_PATH = path.join(DISPATCH_DATA_DIR, "terminal-telemetry.jsonl");

const SCHEMA_VERSION = 1;

/** Hard stop, never a rotation, so a forgotten flag cannot fill a disk. */
const FILE_CAP_BYTES = 2_097_152;

/**
 * A burst closes this many milliseconds after the last frame in either direction. Chosen above the
 * largest legitimate intra-flick silence: the momentum loop runs on `requestAnimationFrame` for up
 * to `KINETIC.maxMomentumMs` (1200ms) and emits no tick at all in frames where the decayed velocity
 * has not yet accumulated a full row, so a tighter window would split one flick into several
 * records.
 */
const BURST_GAP_MS = 300;

/** Hard ceiling on one burst's own span, independent of {@link BURST_GAP_MS}, so a pathological
 * stream of frames with no silence between them cannot hold one record open forever. */
const BURST_MAX_MS = 10_000;

/** Bound on `gapsMs` so a pathological burst cannot inflate one record line without bound. */
const MAX_GAPS = 64;

let bytesWritten = 0;
let connCounter = 0;

/**
 * Seed {@link bytesWritten} from the sink's existing size, so a restart resumes the cap instead of
 * resetting it, then ensure the sink directory exists. The single `statSync` this performs is the
 * only disk read this module ever makes, and it runs only when {@link telemetryOn} is true.
 */
function armSink(): void {
  mkdirSync(DISPATCH_DATA_DIR, { recursive: true });
  try {
    bytesWritten = statSync(TELEMETRY_PATH).size;
  } catch {
    bytesWritten = 0;
  }
}

if (telemetryOn) armSink();

interface TelemetryRecord {
  v: number;
  conn: number;
  seq: number;
  tsMs: number;
  burstMs: number;
  inputFrames: number;
  inputBytes: number;
  gapsMs: number[];
  turnaroundMs: number | null;
  settleMs: number | null;
  outputFrames: number;
  outputBytes: number;
  maxOutGapMs: number | null;
  maxBacklogB: number;
  pongRttMs: number | null;
  gapCloseMs: number;
}

/**
 * Append one record as a `JSON.stringify`'d line, swallowing any write failure so telemetry can
 * never break the terminal session it observes. Stops appending once {@link FILE_CAP_BYTES} is
 * reached.
 */
function appendRecord(record: TelemetryRecord): void {
  if (bytesWritten >= FILE_CAP_BYTES) return;
  const line = JSON.stringify(record) + "\n";
  try {
    appendFileSync(TELEMETRY_PATH, line, { mode: 0o600 });
    bytesWritten += Buffer.byteLength(line);
  } catch {
    return;
  }
}

/**
 * Header-only WebSocket frame scanner (RFC 6455): reads byte 0 (opcode), byte 1 (mask bit plus a
 * 7-bit length), the 2- or 8-byte extended length when that 7-bit value is 126 or 127, and the
 * 4-byte mask key when present, then skips the payload by arithmetic. It never allocates a
 * payload-sized buffer, never indexes past the chunk it currently holds, and a frame it cannot yet
 * parse simply waits for the next chunk rather than throwing into the data path. Payload bytes
 * themselves are never read, copied, unmasked, or decoded, only counted, so terminal content cannot
 * reach {@link onFrame} even in principle.
 */
function createFrameScanner(
  onFrame: (opcode: number, payloadLen: number) => void,
): (chunk: Buffer) => void {
  let residual: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let skip = 0;
  return function feed(chunk: Buffer): void {
    const buf = residual.length > 0 ? Buffer.concat([residual, chunk]) : chunk;
    let offset = 0;
    for (;;) {
      if (skip > 0) {
        const canSkip = Math.min(skip, buf.length - offset);
        offset += canSkip;
        skip -= canSkip;
        if (skip > 0) break;
      }
      if (buf.length - offset < 2) break;
      const b1 = buf[offset + 1];
      const opcode = buf[offset] & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      const lenBits = b1 & 0x7f;
      let headerLen = 2;
      if (lenBits === 126) headerLen += 2;
      else if (lenBits === 127) headerLen += 8;
      if (masked) headerLen += 4;
      if (buf.length - offset < headerLen) break;
      const payloadLen =
        lenBits === 126
          ? buf.readUInt16BE(offset + 2)
          : lenBits === 127
            ? Number(buf.readBigUInt64BE(offset + 2))
            : lenBits;
      offset += headerLen;
      onFrame(opcode, payloadLen);
      skip = payloadLen;
      const canSkip = Math.min(skip, buf.length - offset);
      offset += canSkip;
      skip -= canSkip;
      if (skip > 0) break;
    }
    residual = buf.subarray(offset);
  };
}

const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

function isDataOpcode(opcode: number): boolean {
  return opcode === 0x0 || opcode === 0x1 || opcode === 0x2;
}

interface OpenBurst {
  seq: number;
  firstInputMs: number;
  lastInputMs: number | null;
  inputFrames: number;
  inputBytes: number;
  gapsMs: number[];
  turnaroundMs: number | null;
  lastOutputMs: number | null;
  outputFrames: number;
  outputBytes: number;
  maxOutGapMs: number | null;
  maxBacklogB: number;
  pongRttMs: number | null;
  maxTimer: NodeJS.Timeout;
}

/**
 * Attach one additional, non-consuming `data` listener to each already-piped socket and turn the
 * WebSocket frames crossing them into bounded, opt-in JSONL burst records. Passive observer only:
 * it never calls `.write`/`.end` on either socket and never injects a frame of its own, including a
 * ping, onto a live terminal stream.
 * @remarks Must be called AFTER both `pipe()` calls: the listeners this function attaches then run
 * after `pipe`'s own forwarding write for the same chunk, which is what makes
 * `clientSocket.writableLength` a meaningful backlog sample at observation time.
 */
export function armFlickTelemetry(
  clientSocket: Duplex,
  upstream: Duplex,
): void {
  connCounter += 1;
  const conn = connCounter;
  let seq = 0;
  let burst: OpenBurst | null = null;
  let gapTimer: NodeJS.Timeout | null = null;
  let pendingPingAtMs: number | null = null;

  function resetGapTimer(): void {
    if (gapTimer) clearTimeout(gapTimer);
    gapTimer = setTimeout(closeBurst, BURST_GAP_MS);
    gapTimer.unref();
  }

  function ensureBurstOpen(nowMs: number): OpenBurst {
    if (burst) return burst;
    seq += 1;
    const maxTimer = setTimeout(closeBurst, BURST_MAX_MS);
    maxTimer.unref();
    burst = {
      seq,
      firstInputMs: nowMs,
      lastInputMs: null,
      inputFrames: 0,
      inputBytes: 0,
      gapsMs: [],
      turnaroundMs: null,
      lastOutputMs: null,
      outputFrames: 0,
      outputBytes: 0,
      maxOutGapMs: null,
      maxBacklogB: 0,
      pongRttMs: null,
      maxTimer,
    };
    return burst;
  }

  function closeBurst(): void {
    if (!burst) return;
    const b = burst;
    clearTimeout(b.maxTimer);
    if (gapTimer) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
    burst = null;
    const nowMs = performance.now();
    appendRecord({
      v: SCHEMA_VERSION,
      conn,
      seq: b.seq,
      tsMs: Date.now(),
      burstMs: Math.round(nowMs - b.firstInputMs),
      inputFrames: b.inputFrames,
      inputBytes: b.inputBytes,
      gapsMs: b.gapsMs,
      turnaroundMs: b.turnaroundMs,
      settleMs:
        b.lastOutputMs !== null && b.lastInputMs !== null
          ? Math.round(b.lastOutputMs - b.lastInputMs)
          : null,
      outputFrames: b.outputFrames,
      outputBytes: b.outputBytes,
      maxOutGapMs: b.maxOutGapMs,
      maxBacklogB: b.maxBacklogB,
      pongRttMs: b.pongRttMs,
      gapCloseMs: BURST_GAP_MS,
    });
  }

  function onInputFrame(opcode: number, len: number): void {
    const nowMs = performance.now();
    if (opcode === OPCODE_PONG) {
      if (pendingPingAtMs !== null) {
        const rtt = Math.round(nowMs - pendingPingAtMs);
        pendingPingAtMs = null;
        if (burst && burst.pongRttMs === null) burst.pongRttMs = rtt;
      }
      return;
    }
    if (!isDataOpcode(opcode)) return;
    if (!burst && opcode === 0x0) return;
    const b = ensureBurstOpen(nowMs);
    if (b.lastInputMs !== null && b.gapsMs.length < MAX_GAPS) {
      b.gapsMs[b.gapsMs.length] = Math.round(nowMs - b.lastInputMs);
    }
    b.inputFrames += 1;
    b.inputBytes += len;
    b.lastInputMs = nowMs;
    resetGapTimer();
  }

  function onOutputFrame(opcode: number, len: number): void {
    const nowMs = performance.now();
    if (opcode === OPCODE_PING) {
      pendingPingAtMs = nowMs;
      return;
    }
    if (!isDataOpcode(opcode)) return;
    if (!burst) return;
    const b = burst;
    if (b.turnaroundMs === null) {
      b.turnaroundMs = Math.round(nowMs - b.firstInputMs);
    }
    if (b.lastOutputMs !== null) {
      const gap = Math.round(nowMs - b.lastOutputMs);
      if (b.maxOutGapMs === null || gap > b.maxOutGapMs) b.maxOutGapMs = gap;
    }
    b.outputFrames += 1;
    b.outputBytes += len;
    b.lastOutputMs = nowMs;
    const backlogB = clientSocket.writableLength;
    if (backlogB > b.maxBacklogB) b.maxBacklogB = backlogB;
    resetGapTimer();
  }

  const feedInput = createFrameScanner(onInputFrame);
  const feedOutput = createFrameScanner(onOutputFrame);

  clientSocket.on("data", (chunk: Buffer) => feedInput(chunk));
  upstream.on("data", (chunk: Buffer) => feedOutput(chunk));
  clientSocket.on("close", closeBurst);
  upstream.on("close", closeBurst);
}
