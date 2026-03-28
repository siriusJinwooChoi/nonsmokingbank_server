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
      .from("user_settings")
      .select("is_configured")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return res.status(200).json({
      ok: true,
      is_configured: Boolean(data?.is_configured),
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/pull", async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [
      user_settings,
      quit_progress,
      reasons,
      notification_settings,
      coins_and_attendance,
      tree_progress,
      cigarette_collection,
      game_stats,
    ] = await Promise.all([
      supabaseAdmin.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("quit_progress").select("*").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("reasons").select("*").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("notification_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("coins_and_attendance").select("*").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("tree_progress").select("*").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("cigarette_collection").select("*").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("game_stats").select("*").eq("user_id", userId).maybeSingle(),
    ]);

    const errors = [
      user_settings.error,
      quit_progress.error,
      reasons.error,
      notification_settings.error,
      coins_and_attendance.error,
      tree_progress.error,
      cigarette_collection.error,
      game_stats.error,
    ].filter(Boolean);
    if (errors.length) throw errors[0];

    return res.status(200).json({
      ok: true,
      user_settings: user_settings.data,
      quit_progress: quit_progress.data,
      reasons: reasons.data,
      notification_settings: notification_settings.data,
      coins_and_attendance: coins_and_attendance.data,
      tree_progress: tree_progress.data,
      cigarette_collection: cigarette_collection.data,
      game_stats: game_stats.data,
    });
  } catch (err) {
    return next(err);
  }
});

/** 클라이언트 로컬 상태를 서버 테이블에 반영 (기존 SupabaseSyncService._pushAll 대응) */
router.put("/push", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const b = req.body ?? {};

    if (b.user_settings) {
      const u = b.user_settings;
      await supabaseAdmin.from("user_settings").upsert(
        {
          user_id: userId,
          is_configured: Boolean(u.is_configured),
          daily_cigarettes: asInt(u.daily_cigarettes, 0),
          cigarettes_per_pack: asInt(u.cigarettes_per_pack, 20),
          price_per_pack: asInt(u.price_per_pack, 4500),
          duration_days: u.duration_days == null ? null : asInt(u.duration_days, 0),
        },
        { onConflict: "user_id" },
      );
    }

    if (b.quit_progress) {
      const q = b.quit_progress;
      const startMs = asInt(q.start_time_ms, Date.now());
      const lungLast = asInt(q.lung_last_updated_ms, startMs);
      await supabaseAdmin.from("quit_progress").upsert(
        {
          user_id: userId,
          start_time_ms: startMs,
          failure_count: asInt(q.failure_count, 0),
          goal_days: q.goal_days == null ? null : asInt(q.goal_days, 0),
          goal_congratulated_day: q.goal_congratulated_day == null ? null : asInt(q.goal_congratulated_day, 0),
          lung_health: asInt(q.lung_health, 100),
          lung_last_updated_ms: lungLast,
          pinned_reason_text: q.pinned_reason_text ?? null,
        },
        { onConflict: "user_id" },
      );
    }

    if (b.reasons) {
      const r = b.reasons;
      await supabaseAdmin.from("reasons").upsert(
        {
          user_id: userId,
          reasons_json: Array.isArray(r.reasons_json) ? r.reasons_json : [],
          selected_reason_id: r.selected_reason_id ?? null,
          selected_reason_text: r.selected_reason_text ?? null,
        },
        { onConflict: "user_id" },
      );
    }

    if (b.notification_settings) {
      const n = b.notification_settings;
      await supabaseAdmin.from("notification_settings").upsert(
        {
          user_id: userId,
          reminder_times_json: Array.isArray(n.reminder_times_json) ? n.reminder_times_json : [],
          reason_notification_enabled: Boolean(n.reason_notification_enabled),
          inactivity_notification_enabled: n.inactivity_notification_enabled !== false,
          attendance_reminder_enabled: n.attendance_reminder_enabled !== false,
          last_app_open_time_ms: n.last_app_open_time_ms == null ? null : asInt(n.last_app_open_time_ms, 0),
        },
        { onConflict: "user_id" },
      );
    }

    if (b.coins_and_attendance) {
      const c = b.coins_and_attendance;
      let dateForDb = c.attendance_last_date ?? null;
      if (typeof dateForDb === "string" && dateForDb.length > 10) {
        dateForDb = dateForDb.substring(0, 10);
      }
      await supabaseAdmin.from("coins_and_attendance").upsert(
        {
          user_id: userId,
          golden_coins: asInt(c.golden_coins, 0),
          attendance_streak_day: asInt(c.attendance_streak_day, 1),
          attendance_last_date: dateForDb,
        },
        { onConflict: "user_id" },
      );
    }

    if (b.tree_progress) {
      const t = b.tree_progress;
      const lastMs = asInt(t.last_water_update_ms, Date.now());
      await supabaseAdmin.from("tree_progress").upsert(
        {
          user_id: userId,
          growth_stage: asInt(t.growth_stage, 1),
          water: asInt(t.water, 0),
          current_water: asInt(t.current_water, 0),
          last_water_update_ms: lastMs,
          saved_trees_count: asInt(t.saved_trees_count, 0),
        },
        { onConflict: "user_id" },
      );
    }

    if (b.cigarette_collection) {
      const cc = b.cigarette_collection;
      const paths = Array.isArray(cc.collected_asset_paths)
        ? cc.collected_asset_paths.map((x) => String(x))
        : [];
      await supabaseAdmin.from("cigarette_collection").upsert(
        {
          user_id: userId,
          last_collection_window: cc.last_collection_window ?? null,
          session_window: cc.session_window ?? null,
          session_asset: cc.session_asset ?? null,
          session_attempts: asInt(cc.session_attempts, 0),
          collected_asset_paths: paths,
        },
        { onConflict: "user_id" },
      );
    }

    if (b.game_stats) {
      const g = b.game_stats;
      const incoming = {
        number_sequence_best_seconds: asDoubleOrNull(g.number_sequence_best_seconds),
        word_game_level: asInt(g.word_game_level, 1),
        timing_tap_best_score: asInt(g.timing_tap_best_score, 0),
        cigarette_catch_best_stage: asInt(g.cigarette_catch_best_stage, 0),
        cigarette_catch_best_score: asInt(g.cigarette_catch_best_score, 0),
      };
      const prevRes = await supabaseAdmin.from("game_stats").select("*").eq("user_id", userId).maybeSingle();
      if (prevRes.error) throw prevRes.error;
      const prev = prevRes.data;
      const changed = gameStatsFieldsChanged(prev, incoming);
      const payload = {
        user_id: userId,
        ...incoming,
      };
      if (changed) {
        payload.stats_updated_at = new Date().toISOString();
      } else if (prev?.stats_updated_at) {
        payload.stats_updated_at = prev.stats_updated_at;
      }
      const { error } = await supabaseAdmin.from("game_stats").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
