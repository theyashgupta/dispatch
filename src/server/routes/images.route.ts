import { Router } from "express";
import { fetchLinearImage, ImageProxyError } from "../services/image-proxy.js";
import { isLinearUploadUrl } from "../../shared/linear-asset-url.js";

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

imagesRouter.get("/images", async (req, res) => {
  const url = req.query.url;
  if (typeof url !== "string" || !isLinearUploadUrl(url)) {
    res.status(400).json({ error: "invalid-url" });
    return;
  }
  try {
    await fetchLinearImage(url, res);
  } catch (err) {
    if (!res.headersSent) {
      res
        .status(err instanceof ImageProxyError ? 502 : 500)
        .json({ error: "image-fetch-failed" });
    } else {
      res.destroy();
    }
  }
});
