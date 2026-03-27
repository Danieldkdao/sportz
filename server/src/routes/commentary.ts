import { Router, type Request, type Response } from "express";
import { matchIdParamsSchema } from "../validation/matches.ts";
import {
  createCommentarySchema,
  listCommentaryQuerySchema,
} from "../validation/commentary.ts";
import { db } from "../db/db.ts";
import { CommentaryTable } from "../db/schema.ts";
import { MAX_LIMIT } from "../lib/constants.ts";
import { desc, eq } from "drizzle-orm";

export const commentaryRouter = Router({ mergeParams: true });

commentaryRouter.get("/", async (req: Request, res: Response) => {
  const paramsResult = matchIdParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res
      .status(400)
      .json({ error: "Invalid match ID.", details: paramsResult.error.issues });
  }

  const queryResult = listCommentaryQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res
      .status(400)
      .json({ error: "Invalid limit.", details: queryResult.error.issues });
  }

  const limit = Math.min(queryResult.data.limit ?? 50, MAX_LIMIT);

  try {
    const commentaryData = await db
      .select()
      .from(CommentaryTable)
      .where(eq(CommentaryTable.matchId, paramsResult.data.id))
      .orderBy(desc(CommentaryTable.createdAt), desc(CommentaryTable.id))
      .limit(limit);

    return res.json({ data: commentaryData });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to list commentary.",
      details: JSON.stringify(error),
    });
  }
});

commentaryRouter.post("/", async (req: Request, res: Response) => {
  const paramsResult = matchIdParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res
      .status(400)
      .json({ error: "Invalid match ID.", details: paramsResult.error.issues });
  }

  const bodyResult = createCommentarySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({
      error: "Invalid commentary payload.",
      details: bodyResult.error.issues,
    });
  }

  try {
    const { minute, ...rest } = bodyResult.data;
    const [insertedCommentary] = await db
      .insert(CommentaryTable)
      .values({
        matchId: paramsResult.data.id,
        minute,
        ...rest,
      })
      .returning();

    if (res.app.locals.broadcastCommentary) {
      res.app.locals.broadcastCommentary(
        insertedCommentary?.matchId,
        insertedCommentary,
      );
    }

    return res.status(201).json({ data: insertedCommentary });
  } catch (error) {
    console.error("Failed to create commentary:", error);
    return res.status(500).json({ error: "Failed to create commentary." });
  }
});
