import type { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import type { MatchTable } from "../db/schema.ts";
import { wsArcjet } from "../arcjet.ts";
import type { Request } from "express";
import { matchIdParamsSchema } from "../validation/matches.ts";

const matchSubscribers = new Map<string, Set<WebSocket>>();

const getMatchSubscriptionKey = (matchId: string | number) => String(matchId);

export const subscribe = (matchId: string | number, socket: WebSocket) => {
  const key = getMatchSubscriptionKey(matchId);
  if (!matchSubscribers.has(key)) {
    matchSubscribers.set(key, new Set());
  }

  matchSubscribers.get(key)?.add(socket);
};

const unsubscribe = (matchId: string | number, socket: WebSocket) => {
  const key = getMatchSubscriptionKey(matchId);
  const subscribers = matchSubscribers.get(key);

  if (!subscribers) return;

  subscribers.delete(socket);

  if (subscribers.size === 0) {
    matchSubscribers.delete(key);
  }
};

export const cleanupSubscriptions = (socket: ExtWebSocket) => {
  for (const matchId of socket.subscriptions) {
    unsubscribe(matchId, socket);
  }
};

export const broadcastToMatch = (
  matchId: string | number,
  payload: unknown,
) => {
  const subscribers = matchSubscribers.get(getMatchSubscriptionKey(matchId));

  if (!subscribers || subscribers.size === 0) return;

  const message = JSON.stringify(payload);

  for (const client of subscribers) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
};

const sendJson = (socket: WebSocket, payload: unknown) => {
  if (socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify(payload));
};

const broadcastToAll = (wss: WebSocketServer, payload: unknown) => {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    client.send(JSON.stringify(payload));
  }
};

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
  subscriptions: Set<string>;
}

const handleMessage = (socket: ExtWebSocket, data: WebSocket.RawData) => {
  let message;

  try {
    message = JSON.parse(data.toString());
  } catch (error) {
    sendJson(socket, { type: "error", message: "Invalid JSON" });
    return;
  }

  if (
    message?.type === "subscribe" &&
    matchIdParamsSchema.safeParse({ id: message.matchId }).success
  ) {
    const matchIdResult = matchIdParamsSchema.safeParse({
      id: message.matchId,
    });
    if (!matchIdResult.success) {
      return;
    }
    const key = getMatchSubscriptionKey(matchIdResult.data.id);
    subscribe(key, socket);
    socket.subscriptions.add(key);
    sendJson(socket, { type: "subscribed", matchId: matchIdResult.data.id });
  }

  if (
    message?.type === "unsubscribe" &&
    matchIdParamsSchema.safeParse({ id: message.matchId }).success
  ) {
    const matchIdResult = matchIdParamsSchema.safeParse({
      id: message.matchId,
    });
    if (!matchIdResult.success) {
      return;
    }
    const key = getMatchSubscriptionKey(matchIdResult.data.id);
    unsubscribe(key, socket);
    socket.subscriptions.delete(key);
    sendJson(socket, { type: "unsubscribed", matchId: matchIdResult.data.id });
  }

  if (message?.type === "setSubscriptions" && Array.isArray(message.matchIds)) {
    cleanupSubscriptions(socket);
    socket.subscriptions.clear();

    const subscribedMatchIds: number[] = [];

    for (const matchId of message.matchIds) {
      const matchIdResult = matchIdParamsSchema.safeParse({ id: matchId });
      if (!matchIdResult.success) {
        continue;
      }

      const key = getMatchSubscriptionKey(matchIdResult.data.id);
      subscribe(key, socket);
      socket.subscriptions.add(key);
      subscribedMatchIds.push(matchIdResult.data.id);
    }

    sendJson(socket, { type: "subscriptions", matchIds: subscribedMatchIds });
  }
};

export const attachWebSocketServer = (server: Server) => {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 1024 * 1024,
  });

  server.on("upgrade", async (req: Request, socket: WebSocket) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);

    if (pathname !== "/ws") {
      return;
    }

    if (wsArcjet) {
      try {
        const decision = await wsArcjet.protect(req);

        if (decision.isDenied()) {
          const code = decision.reason.isRateLimit() ? 1013 : 1008;
          const reason = decision.reason.isRateLimit()
            ? "Rate limit exceeded"
            : "Access denied";

          socket.close(code, reason);
          return;
        }
      } catch (error) {
        console.error("WS Connection error", error);
        socket.close(1011, "Server secuity error");
        return;
      }
    }
  });

  wss.on("connection", async (socket: ExtWebSocket, _: Request) => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.subscriptions = new Set<string>();

    sendJson(socket, { type: "welcome" });

    socket.on("message", (data) => {
      handleMessage(socket, data);
    });

    socket.on("error", () => {
      socket.terminate();
    });

    socket.on("close", () => {
      cleanupSubscriptions(socket);
    });

    socket.on("error", console.error);
  });

  const interval = setInterval(() => {
    wss.clients.forEach((client) => {
      const ws = client as ExtWebSocket;
      if (ws.isAlive === false) return ws.terminate();

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => clearInterval(interval));

  const broadcastMatchCreated = (match: typeof MatchTable.$inferSelect) => {
    broadcastToAll(wss, { type: "match_created", data: match });
  };

  const broadcastCommentary = (
    matchId: string | number,
    comment: typeof MatchTable.$inferSelect | unknown,
  ) => {
    broadcastToMatch(matchId, { type: "commentary", data: comment });
  };

  const broadcastScoreUpdates = (
    matchId: string | number,
    { homeScore, awayScore }: { homeScore: number; awayScore: number },
  ) => {
    broadcastToMatch(matchId, {
      type: "score_update",
      matchId,
      data: { homeScore, awayScore },
    });
  };

  return { broadcastMatchCreated, broadcastCommentary, broadcastScoreUpdates };
};
