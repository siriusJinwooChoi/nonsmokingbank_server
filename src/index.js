import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

const app = express();

const port = Number(process.env.PORT || 3000);
const nodeEnv = process.env.NODE_ENV || "development";

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

// API version prefix placeholder
app.get("/v1/health", (req, res) => {
  res.status(200).json({ ok: true, version: "v1" });
});

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

