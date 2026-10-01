import { z } from "zod";

const MAX_ENDPOINT_LEN = 2048;
const MAX_KEY_LEN = 512;

/** An `https://` push endpoint URL, 1 to 2048 characters. */
export const endpointSchema = z
  .string("invalid-endpoint")
  .refine(
    (raw) =>
      raw.length > 0 &&
      raw.length <= MAX_ENDPOINT_LEN &&
      raw.startsWith("https://") &&
      URL.canParse(raw),
    "invalid-endpoint",
  );

const keySchema = z
  .string("invalid-keys")
  .refine((raw) => raw.length > 0 && raw.length <= MAX_KEY_LEN, "invalid-keys");

/** A subscription's keys: non-empty `p256dh` and `auth` strings, each at most 512 characters. */
export const keysSchema = z.object(
  { p256dh: keySchema, auth: keySchema },
  "invalid-keys",
);

/** The `POST /push/subscribe` body; the endpoint is checked before the keys. */
export const subscribeSchema = z.object(
  { endpoint: endpointSchema, keys: keysSchema },
  "invalid-endpoint",
);

export const unsubscribeSchema = z.object(
  { endpoint: endpointSchema },
  "invalid-endpoint",
);
