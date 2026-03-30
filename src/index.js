import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import { env, validateEnv } from "./config/env.js";
import v1Router from "./routes/v1.js";
import { createAssetsManifestRouter } from "./routes/assets.js";
import { startFcmDailyReminderCron } from "./jobs/fcmDailyReminderCron.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

validateEnv();
const { port, nodeEnv } = env;

const defaultAssetsRoot = path.join(__dirname, "../public/app-assets");
const assetsRoot =
  env.assetsRoot && env.assetsRoot.trim() !== ""
    ? path.resolve(env.assetsRoot)
    : defaultAssetsRoot;

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
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

/** 원격 에셋: GET /static/<상대경로> (예: static/cigarettes/foo.png, static/lottie/water.json) */
app.use(
  "/static",
  express.static(assetsRoot, {
    maxAge: nodeEnv === "production" ? "7d" : 0,
    etag: true,
    fallthrough: true,
  }),
);

app.use("/v1/assets", createAssetsManifestRouter(assetsRoot));
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
  console.log(`[nonsmokingbank-api] static assets from ${assetsRoot}`);
  startFcmDailyReminderCron();
});

