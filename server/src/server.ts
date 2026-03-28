import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import http from "http";
import { matchRouter } from "./routes/matches.ts";
import { attachWebSocketServer } from "./ws/server.ts";
import { commentaryRouter } from "./routes/commentary.ts";
import cors from "cors";

dotenv.config();

const PORT = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(
  cors({
    origin: process.env.APP_URL!,
    methods: ["GET", "POST", "PATCH"],
  }),
);

// app.use(securityMiddleware());
// todo: add later after test

app.use("/matches", matchRouter);
app.use("/matches/:id/commentary", commentaryRouter);

const { broadcastMatchCreated, broadcastCommentary, broadcastScoreUpdates } =
  attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary = broadcastCommentary;
app.locals.broadcastScoreUpdates = broadcastScoreUpdates;

app.get("/", (_: Request, res: Response) => {
  res.send("Welcome to the Sportz Server!");
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`WebSocket Server is running on ws://localhost:${PORT}/ws`);
});
