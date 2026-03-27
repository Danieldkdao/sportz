import type { MatchStatusType, MatchTable } from "../db/schema.ts";
import { MATCH_STATUS } from "../validation/matches.ts";

type DateType = Date | string | number;

export const getMatchStatus = (
  startTime: DateType,
  endTime: DateType | string,
  now: DateType = new Date(),
) => {
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  if (now < start) {
    return MATCH_STATUS.SCHEDULED;
  }

  if (now >= end) {
    return MATCH_STATUS.FINISHED;
  }

  return MATCH_STATUS.LIVE;
};

export const syncMatchStatus = async (
  match: typeof MatchTable.$inferSelect,
  updateStatus: (status: MatchStatusType) => Promise<void>,
) => {
  const nextStatus = getMatchStatus(match.startTime, match.endTime);
  if (!nextStatus) {
    return match.status;
  }

  if (match.status !== nextStatus) {
    await updateStatus(nextStatus);
    match.status = nextStatus;
  }
  return match.status;
};
