import { z } from "zod";
import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  MAX_LOGIN_CODE_LEN,
} from "../../shared/types.js";
import { isAccountId } from "../services/orchestration/claude-accounts.js";
import { fieldsOf } from "./schema-primitives.js";

/** A registry account id, or the virtual `default` account. */
export const accountOrDefaultIdSchema = z
  .string("invalid-id")
  .refine(
    (id) => id === DEFAULT_CLAUDE_ACCOUNT_ID || isAccountId(id),
    "invalid-id",
  );

/** An added account id; `default` is refused with its own code because it cannot be removed. */
export const removableAccountIdSchema = accountOrDefaultIdSchema.refine(
  (id) => id !== DEFAULT_CLAUDE_ACCOUNT_ID,
  "default-account",
);

export const activeBodySchema = z.object(
  {
    id: accountOrDefaultIdSchema,
    applyToRunning: z
      .enum(["none", "idle", "all"], "invalid-apply")
      .default("none"),
  },
  "invalid-id",
);

/**
 * The `POST /accounts/login` body, where a missing or array body means a fresh account.
 *
 * @remarks A present `accountId` must be a registry id, so `default` is refused here.
 */
export const loginBodySchema = z.preprocess(
  fieldsOf,
  z.object(
    {
      accountId: z
        .string("invalid-id")
        .refine((id) => isAccountId(id), "invalid-id")
        .optional(),
    },
    "invalid-id",
  ),
);

/** The `POST /accounts/login/code` body; the code comes out trimmed, one line and at most 512 characters. */
export const loginCodeBodySchema = z.object(
  {
    code: z
      .string("invalid-code")
      .transform((raw) => raw.trim())
      .refine(
        (raw) =>
          raw !== "" && raw.length <= MAX_LOGIN_CODE_LEN && !/[\r\n]/.test(raw),
        "invalid-code",
      ),
  },
  "invalid-code",
);
