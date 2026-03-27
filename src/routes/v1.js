import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import reasonsRouter from "./reasons.js";
import attendanceRouter from "./attendance.js";

const router = Router();

router.get("/health", (req, res) => {
  res.status(200).json({ ok: true, version: "v1" });
});

router.use("/reasons", requireAuth, reasonsRouter);
router.use("/attendance", requireAuth, attendanceRouter);

export default router;

