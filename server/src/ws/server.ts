import type { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import type { MatchTable } from "../db/schema.ts";

const sendJson = (socket: WebSocket, payload: any) => {
  if (socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify(payload));
};

const broadcast = (wss: WebSocketServer, payload: any) => {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    client.send(JSON.stringify(payload));
  }
};

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
}

export const attachWebSocketServer = (server: Server) => {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 1024 * 1024,
  });

  wss.on("connection", (socket: ExtWebSocket) => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    sendJson(socket, { type: "welcome" });

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
    broadcast(wss, { type: "match_created", data: match });
  };

  return { broadcastMatchCreated };
};
