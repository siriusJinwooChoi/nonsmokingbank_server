import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

const asInt = (v, fallback = 0) => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

router.post("/logs", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const b = req.body ?? {};
    const action = String(b.action ?? "").trim().toLowerCase();
    if (action !== "smoked" && action !== "craving") {
      return res.status(400).json({ error: "BAD_REQUEST", message: "action must be smoked|craving" });
    }

    const eventAtMs = asInt(b.eventAtMs, Date.now());
    const eventAt = new Date(eventAtMs);
    const hour = Math.max(0, Math.min(23, asInt(b.hour, eventAt.getHours())));
    const minute = Math.max(0, Math.min(59, asInt(b.minute, eventAt.getMinutes())));
    const timeLabel = String(b.timeLabel ?? "").trim();
    const situation = String(b.situation ?? "").trim();
    const emotion = String(b.emotion ?? "").trim();

    const { error } = await supabaseAdmin.from("smoking_pattern_logs").insert({
      user_id: userId,
      action,
      event_at: eventAt.toISOString(),
      event_hour: hour,
      event_minute: minute,
      time_label: timeLabel,
      situation,
      emotion,
    });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.get("/logs", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const limit = Math.max(1, Math.min(200, asInt(req.query.limit, 50)));
    const { data, error } = await supabaseAdmin
      .from("smoking_pattern_logs")
      .select("id, action, event_at, event_hour, event_minute, time_label, situation, emotion, created_at")
      .eq("user_id", userId)
      .order("event_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return res.status(200).json({ ok: true, logs: data ?? [] });
  } catch (err) {
    return next(err);
  }
});

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

router.put("/settings", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const value = req.body?.patternReminderEnabled;
    const enabled = value === false || value === 0 || value === "false" ? false : true;
    const { error } = await supabaseAdmin.from("notification_settings").upsert(
      {
        user_id: userId,
        pattern_reminder_enabled: enabled,
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return res.status(200).json({ ok: true, patternReminderEnabled: enabled });
  } catch (err) {
    return next(err);
  }
});

export default router;
