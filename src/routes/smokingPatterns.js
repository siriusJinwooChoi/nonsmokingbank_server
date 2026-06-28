import { Router } from "express";
import { asInt } from "../lib/numbers.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

/**
 * POST /v1/smoking-patterns/logs
 * body: { action: "smoked" | "craving" | "sos_pressed", eventAtMs?, note? }
 *
 * smoking_events 테이블에 기록 (구 smoking_pattern_logs 대체)
 */
router.post("/logs", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const b = req.body ?? {};

    const action = String(b.action ?? "")
      .trim()
      .toLowerCase();
    const allowed = new Set(["smoked", "craving", "sos_pressed"]);
    if (!allowed.has(action)) {
      return res.status(400).json({
        error: "BAD_REQUEST",
        message: "action must be smoked | craving | sos_pressed",
      });
    }

    const eventAtMs = asInt(b.eventAtMs, Date.now());
    const eventAt = new Date(eventAtMs);
    const note =
      typeof b.note === "string" ? b.note.trim().slice(0, 200) : null;

    const { error } = await supabaseAdmin.from("smoking_events").insert({
      user_id: userId,
      event_type: action,
      event_at: eventAt.toISOString(),
      note: note || null,
    });
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/smoking-patterns/logs?limit=50
 */
router.get("/logs", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const limit = Math.max(1, Math.min(200, asInt(req.query.limit, 50)));

    const { data, error } = await supabaseAdmin
      .from("smoking_events")
      .select("id, event_type, event_at, note, created_at")
      .eq("user_id", userId)
      .order("event_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    return res.status(200).json({ ok: true, logs: data ?? [] });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/smoking-patterns/settings
 */
router.get("/settings", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data, error } = await supabaseAdmin
      .from("notification_settings")
      .select("pattern_reminder_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return res.status(200).json({
      ok: true,
      patternReminderEnabled: data?.pattern_reminder_enabled ?? true,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * PUT /v1/smoking-patterns/settings
 * body: { patternReminderEnabled: boolean }
 */
router.put("/settings", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const value = req.body?.patternReminderEnabled;
    const enabled =
      value === false || value === 0 || value === "false" ? false : true;

    const { error } = await supabaseAdmin
      .from("notification_settings")
      .upsert(
        { user_id: userId, pattern_reminder_enabled: enabled },
        { onConflict: "user_id" },
      );
    if (error) throw error;

    return res
      .status(200)
      .json({ ok: true, patternReminderEnabled: enabled });
  } catch (err) {
    return next(err);
  }
});

export default router;
