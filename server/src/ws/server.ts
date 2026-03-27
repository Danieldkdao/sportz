import type { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import type { MatchTable } from "../db/schema.ts";
import { wsArcjet } from "../arcjet.ts";
import type { Request } from "express";
import { matchIdParamsSchema } from "../validation/matches.ts";

const matchSubscribers = new Map();

export const subscribe = (matchId: string, socket: WebSocket) => {
  if (!matchSubscribers.has(matchId)) {
    matchSubscribers.set(matchId, new Set());
  }

  matchSubscribers.get(matchId).add(socket);
};

const unsubscribe = (matchId: string, socket: WebSocket) => {
  const subscribers = matchSubscribers.get(matchId);

  if (!subscribers) return;

  subscribers.delete(socket);

  if (subscribers.size === 0) {
    matchSubscribers.delete(matchId);
  }
};

export const cleanupSubscriptions = (socket: ExtWebSocket) => {
  for (const matchId of socket.subscriptions) {
    unsubscribe(matchId, socket);
  }
};

export const broadcastToMatch = (matchId: string, payload: any) => {
  const subscribers = matchSubscribers.get(matchId);

  if (!subscribers || subscribers.size === 0) return;

  const message = JSON.stringify(payload);

  for (const client of subscribers) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
};

const sendJson = (socket: WebSocket, payload: any) => {
  if (socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify(payload));
};

const broadcastToAll = (wss: WebSocketServer, payload: any) => {
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
  }

  if (
    message?.type === "subscribe" &&
    matchIdParamsSchema.safeParse({ id: message.matchId }).success
  ) {
    subscribe(message.matchId, socket);
    socket.subscriptions.add(message.matchId);
    sendJson(socket, { type: "subscribed", matchId: message.matchId });
  }

  if (
    message?.type === "unsubscribe" &&
    matchIdParamsSchema.safeParse({ id: message.matchId }).success
  ) {
    unsubscribe(message.matchId, socket);
    socket.subscriptions.delete(message.matchId);
    sendJson(socket, { type: "unsubscribed", matchId: message.matchId });
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

  const broadcastCommentary = (matchId: string, comment: string) => {
    broadcastToMatch(matchId, { type: "commentary", data: comment });
  };

  return { broadcastMatchCreated, broadcastCommentary };
};
