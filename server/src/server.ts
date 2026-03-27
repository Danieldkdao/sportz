import express, { type Request, type Response } from "express";
import dotenv from "dotenv";
import { matchRouter } from "./routes/matches.ts";

dotenv.config();

const app = express();
app.use(express.json());

app.use("/matches", matchRouter);

app.get("/", (_: Request, res: Response) => {
  res.send("Welcome to the Sportz Server!");
});

app.listen(8000, () => console.log("Express Server listening on PORT 8000!"));
