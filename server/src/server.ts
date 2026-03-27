import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import http from "http";
import { matchRouter } from "./routes/matches.ts";
import { attachWebSocketServer } from "./ws/server.ts";
import { securityMiddleware } from "./arcjet.ts";
import { commentaryRouter } from "./routes/commentary.ts";

dotenv.config();

const PORT = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);

app.use(express.json());

app.use(securityMiddleware());

app.use("/matches", matchRouter);
app.use("/matches/:id/commentary", commentaryRouter);

const { broadcastMatchCreated, broadcastCommentary } =
  attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary = broadcastCommentary;

app.get("/", (_: Request, res: Response) => {
  res.send("Welcome to the Sportz Server!");
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`WebSocket Server is running on ws://localhost:${PORT}/ws`);
});
