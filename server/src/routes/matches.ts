import { Router, type Request, type Response } from "express";
import {
  createMatchSchema,
  listMatchesQuerySchema,
} from "../validation/matches.ts";
import { db } from "../db/db.ts";
import { MatchTable } from "../db/schema.ts";
import { getMatchStatus } from "../utils/match-status.ts";
import { desc } from "drizzle-orm";

export const matchRouter = Router();

const MAX_LIMIT = 100;

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
