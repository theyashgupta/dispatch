import { Router } from "express";
import { isLocalRequest } from "./loopback.js";
import { boardRouter } from "./board.route.js";
import { cardsRouter } from "./cards.route.js";
import { eventsRouter } from "./events.route.js";
import { sseRouter } from "./sse.route.js";
import { hooksRouter } from "./hooks.route.js";
import { setupRouter } from "./setup.route.js";
import { updateRouter } from "./update.route.js";
import { imagesRouter } from "./images.route.js";

export const apiRouter = Router();

apiRouter.use((req, res, next) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: "non-local requests are not allowed" });
    return;
  }
  next();
});

apiRouter.use(boardRouter);
apiRouter.use(cardsRouter);
apiRouter.use(eventsRouter);
apiRouter.use(sseRouter);
apiRouter.use(hooksRouter);
apiRouter.use(setupRouter);
apiRouter.use(updateRouter);
apiRouter.use(imagesRouter);
