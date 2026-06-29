import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
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

// ── Rate Limiting ──────────────────────────────────────────────────────────
// 인증 엔드포인트: 1분에 최대 10회 (브루트포스 방지)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "TOO_MANY_REQUESTS", message: "Too many requests, please try again later." },
  skip: () => nodeEnv !== "production",
});

// 일반 API: 1분에 최대 120회
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "TOO_MANY_REQUESTS", message: "Too many requests, please try again later." },
  skip: () => nodeEnv !== "production",
});

app.use("/v1/auth", authLimiter);
app.use("/v1", generalLimiter);
// ──────────────────────────────────────────────────────────────────────────

// 일반 API: 1MB / 이미지 base64 업로드가 포함된 경로만 10MB 허용
app.use((req, res, next) => {
  const isImageRoute =
    req.method === "POST" &&
    /^\/v1\/quit-rooms\/[^/]+\/posts/.test(req.path);
  express.json({ limit: isImageRoute ? "10mb" : "1mb" })(req, res, next);
});
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

