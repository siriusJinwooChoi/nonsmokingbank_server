import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env, validateEnv } from "./config/env.js";
import v1Router from "./routes/v1.js";

const app = express();

validateEnv();
const { port, nodeEnv } = env;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan(nodeEnv === "production" ? "combined" : "dev"));

app.get("/", (req, res) => {
  res.status(200).json({
    service: "nonsmokingbank-api",
    status: "ok",
    message: "API server is running",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "nonsmokingbank-api",
    env: nodeEnv,
    time: new Date().toISOString(),
  });
});

app.use("/v1", v1Router);

app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: `No route for ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "Unexpected server error",
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[nonsmokingbank-api] listening on 0.0.0.0:${port}`);
});

