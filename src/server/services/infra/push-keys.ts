import fs from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import writeFileAtomic from "write-file-atomic";
import { DISPATCH_DIR, VAPID_KEYS_PATH } from "./paths.js";

interface VapidKeyFile {
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

export interface VapidKeys {
  publicKeyBase64Url: string;
  privateKeyJwk: JsonWebKey;
}

let cached: VapidKeys | null = null;

function readAndValidate(): VapidKeyFile {
  let raw: string;
  try {
    raw = fs.readFileSync(VAPID_KEYS_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `Could not read VAPID key file at ${VAPID_KEYS_PATH}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  let file: VapidKeyFile;
  try {
    file = JSON.parse(raw) as VapidKeyFile;
  } catch {
    throw new Error(
      `VAPID key file at ${VAPID_KEYS_PATH} is not valid JSON. Fix or delete the file and restart.`,
    );
  }

  const x = file.publicKeyJwk?.x;
  const y = file.publicKeyJwk?.y;
  const d = file.privateKeyJwk?.d;
  if (
    typeof x !== "string" ||
    x === "" ||
    typeof y !== "string" ||
    y === "" ||
    typeof d !== "string" ||
    d === ""
  ) {
    throw new Error(
      `VAPID key file at ${VAPID_KEYS_PATH} is missing publicKeyJwk.x/y or privateKeyJwk.d. Fix or delete the file and restart.`,
    );
  }

  return file;
}

/**
 * Loads the boot-persisted VAPID keypair, generating it exactly once on first call. Memoized so
 * every later caller in this process (boot log line, Plan 05's route) shares one file read.
 *
 * @remarks
 * Never regenerates on a corrupt or malformed file; throws instead, since a silent regenerate
 * invalidates every browser subscription already bound to the old public key with no visible
 * signal. The private half is returned for ES256 VAPID JWT signing and must never be logged.
 */
export function loadOrCreateVapidKeys(): VapidKeys {
  if (cached) return cached;

  if (!fs.existsSync(VAPID_KEYS_PATH)) {
    fs.mkdirSync(DISPATCH_DIR, { recursive: true, mode: 0o700 });
    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const file: VapidKeyFile = {
      publicKeyJwk: publicKey.export({ format: "jwk" }),
      privateKeyJwk: privateKey.export({ format: "jwk" }),
    };
    writeFileAtomic.sync(
      VAPID_KEYS_PATH,
      JSON.stringify(file, null, 2) + "\n",
      { mode: 0o600 },
    );
    fs.chmodSync(VAPID_KEYS_PATH, 0o600);
  }

  const file = readAndValidate();
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(file.publicKeyJwk.x as string, "base64url"),
    Buffer.from(file.publicKeyJwk.y as string, "base64url"),
  ]);
  if (point.length !== 65) {
    throw new Error(
      `VAPID key file at ${VAPID_KEYS_PATH} has a malformed public key point (expected 65 bytes, got ${point.length}). Fix or delete the file and restart.`,
    );
  }

  cached = {
    publicKeyBase64Url: point.toString("base64url"),
    privateKeyJwk: file.privateKeyJwk,
  };
  return cached;
}
