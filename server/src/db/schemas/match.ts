import { relations } from "drizzle-orm";
import {
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { CommentaryTable } from "./commentary.ts";

export const matchStatuses = ["scheduled", "live", "finished"] as const;
export type MatchStatusType = (typeof matchStatuses)[number];
export const matchStatusEnum = pgEnum("match-statuses", matchStatuses);

export const MatchTable = pgTable("matches", {
  id: uuid().primaryKey().defaultRandom(),
  homeTeam: varchar("home_team").notNull(),
  awayTeam: varchar("away_team").notNull(),
  sport: varchar("sport").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }),
  status: matchStatusEnum("status").notNull(),
  homeScore: integer("home_score").notNull().default(0),
  awayScore: integer("away_score").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const matchRelations = relations(MatchTable, ({ many }) => ({
  commentary: many(CommentaryTable),
}));
