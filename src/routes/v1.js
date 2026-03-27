import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import reasonsRouter from "./reasons.js";
import attendanceRouter from "./attendance.js";
import coinsRouter from "./coins.js";
import gamesRouter from "./games.js";

const router = Router();

router.get("/health", (req, res) => {
  res.status(200).json({ ok: true, version: "v1" });
});

router.use("/reasons", requireAuth, reasonsRouter);
router.use("/attendance", requireAuth, attendanceRouter);
router.use("/coins", requireAuth, coinsRouter);
router.use("/games", requireAuth, gamesRouter);

export default router;

