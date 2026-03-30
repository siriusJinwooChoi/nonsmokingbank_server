import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import authRouter from "./auth.js";
import profileRouter from "./profile.js";
import syncRouter from "./sync.js";
import reasonsRouter from "./reasons.js";
import attendanceRouter from "./attendance.js";
import coinsRouter from "./coins.js";
import gamesRouter from "./games.js";
import devicesRouter from "./devices.js";

const router = Router();

router.get("/health", (req, res) => {
  res.status(200).json({ ok: true, version: "v1" });
});

router.use("/auth", authRouter);
router.use("/profile", requireAuth, profileRouter);
router.use("/sync", requireAuth, syncRouter);
router.use("/reasons", requireAuth, reasonsRouter);
router.use("/attendance", requireAuth, attendanceRouter);
router.use("/coins", requireAuth, coinsRouter);
router.use("/games", requireAuth, gamesRouter);
router.use("/devices", requireAuth, devicesRouter);

export default router;

