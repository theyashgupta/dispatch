import { z } from "zod";

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;
const NUMBER = /^[1-9][0-9]{0,9}$/;
const BODY_MAX = 20000;

/** An owner or repo segment: 1 to 100 name characters, and not only dots. */
const repoNameSchema = z
  .string("invalid pull request")
  .refine(
    (name) => NAME.test(name) && !/^\.+$/.test(name),
    "invalid pull request",
  );

/** The pull request path params, with the number converted to a number. */
export const targetSchema = z
  .object(
    {
      owner: repoNameSchema,
      repo: repoNameSchema,
      number: z
        .string("invalid pull request")
        .refine((number) => NUMBER.test(number), "invalid pull request"),
    },
    "invalid pull request",
  )
  .transform(({ owner, repo, number }) => ({
    owner,
    repo,
    number: Number(number),
  }));

/** The review body; only an approval may have empty text, which comes out trimmed. */
export const reviewSchema = z
  .object(
    {
      event: z.enum(
        ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
        "invalid review",
      ),
      body: z.string("invalid review").optional(),
    },
    "invalid review",
  )
  .transform(({ event, body }) => ({ event, text: body?.trim() ?? "" }))
  .refine(
    ({ event, text }) =>
      text.length <= BODY_MAX && (event === "APPROVE" || text !== ""),
    "invalid review",
  );

export const mergeSchema = z.object(
  {
    sha: z.string("invalid sha").refine((sha) => SHA.test(sha), "invalid sha"),
  },
  "invalid sha",
);
