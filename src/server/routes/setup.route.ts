import { Router } from "express";
import { httpErrorHandler } from "./error-handler.js";
import { z } from "zod";
import { parseOrThrow } from "./parse-input.js";
import {
  getOrchestrationConfig,
  markOnboardingDone,
  updateLinearApiKey,
} from "../services/infra/config-holder.js";
import {
  installArgv,
  probePreflight,
  runInstall,
} from "../services/infra/preflight.js";
import {
  rebuildSources,
  testLinearConnection,
} from "../adapters/source-gateway.js";
import { startEnabledPollers } from "../adapters/poller.js";
import { invalidateWorkflow } from "../services/orchestration/linear-outbound.js";
import {
  ConflictError,
  InternalError,
  UpstreamError,
  ValidationError,
} from "../services/domain/errors.js";

/**
 * First-run onboarding surface behind the shared `/api` loopback guard.
 *
 * @remarks GET `/setup` never returns the key itself — `needsKey` is derived from its presence — so a
 * first-run browser can read the status and live prerequisite checklist plus the informative
 * `node`/`storage` lines from the one shared preflight model (the same source `dispatch doctor`
 * renders) without leaking the secret. POST `/setup` is test-before-persist: a live `viewer { id }`
 * check runs BEFORE the key touches disk, so a rejected (400) or unreachable (502) key is never
 * written and can never land the user on a broken empty board. Persist + source rebuild + poller
 * start happen only on a verified key; a 409 short-circuits when a key already exists so a live key is
 * never overwritten and the poller is never double-started. The key is never logged or echoed back.
 * POST `/setup/install` drives the SAME shared `runInstall` non-interactively (request/response, never
 * streamed, never privilege-escalating): `target` is whitelist-validated against `installArgv` (tmux/ttyd/git only)
 * and mapped to a server-side constant argv — request input never reaches a shell — with a 400 for a
 * non-installable target and a generic 500 (no stack) on an unexpected throw; the 200 body carries the
 * freshly re-probed status so the setup screen can flip the row. POST `/setup/onboarding-done` records
 * that the setup wizard was closed (204, idempotent) so it never opens on its own again.
 */
export const setupRouter = Router();

const installSchema = z.object(
  {
    target: z
      .string("not-installable")
      .refine((target) => installArgv(target) != null, "not-installable"),
  },
  "not-installable",
);

const apiKeySchema = z.object(
  {
    apiKey: z.string("apiKey is required").trim().min(1, "apiKey is required"),
  },
  "apiKey is required",
);

setupRouter.get("/setup", async (_req, res) => {
  const config = getOrchestrationConfig();
  const needsKey = !config?.linearApiKey;
  const report = await probePreflight();
  res.status(200).json({
    needsKey,
    onboardingDone: config?.onboardingDone === true,
    prerequisites: report.binaries,
    node: report.node,
    storage: report.storage,
  });
});

setupRouter.post("/setup/onboarding-done", (_req, res) => {
  markOnboardingDone();
  res.status(204).end();
});

setupRouter.post("/setup/install", async (req, res) => {
  const { target } = parseOrThrow(installSchema, req.body);
  try {
    const { ok, command, status } = await runInstall(target, {
      interactive: false,
    });
    res.status(200).json({ ok, command, status });
  } catch {
    throw new InternalError("install-failed");
  }
});

setupRouter.post("/setup", async (req, res) => {
  if (getOrchestrationConfig()?.linearApiKey) {
    throw new ConflictError("already-configured");
  }
  const { apiKey } = parseOrThrow(apiKeySchema, req.body);
  let ok: boolean;
  try {
    ok = await testLinearConnection(apiKey);
  } catch {
    throw new UpstreamError("unreachable");
  }
  if (!ok) throw new ValidationError("rejected");
  updateLinearApiKey(apiKey);
  rebuildSources(getOrchestrationConfig()!);
  invalidateWorkflow();
  startEnabledPollers();
  res.status(200).json({ ok: true });
});

setupRouter.use(httpErrorHandler);
