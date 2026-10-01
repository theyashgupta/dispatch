import { Router } from "express";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";
import {
  generateSchema,
  slugSchema,
  writeSchema,
} from "./playbooks-schemas.js";
import {
  createPlaybook,
  updatePlaybook,
  deletePlaybook,
  loadPlaybooks,
  loadPlaybooksForPicker,
  type PlaybookWriteResult,
} from "../services/infra/playbooks.js";
import {
  generatePlaybookDraft,
  SourceUnreadableError,
} from "../services/orchestration/playbook-generate.js";
import { getOrchestrationConfig } from "../services/infra/config-holder.js";
import {
  ConflictError,
  HttpError,
  InternalError,
  NotFoundError,
  UpstreamError,
  ValidationError,
} from "../services/domain/errors.js";

/**
 * Playbook CRUD + read routes, mounted behind the single app-level gate hoisted in
 * `bootstrap/index.ts` (never a standalone router). Kickoff/picker resolution stays keyed on
 * `Playbook.name` everywhere else in the codebase; the `:slug` route param here is CRUD-only
 * addressing, derived server-side by the service layer, never accepted raw from a client as a
 * filesystem path. Every mutating handler re-validates its own body independently of any
 * client-side check (the route is gated by loopback OR a valid remote session, not trust-gated —
 * any request past the gate can still POST arbitrary JSON) and maps every unexpected throw to
 * a generic 500 with no stack/path/fs-error text. `GET /playbooks/picker` is the one read route
 * with no client input reaching any path operation, so it maps unexpected throws to the same
 * generic-500 discipline without needing per-field validation first — it is the StartModal
 * picker's data source: valid playbooks alongside malformed ones (with a safe reason) plus the
 * remembered default.
 */
export const playbooksRouter = Router();

/** Map a failed playbook write to the typed error that carries its status. */
function toHttpError(
  code: Extract<PlaybookWriteResult, { ok: false }>["error"],
): HttpError {
  switch (code) {
    case "not-found":
      return new NotFoundError(code);
    case "name-exists":
      return new ConflictError(code);
    case "footgun":
      return new ValidationError(code);
  }
}

function writeFailed(): never {
  throw new InternalError("playbook-write-failed");
}

playbooksRouter.get("/playbooks", async (_req, res) => {
  const playbooks = await loadPlaybooks();
  res.status(200).json({ playbooks });
});

playbooksRouter.get("/playbooks/picker", async (_req, res) => {
  try {
    const { valid, invalid } = await loadPlaybooksForPicker();
    const lastUsed = getOrchestrationConfig()?.lastUsedPlaybook ?? null;
    res.status(200).json({ valid, invalid, lastUsed });
  } catch {
    throw new InternalError("playbook-picker-failed");
  }
});

playbooksRouter.post("/playbooks", async (req, res) => {
  const input = parseOrThrow(writeSchema, req.body);
  const result = await createPlaybook(input).catch(writeFailed);
  if (!result.ok) throw toHttpError(result.error);
  res.status(200).json({ playbook: result.playbook });
});

playbooksRouter.put("/playbooks/:slug", async (req, res) => {
  const slug = parseOrThrow(slugSchema, req.params.slug);
  const input = parseOrThrow(writeSchema, req.body);
  const result = await updatePlaybook(slug, input).catch(writeFailed);
  if (!result.ok) throw toHttpError(result.error);
  res.status(200).json({ playbook: result.playbook });
});

playbooksRouter.delete("/playbooks/:slug", async (req, res) => {
  const slug = parseOrThrow(slugSchema, req.params.slug);
  const result = await deletePlaybook(slug).catch(writeFailed);
  if (!result.ok) throw toHttpError(result.error);
  res.status(200).json({ ok: true });
});

/**
 * Module-level single-flight guard for `POST /playbooks/generate` (mirrors {@link runUpdate}'s
 * in-flight promise): each `claude -p` spawn already runs up to 150s with a 10MB buffer, and the
 * client-side `generating` flag only bounds one editor panel, not the loopback API itself. Rather
 * than sharing the in-flight result across callers (wrong here — each request has its own
 * direction/sourcePaths), a second concurrent call is rejected with 409 so the server never fans
 * out parallel subprocesses.
 */
let generateInFlight = false;

playbooksRouter.post("/playbooks/generate", async (req, res) => {
  const { direction, sourcePaths = [] } = parseOrThrow(
    generateSchema,
    req.body,
  );
  if (generateInFlight) throw new ConflictError("generate-in-progress");

  generateInFlight = true;
  try {
    const draft = await generatePlaybookDraft({ direction, sourcePaths });
    res.status(200).json({ draft });
  } catch (err) {
    if (err instanceof SourceUnreadableError) {
      throw new ValidationError("source-unreadable");
    }
    throw new UpstreamError("generate-failed");
  } finally {
    generateInFlight = false;
  }
});

playbooksRouter.use(httpErrorHandler);
