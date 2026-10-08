import { Router } from "express";
import { boardRouter } from "./board.route.js";
import { boardsRouter } from "./boards.route.js";
import { boardPolicyRouter } from "./board-policy.route.js";
import { intakeRouter } from "./intake.route.js";
import { orchestratorsRouter } from "./orchestrators.route.js";
import { sessionInputRouter } from "./session-input.route.js";
import { cardsRouter } from "./cards.route.js";
import { decisionsRouter } from "./decisions.route.js";
import { eventsRouter } from "./events.route.js";
import { sessionsRouter } from "./sessions.route.js";
import { sseRouter } from "./sse.route.js";
import { hooksRouter } from "./hooks.route.js";
import { loopsRouter } from "./loops.route.js";
import { setupRouter } from "./setup.route.js";
import { updateRouter } from "./update.route.js";
import { imagesRouter } from "./images.route.js";
import { playbooksRouter } from "./playbooks.route.js";
import { remoteRouter } from "./remote.route.js";
import { vaultRouter } from "./vault.route.js";
import { archiveRouter } from "./archive.route.js";
import { pushRouter } from "./push.route.js";
import { viewerRouter } from "./viewer.route.js";
import { accountsRouter } from "./accounts.route.js";
import { itemsRouter } from "./items.route.js";
import { connectionRouter } from "./connection.route.js";
import { githubRouter } from "./github.route.js";
import { profileRouter } from "./profile.route.js";
import { linearRouter } from "./linear.route.js";
import { sentryRouter } from "./sentry.route.js";
import { slackRouter } from "./slack.route.js";
import { meetingsRouter } from "./meetings.route.js";
import { calendarRouter } from "./calendar.route.js";
import { workspacesRouter } from "./workspaces.route.js";
import { askRouter } from "./ask.route.js";
import { httpErrorHandler } from "./error-handler.js";
import {
  orchestratorRouter,
  refuseOrchestratorTokenOnUserRoute,
} from "./orchestrator.route.js";

/**
 * Composition of the sub-routers.
 *
 * @remarks The single enforcement point for every `/api/*` request is the hoisted
 * `remoteAuthRouter`, mounted as the FIRST `app.use()` in `bootstrap/index.ts`, ahead of this
 * router's mount. The one gate here only refuses an orchestrator token on a state-changing user
 * route.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export const apiRouter = Router();

apiRouter.use(refuseOrchestratorTokenOnUserRoute, httpErrorHandler);
apiRouter.use("/orchestrator", orchestratorRouter);
apiRouter.use(boardRouter);
apiRouter.use(boardsRouter);
apiRouter.use(boardPolicyRouter);
apiRouter.use(orchestratorsRouter);
apiRouter.use(intakeRouter);
apiRouter.use(sessionInputRouter);
apiRouter.use(cardsRouter);
apiRouter.use(decisionsRouter);
apiRouter.use(eventsRouter);
apiRouter.use(sessionsRouter);
apiRouter.use(sseRouter);
apiRouter.use(hooksRouter);
apiRouter.use(loopsRouter);
apiRouter.use(setupRouter);
apiRouter.use(updateRouter);
apiRouter.use(imagesRouter);
apiRouter.use(playbooksRouter);
apiRouter.use(remoteRouter);
apiRouter.use(vaultRouter);
apiRouter.use(archiveRouter);
apiRouter.use(pushRouter);
apiRouter.use(viewerRouter);
apiRouter.use(accountsRouter);
apiRouter.use(itemsRouter);
apiRouter.use(connectionRouter);
apiRouter.use(githubRouter);
apiRouter.use(profileRouter);
apiRouter.use(linearRouter);
apiRouter.use(sentryRouter);
apiRouter.use(slackRouter);
apiRouter.use(meetingsRouter);
apiRouter.use(calendarRouter);
apiRouter.use(workspacesRouter);
apiRouter.use(askRouter);
