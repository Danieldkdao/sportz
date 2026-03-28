import { Router, type Request, type Response } from "express";
import {
  createMatchSchema,
  listMatchesQuerySchema,
  MATCH_STATUS,
  matchIdParamsSchema,
  updateScoreSchema,
} from "../validation/matches.ts";
import { db } from "../db/db.ts";
import { MatchTable } from "../db/schema.ts";
import { getMatchStatus, syncMatchStatus } from "../utils/match-status.ts";
import { desc, eq } from "drizzle-orm";
import { MAX_LIMIT } from "../lib/constants.ts";

export const matchRouter = Router();

matchRouter.get("/", async (req: Request, res: Response) => {
  const parsed = listMatchesQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid query", details: parsed.error.issues });
  }

  const limit = Math.min(parsed.data.limit ?? 50, MAX_LIMIT);

  try {
    const matches = await db
      .select()
      .from(MatchTable)
      .orderBy(desc(MatchTable.createdAt), desc(MatchTable.id))
      .limit(limit);
    return res.json({ data: matches });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to list matches.",
      details: JSON.stringify(error),
    });
  }
});

matchRouter.post("/", async (req: Request, res: Response) => {
  const parsed = createMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: parsed.error.issues,
    });
  }
  const {
    data: { startTime, endTime, homeScore, awayScore },
  } = parsed;

  try {
    const [insertedMatch] = await db
      .insert(MatchTable)
      .values({
        ...parsed.data,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        homeScore: homeScore ?? 0,
        awayScore: awayScore ?? 0,
        status: getMatchStatus(startTime, endTime) ?? "scheduled",
      })
      .returning();

    if (res.app.locals.broadcastMatchCreated) {
      res.app.locals.broadcastMatchCreated(insertedMatch);
    }

    return res.status(201).json({ data: insertedMatch });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to create match",
      details: JSON.stringify(error),
    });
  }
});

matchRouter.patch("/:id/score", async (req: Request, res: Response) => {
  const paramsParsed = matchIdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid match id", details: paramsParsed.error.issues });
  }

  const bodyParsed = updateScoreSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid payload", details: bodyParsed.error.issues });
  }

  const matchId = paramsParsed.data.id;

  try {
    const [existingMatch] = await db
      .select()
      .from(MatchTable)
      .where(eq(MatchTable.id, matchId))
      .limit(1);

    if (!existingMatch) {
      return res.status(404).json({ error: "Match not found" });
    }

    await syncMatchStatus(existingMatch, async (nextStatus) => {
      await db
        .update(MatchTable)
        .set({ status: nextStatus })
        .where(eq(MatchTable.id, matchId));
    });

    if (existingMatch.status !== MATCH_STATUS.LIVE) {
      return res.status(409).json({ error: "Match is not live" });
    }

    const [updatedMatch] = await db
      .update(MatchTable)
      .set({
        homeScore: bodyParsed.data.homeScore,
        awayScore: bodyParsed.data.awayScore,
      })
      .where(eq(MatchTable.id, matchId))
      .returning();

    if (res.app.locals.broadcastScoreUpdates) {
      res.app.locals.broadcastScoreUpdates(matchId, {
        homeScore: updatedMatch?.homeScore ?? 0,
        awayScore: updatedMatch?.awayScore ?? 0,
      });
    }

    return res.json({ data: updatedMatch });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update score" });
  }
});
