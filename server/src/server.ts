import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import http from "http";
import { matchRouter } from "./routes/matches.ts";
import { attachWebSocketServer } from "./ws/server.ts";

dotenv.config();

const PORT = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);

app.use(express.json());

app.use("/matches", matchRouter);

const { broadcastMatchCreated } = attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;

app.get("/", (_: Request, res: Response) => {
  res.send("Welcome to the Sportz Server!");
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`WebSocket Server is running on ws://localhost:${PORT}/ws`);
});
