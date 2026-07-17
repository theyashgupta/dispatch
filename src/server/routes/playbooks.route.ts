import { Router } from "express";
import {
  createPlaybook,
  updatePlaybook,
  deletePlaybook,
  loadPlaybooks,
  type PlaybookWriteInput,
} from "../services/playbooks.js";
import {
  generatePlaybookDraft,
  SourceUnreadableError,
} from "../services/playbook-generate.js";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_NAME_LEN = 80;
const MAX_BODY_BYTES = 262144;
const MAX_DIRECTION_LEN = 10000;
const MAX_SOURCE_PATHS = 8;

/**
 * Playbook CRUD + read routes, mounted behind the shared `apiRouter` loopback gate (never a
 * standalone router). Kickoff/picker resolution stays keyed on `Playbook.name` everywhere else in
 * the codebase; the `:slug` route param here is CRUD-only addressing, derived server-side by the
 * service layer, never accepted raw from a client as a filesystem path. Every mutating handler
 * re-validates its own body independently of any client-side check (the route is loopback-gated,
 * not trust-gated — any local process can POST arbitrary JSON) and maps every unexpected throw to
 * a generic 500 with no stack/path/fs-error text.
 */
export const playbooksRouter = Router();

playbooksRouter.get("/playbooks", async (req, res) => {
  const rawStage = req.query.stage;
  const stage =
    rawStage === "planning" || rawStage === "implementation"
      ? rawStage
      : undefined;
  if (rawStage !== undefined && stage === undefined) {
    res.status(400).json({ error: "Invalid stage" });
    return;
  }

  const playbooks = await loadPlaybooks(stage);
  res.status(200).json({ playbooks });
});

/** Shape and length-check a POST/PUT playbook body; returns the validated input or the 400 error key. */
function validateInput(
  body: unknown,
): { ok: true; input: PlaybookWriteInput } | { ok: false; error: string } {
  const b = body as
    { name?: unknown; stage?: unknown; body?: unknown } | undefined;

  const rawName = b?.name;
  if (typeof rawName !== "string") {
    return { ok: false, error: "invalid-name" };
  }
  const name = rawName.trim();
  if (
    name === "" ||
    name.length > MAX_NAME_LEN ||
    name.includes("\n") ||
    name.includes("\r")
  ) {
    return { ok: false, error: "invalid-name" };
  }

  const stage = b?.stage;
  if (stage !== "planning" && stage !== "implementation") {
    return { ok: false, error: "invalid-stage" };
  }

  const rawBody = b?.body;
  if (
    typeof rawBody !== "string" ||
    Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES
  ) {
    return { ok: false, error: "invalid-body" };
  }

  return { ok: true, input: { name, stage, body: rawBody } };
}

playbooksRouter.post("/playbooks", async (req, res) => {
  const validated = validateInput(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  try {
    const result = await createPlaybook(validated.input);
    if (!result.ok) {
      const status = result.error === "name-exists" ? 409 : 400;
      res.status(status).json({ error: result.error });
      return;
    }
    res.status(200).json({ playbook: result.playbook });
  } catch {
    res.status(500).json({ error: "playbook-write-failed" });
  }
});

playbooksRouter.put("/playbooks/:slug", async (req, res) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) {
    res.status(400).json({ error: "invalid-slug" });
    return;
  }

  const validated = validateInput(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  try {
    const result = await updatePlaybook(slug, validated.input);
    if (!result.ok) {
      const status =
        result.error === "not-found"
          ? 404
          : result.error === "name-exists"
            ? 409
            : 400;
      res.status(status).json({ error: result.error });
      return;
    }
    res.status(200).json({ playbook: result.playbook });
  } catch {
    res.status(500).json({ error: "playbook-write-failed" });
  }
});

playbooksRouter.delete("/playbooks/:slug", async (req, res) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) {
    res.status(400).json({ error: "invalid-slug" });
    return;
  }

  try {
    const result = await deletePlaybook(slug);
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ error: "playbook-write-failed" });
  }
});

playbooksRouter.post("/playbooks/generate", async (req, res) => {
  const b = req.body as
    { direction?: unknown; sourcePaths?: unknown } | undefined;

  const rawDirection = b?.direction;
  const direction = typeof rawDirection === "string" ? rawDirection.trim() : "";
  if (direction === "" || direction.length > MAX_DIRECTION_LEN) {
    res.status(400).json({ error: "invalid-direction" });
    return;
  }

  const rawSourcePaths = b?.sourcePaths;
  let sourcePaths: string[] = [];
  if (rawSourcePaths !== undefined) {
    if (
      !Array.isArray(rawSourcePaths) ||
      rawSourcePaths.length > MAX_SOURCE_PATHS ||
      !rawSourcePaths.every((p) => typeof p === "string")
    ) {
      res.status(400).json({ error: "invalid-sources" });
      return;
    }
    sourcePaths = rawSourcePaths;
  }

  try {
    const draft = await generatePlaybookDraft({ direction, sourcePaths });
    res.status(200).json({ draft });
  } catch (err) {
    if (err instanceof SourceUnreadableError) {
      res.status(400).json({ error: "source-unreadable" });
      return;
    }
    res.status(502).json({ error: "generate-failed" });
  }
});
