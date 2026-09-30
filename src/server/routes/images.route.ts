import { Router } from "express";
import { httpErrorHandler } from "./error-handler.js";
import { z } from "zod";
import { parseOrThrow } from "./parse-input.js";
import { fetchLinearImage, ImageProxyError } from "../adapters/image-proxy.js";
import { isLinearUploadUrl } from "../../shared/linear-asset-url.js";
import { InternalError, UpstreamError } from "../services/domain/errors.js";

/**
 * Loopback-gated inline-image proxy behind the shared `/api` guard.
 *
 * @remarks The allowlist is re-validated server-side even though the client already filters with
 * the same shared predicate — this route is the trust boundary, and a hand-crafted request must
 * be rejected regardless of what any browser decided. Upstream failures map to 502 so the
 * client's placeholder (never an error page) is the degrade path; once bytes have started
 * streaming, a mid-stream failure cannot change the status line, so the handler destroys the
 * response instead and lets the browser's own image error handling take over.
 */
export const imagesRouter = Router();

const querySchema = z.object(
  {
    url: z.string("invalid-url").refine(isLinearUploadUrl, "invalid-url"),
  },
  "invalid-url",
);

imagesRouter.get("/images", async (req, res) => {
  const { url } = parseOrThrow(querySchema, req.query);
  try {
    await fetchLinearImage(url, res);
  } catch (err) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    throw err instanceof ImageProxyError
      ? new UpstreamError("image-fetch-failed")
      : new InternalError("image-fetch-failed");
  }
});

imagesRouter.use(httpErrorHandler);
