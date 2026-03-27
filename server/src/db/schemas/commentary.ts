import { relations } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { MatchTable } from "./match.ts";

export const CommentaryTable = pgTable("commentary", {
  id: uuid().primaryKey().defaultRandom(),
  matchId: uuid("match_id")
    .references(() => MatchTable.id, { onDelete: "cascade" })
    .notNull(),
  actor: varchar("actor"),
  message: varchar("message").notNull(),
  minute: integer("minute"),
  sequence: integer("sequence"),
  period: varchar("period"),
  eventType: varchar("eventType"),
  metadata: jsonb("metadata"),
  tags: varchar("tags").array(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const commentaryRelations = relations(CommentaryTable, ({ one }) => ({
  match: one(MatchTable, {
    fields: [CommentaryTable.matchId],
    references: [MatchTable.id],
  }),
}));
