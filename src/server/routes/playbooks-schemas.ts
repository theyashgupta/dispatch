import { z } from "zod";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_NAME_LEN = 80;
const MAX_BODY_BYTES = 262144;
const MAX_DIRECTION_LEN = 10000;
const MAX_SOURCE_PATHS = 8;

const invalidName = { error: "invalid-name" } as const;
const invalidBody = { error: "invalid-body" } as const;
const invalidDirection = { error: "invalid-direction" } as const;
const invalidSources = { error: "invalid-sources" } as const;

const nameSchema = z
  .string(invalidName)
  .trim()
  .min(1, invalidName)
  .refine((name) => name.length <= MAX_NAME_LEN, invalidName)
  .refine((name) => !name.includes("\n") && !name.includes("\r"), invalidName);

const bodySchema = z
  .string(invalidBody)
  .refine(
    (body) => Buffer.byteLength(body, "utf8") <= MAX_BODY_BYTES,
    invalidBody,
  );

export const writeSchema = z.object(
  { name: nameSchema, body: bodySchema },
  invalidName,
);

export const slugSchema = z.string().regex(SLUG_RE, { error: "invalid-slug" });

export const generateSchema = z.object(
  {
    direction: z
      .string(invalidDirection)
      .trim()
      .min(1, invalidDirection)
      .refine(
        (direction) => direction.length <= MAX_DIRECTION_LEN,
        invalidDirection,
      ),
    sourcePaths: z
      .array(z.string(invalidSources), invalidSources)
      .max(MAX_SOURCE_PATHS, invalidSources)
      .optional(),
  },
  invalidDirection,
);
