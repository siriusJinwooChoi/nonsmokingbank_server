import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { deleteAllQuitRoomImagesForUser } from "../lib/quitRoomImageStorage.js";

const router = Router();

const CONSENT_TIMESTAMP_COLUMNS = [
  "terms_of_service_accepted_at",
  "privacy_policy_accepted_at",
  "age_confirmed_at",
];

const CONSENT_VERSION_COLUMNS = [
  "terms_of_service_version",
  "privacy_policy_version",
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
      return res
        .status(400)
        .json({ error: "BAD_REQUEST", message: "no valid fields" });
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", userId);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.delete("/account", async (req, res, next) => {
  try {
    const userId = req.user.id;

    await deleteAllQuitRoomImagesForUser(userId);

    // 신규 스키마 기준으로 사용자 데이터 정리
    const cleanupTasks = [
      supabaseAdmin.from("quit_profile").delete().eq("user_id", userId),
      supabaseAdmin.from("reasons").delete().eq("user_id", userId),
      supabaseAdmin.from("notification_settings").delete().eq("user_id", userId),
      supabaseAdmin.from("game_stats").delete().eq("user_id", userId),
      supabaseAdmin.from("smoking_events").delete().eq("user_id", userId),
      supabaseAdmin.from("quit_calendar").delete().eq("user_id", userId),
      supabaseAdmin.from("quit_room_members").delete().eq("user_id", userId),
      supabaseAdmin.from("damta_messages").delete().eq("user_id", userId),
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
