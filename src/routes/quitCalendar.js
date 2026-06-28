import { Router } from "express";
import { ymdInSeoulNow } from "../lib/kstDate.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

/**
 * GET /v1/quit-calendar
 * 쿼리: year=2026&month=6  (없으면 전체 조회)
 */
router.get("/", async (req, res, next) => {
  try {
    const userId = req.user.id;

    let query = supabaseAdmin
      .from("quit_calendar")
      .select("record_date, status, note")
      .eq("user_id", userId)
      .order("record_date", { ascending: true });

    if (req.query.year && req.query.month) {
      const y = String(req.query.year).padStart(4, "0");
      const m = String(req.query.month).padStart(2, "0");
      const nextMonth = Number(m) === 12 ? `${Number(y) + 1}-01` : `${y}-${String(Number(m) + 1).padStart(2, "0")}`;
      query = query
        .gte("record_date", `${y}-${m}-01`)
        .lt("record_date", `${nextMonth}-01`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.status(200).json({ ok: true, records: data ?? [] });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /v1/quit-calendar
 * body: { date?: "YYYY-MM-DD", status: "success" | "smoked", note?: string }
 * date 미입력 시 오늘(서울) 날짜
 */
router.post("/", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const date = req.body?.date ?? ymdInSeoulNow();
    const status = req.body?.status;

    if (status !== "success" && status !== "smoked") {
      return res.status(400).json({
        error: "BAD_REQUEST",
        message: "status must be success | smoked",
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: "BAD_REQUEST",
        message: "date must be YYYY-MM-DD",
      });
    }

    const note =
      typeof req.body?.note === "string"
        ? req.body.note.trim().slice(0, 200)
        : null;

    const { error } = await supabaseAdmin.from("quit_calendar").upsert(
      { user_id: userId, record_date: date, status, note: note || null },
      { onConflict: "user_id,record_date" },
    );
    if (error) throw error;

    return res
      .status(200)
      .json({ ok: true, record_date: date, status });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/quit-calendar/:date
 * 특정 날짜 기록 조회
 */
router.get("/:date", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res
        .status(400)
        .json({ error: "BAD_REQUEST", message: "date must be YYYY-MM-DD" });
    }

    const { data, error } = await supabaseAdmin
      .from("quit_calendar")
      .select("record_date, status, note")
      .eq("user_id", userId)
      .eq("record_date", date)
      .maybeSingle();
    if (error) throw error;

    return res.status(200).json({ ok: true, record: data ?? null });
  } catch (err) {
    return next(err);
  }
});

export default router;
