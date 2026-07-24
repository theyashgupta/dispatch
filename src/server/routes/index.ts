import { Router } from "express";
import { boardRouter } from "./board.route.js";
import { cardsRouter } from "./cards.route.js";
import { eventsRouter } from "./events.route.js";
import { sseRouter } from "./sse.route.js";
import { hooksRouter } from "./hooks.route.js";
import { setupRouter } from "./setup.route.js";
import { updateRouter } from "./update.route.js";
import { imagesRouter } from "./images.route.js";
import { playbooksRouter } from "./playbooks.route.js";

/**
 * Plain composition of the sub-routers — no nested gate here. The single enforcement point for
 * every `/api/*` request is the hoisted `remoteAuthRouter`, mounted as the FIRST `app.use()` in
 * `bootstrap/index.ts`, ahead of this router's mount.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export const apiRouter = Router();

apiRouter.use(boardRouter);
apiRouter.use(cardsRouter);
apiRouter.use(eventsRouter);
apiRouter.use(sseRouter);
apiRouter.use(hooksRouter);
apiRouter.use(setupRouter);
apiRouter.use(updateRouter);
apiRouter.use(imagesRouter);
apiRouter.use(playbooksRouter);
