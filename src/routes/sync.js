import { Router } from "express";
import {
  asDoubleOrNull,
  asInt,
  gameStatsFieldsChanged,
} from "../lib/numbers.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

router.get("/onboarding", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data, error } = await supabaseAdmin
      .from("quit_profile")
      .select("is_configured, start_time_ms, daily_cigarettes")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    const configured =
      Boolean(data?.is_configured) &&
      data?.start_time_ms != null &&
      Number(data.start_time_ms) > 0 &&
      Number(data?.daily_cigarettes ?? 0) > 0;
    return res.status(200).json({
      ok: true,
      is_configured: configured,
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/pull", async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [quit_profile, reasons, notification_settings, game_stats] =
      await Promise.all([
        supabaseAdmin
          .from("quit_profile")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("reasons")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("notification_settings")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("game_stats")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

    const errors = [
      quit_profile.error,
      reasons.error,
      notification_settings.error,
      game_stats.error,
    ].filter(Boolean);
    if (errors.length) throw errors[0];

    return res.status(200).json({
      ok: true,
      quit_profile: quit_profile.data,
      reasons: reasons.data,
      notification_settings: notification_settings.data,
      game_stats: game_stats.data,
    });
  } catch (err) {
    return next(err);
  }
});

router.put("/push", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const b = req.body ?? {};

    // 신규 통합 quit_profile 필드
    if (b.quit_profile) {
      const u = b.quit_profile;
      const isConfigured = Boolean(u.is_configured);
      const startMs = isConfigured
        ? asInt(u.start_time_ms, Date.now())
        : asInt(u.start_time_ms, 0);
      const lungLast = asInt(u.lung_last_updated_ms, startMs);
      const { error } = await supabaseAdmin.from("quit_profile").upsert(
        {
          user_id: userId,
          is_configured: isConfigured,
          daily_cigarettes: asInt(u.daily_cigarettes, 0),
          cigarettes_per_pack: asInt(u.cigarettes_per_pack, 20),
          price_per_pack: asInt(u.price_per_pack, 4500),
          duration_days:
            u.duration_days == null ? null : asInt(u.duration_days, 0),
          start_time_ms: startMs,
          failure_count: asInt(u.failure_count, 0),
          goal_days:
            u.goal_days == null ? null : asInt(u.goal_days, 0),
          goal_congratulated_day:
            u.goal_congratulated_day == null
              ? null
              : asInt(u.goal_congratulated_day, 0),
          lung_health: asInt(u.lung_health, 100),
          lung_last_updated_ms: lungLast,
          pinned_reason_text: u.pinned_reason_text ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    }

    // 하위 호환: 앱이 아직 분리된 user_settings / quit_progress를 보낼 경우
    if (!b.quit_profile && (b.user_settings || b.quit_progress)) {
      const u = b.user_settings ?? {};
      const q = b.quit_progress ?? {};
      const isConfigured = Boolean(u.is_configured);
      const startMs = isConfigured
        ? asInt(q.start_time_ms, Date.now())
        : asInt(q.start_time_ms, 0);
      const lungLast = asInt(q.lung_last_updated_ms, startMs);
      const { error } = await supabaseAdmin.from("quit_profile").upsert(
        {
          user_id: userId,
          is_configured: isConfigured,
          daily_cigarettes: asInt(u.daily_cigarettes, 0),
          cigarettes_per_pack: asInt(u.cigarettes_per_pack, 20),
          price_per_pack: asInt(u.price_per_pack, 4500),
          duration_days:
            u.duration_days == null ? null : asInt(u.duration_days, 0),
          start_time_ms: startMs,
          failure_count: asInt(q.failure_count, 0),
          goal_days:
            q.goal_days == null ? null : asInt(q.goal_days, 0),
          goal_congratulated_day:
            q.goal_congratulated_day == null
              ? null
              : asInt(q.goal_congratulated_day, 0),
          lung_health: asInt(q.lung_health, 100),
          lung_last_updated_ms: lungLast,
          pinned_reason_text: q.pinned_reason_text ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    }

    if (b.reasons) {
      const r = b.reasons;
      const { error } = await supabaseAdmin.from("reasons").upsert(
        {
          user_id: userId,
          reasons_json: Array.isArray(r.reasons_json) ? r.reasons_json : [],
          selected_reason_id: r.selected_reason_id ?? null,
          selected_reason_text: r.selected_reason_text ?? null,
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    }

    if (b.notification_settings) {
      const n = b.notification_settings;
      const triBool = (v, defaultTrue = true) => {
        if (v === false || v === 0 || v === "false") return false;
        if (v === true || v === 1 || v === "true") return true;
        return defaultTrue;
      };
      const { data: existingNotif } = await supabaseAdmin
        .from("notification_settings")
        .select(
          "fcm_token, fcm_last_inactivity_sent_ms, fcm_last_reason_sent_ymd, " +
            "fcm_pattern_last_sent_ymd_by_slot, pattern_reminder_enabled, pattern_reminder_slots_json",
        )
        .eq("user_id", userId)
        .maybeSingle();

      // attendance_reminder_enabled(구) → calendar_reminder_enabled(신) 하위 호환 처리
      const calendarEnabled = triBool(
        n.calendar_reminder_enabled ?? n.attendance_reminder_enabled,
        true,
      );

      const { error } = await supabaseAdmin.from("notification_settings").upsert(
        {
          user_id: userId,
          reminder_times_json: Array.isArray(n.reminder_times_json)
            ? n.reminder_times_json
            : [],
          reason_notification_enabled: Boolean(n.reason_notification_enabled),
          inactivity_notification_enabled: triBool(
            n.inactivity_notification_enabled,
            true,
          ),
          calendar_reminder_enabled: calendarEnabled,
          pattern_reminder_enabled: triBool(n.pattern_reminder_enabled, true),
          pattern_reminder_slots_json: Array.isArray(
            n.pattern_reminder_slots_json,
          )
            ? n.pattern_reminder_slots_json
            : (existingNotif?.pattern_reminder_slots_json ?? []),
          last_app_open_time_ms:
            n.last_app_open_time_ms == null
              ? null
              : asInt(n.last_app_open_time_ms, 0),
          fcm_token: existingNotif?.fcm_token ?? null,
          fcm_last_inactivity_sent_ms:
            existingNotif?.fcm_last_inactivity_sent_ms ?? null,
          fcm_last_reason_sent_ymd:
            existingNotif?.fcm_last_reason_sent_ymd ?? null,
          fcm_pattern_last_sent_ymd_by_slot:
            existingNotif?.fcm_pattern_last_sent_ymd_by_slot ?? {},
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    }

    if (b.game_stats) {
      const g = b.game_stats;
      const prevRes = await supabaseAdmin
        .from("game_stats")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (prevRes.error) throw prevRes.error;
      const prev = prevRes.data;

      const numberSequenceLastClearSeconds =
        g.number_sequence_last_clear_seconds === undefined
          ? (prev?.number_sequence_last_clear_seconds ?? null)
          : asDoubleOrNull(g.number_sequence_last_clear_seconds);
      const timingTapLastSessionScore =
        g.timing_tap_last_session_score === undefined
          ? (prev?.timing_tap_last_session_score ?? null)
          : g.timing_tap_last_session_score === null
            ? null
            : asInt(g.timing_tap_last_session_score, 0);
      const cigaretteCatchLastSessionScore =
        g.cigarette_catch_last_session_score === undefined
          ? (prev?.cigarette_catch_last_session_score ?? null)
          : g.cigarette_catch_last_session_score === null
            ? null
            : asInt(g.cigarette_catch_last_session_score, 0);

      const incoming = {
        number_sequence_best_seconds: asDoubleOrNull(
          g.number_sequence_best_seconds,
        ),
        number_sequence_last_clear_seconds: numberSequenceLastClearSeconds,
        word_game_level: asInt(g.word_game_level, 1),
        timing_tap_best_score: asInt(g.timing_tap_best_score, 0),
        timing_tap_last_session_score: timingTapLastSessionScore,
        cigarette_catch_best_stage: asInt(g.cigarette_catch_best_stage, 0),
        cigarette_catch_best_score: asInt(g.cigarette_catch_best_score, 0),
        cigarette_catch_last_session_score: cigaretteCatchLastSessionScore,
      };

      const changed = gameStatsFieldsChanged(prev, incoming);
      const payload = { user_id: userId, ...incoming };
      if (changed) {
        payload.updated_at = new Date().toISOString();
      } else if (prev?.updated_at) {
        payload.updated_at = prev.updated_at;
      }

      const { error } = await supabaseAdmin
        .from("game_stats")
        .upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
