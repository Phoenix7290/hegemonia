import express from "express";
import { MatchmakingEnqueueSchema } from "@hegemonia/shared";
import { identity, optionalIdentity, requireIdentity } from "./http.js";
import { matchmakingService } from "./matchmaking.js";

export function createMatchmakingRouter(): express.Router {
  const router = express.Router();
  router.use(optionalIdentity);
  router.use(requireIdentity);

  router.post("/queue", async (req, res, next) => {
    try {
      const input = MatchmakingEnqueueSchema.parse(req.body);
      res.status(201).json(await matchmakingService.enqueue(identity(res).user.id, input));
    } catch (error) { next(error); }
  });

  router.get("/status", async (_req, res, next) => {
    try {
      res.json(await matchmakingService.getStatus(identity(res).user.id));
    } catch (error) { next(error); }
  });

  router.delete("/queue", async (_req, res, next) => {
    try {
      res.json(await matchmakingService.cancel(identity(res).user.id));
    } catch (error) { next(error); }
  });

  return router;
}
