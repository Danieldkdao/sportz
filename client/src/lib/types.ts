export type Match = {
  id: string | number;
  sport: string;
  homeTeam: string;
  status: string;
  startTime: string;
  endTime?: string;
  homeScore: number;
  awayScore: number;
  createdAt?: string;
};

export type MatchResponse = {
  data: Match[];
};

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type Commentary = {
  id: string | number;
  matchId: string | number;
  minute?: number;
  sequence?: number;
  period?: string;
  eventType?: string;
  actor?: string;
  team?: string;
  message: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  createdAt?: string;
};

export type CommentaryResponse = {
  data: Commentary[];
};

export type WSMessageCommentary = {
  type: "commentary";
  data: Commentary;
};

export type WSMessageScore = {
  type: "score_update";
  matchId: string | number;
  data: {
    homeScore: number;
    awayScore: number;
  };
};

export type WSMessageWelcome = {
  type: "welcome";
  message?: string;
};

export type WSMessagePong = {
  type: "pong";
};

export type WSMessageError = {
  type: "error";
  code: string;
  message: string;
};

export type WSMessageSubscribed = {
  type: "subscribed";
  matchId: string | number;
};

export type WSMessageUnsubscribed = {
  type: "unsubscribed";
  matchId: string | number;
};

export type WSMessageSubscriptions = {
  type: "subscriptions";
  matchIds: Array<string | number>;
};

export type WSMessageSubscribedAll = {
  type: "subscribed_all";
};

export type WSMessageUnsubscribedAll = {
  type: "unsubscribed_all";
};

export type WSMessage =
  | WSMessageCommentary
  | WSMessageScore
  | WSMessageWelcome
  | WSMessagePong
  | WSMessageError
  | WSMessageSubscribed
  | WSMessageUnsubscribed
  | WSMessageSubscriptions
  | WSMessageSubscribedAll
  | WSMessageUnsubscribedAll;
