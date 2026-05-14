import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

// 동의 시각 컬럼은 클라이언트에서 ISO8601 문자열로 넘기거나 true 를 보내면 서버 현재 시각으로 기록한다.
// 버전 컬럼은 비어 있으면 무시.
const CONSENT_TIMESTAMP_COLUMNS = [
  "terms_of_service_accepted_at",
  "privacy_policy_accepted_at",
  "sensitive_info_consent_at",
  "age_confirmed_at",
];

const CONSENT_VERSION_COLUMNS = [
  "terms_of_service_version",
  "privacy_policy_version",
  "sensitive_info_consent_version",
];

function maybeAssignTimestamp(patch, body, key) {
  const v = body[key];
  if (v === true) {
    patch[key] = new Date().toISOString();
  } else if (typeof v === "string" && v.trim().length > 0) {
    patch[key] = v;
  } else if (v === null) {
    patch[key] = null;
  }
}

function maybeAssignVersion(patch, body, key) {
  const v = body[key];
  if (typeof v === "string" && v.trim().length > 0) {
    patch[key] = v.trim();
  } else if (v === null) {
    patch[key] = null;
  }
}

router.get("/", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const columns = [
      "id",
      "display_name",
      "terms_accepted_at",
      ...CONSENT_TIMESTAMP_COLUMNS,
      ...CONSENT_VERSION_COLUMNS,
    ].join(", ");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select(columns)
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    const out = {
      ok: true,
      display_name: data?.display_name ?? null,
      terms_accepted_at: data?.terms_accepted_at ?? null,
    };
    for (const k of CONSENT_TIMESTAMP_COLUMNS) {
      out[k] = data?.[k] ?? null;
    }
    for (const k of CONSENT_VERSION_COLUMNS) {
      out[k] = data?.[k] ?? null;
    }
    return res.status(200).json(out);
  } catch (err) {
    return next(err);
  }
});

router.patch("/", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const body = req.body ?? {};
    const patch = {};
    if (typeof body.display_name === "string") {
      patch.display_name = body.display_name.trim();
    }
    // 호환: 기존 terms_accepted_at 단일 컬럼도 계속 수용한다.
    if (body.terms_accepted_at === true) {
      patch.terms_accepted_at = new Date().toISOString();
    } else if (typeof body.terms_accepted_at === "string") {
      patch.terms_accepted_at = body.terms_accepted_at;
    }
    for (const key of CONSENT_TIMESTAMP_COLUMNS) {
      maybeAssignTimestamp(patch, body, key);
    }
    for (const key of CONSENT_VERSION_COLUMNS) {
      maybeAssignVersion(patch, body, key);
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "no valid fields" });
    }
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", userId);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.delete("/account", async (req, res, next) => {
  try {
    const userId = req.user.id;
    // 사용자별 동기화/프로필 데이터를 먼저 정리한 뒤 Auth 유저를 삭제합니다.
    const cleanupTasks = [
      supabaseAdmin.from("user_settings").delete().eq("user_id", userId),
      supabaseAdmin.from("quit_progress").delete().eq("user_id", userId),
      supabaseAdmin.from("reasons").delete().eq("user_id", userId),
      supabaseAdmin.from("notification_settings").delete().eq("user_id", userId),
      supabaseAdmin.from("attendance_check_ins").delete().eq("user_id", userId),
      supabaseAdmin.from("coins_and_attendance").delete().eq("user_id", userId),
      supabaseAdmin.from("tree_progress").delete().eq("user_id", userId),
      supabaseAdmin.from("dream_car_progress").delete().eq("user_id", userId),
      supabaseAdmin.from("cigarette_collection").delete().eq("user_id", userId),
      supabaseAdmin.from("game_stats").delete().eq("user_id", userId),
      supabaseAdmin.from("smoking_pattern_logs").delete().eq("user_id", userId),
      supabaseAdmin.from("profiles").delete().eq("id", userId),
    ];
    const cleanupResults = await Promise.all(cleanupTasks);
    const cleanupError = cleanupResults.find((r) => r.error)?.error;
    if (cleanupError) throw cleanupError;

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
