import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

/** FCM 기기 토큰 등록 (금연 리마인더 서버 푸시용) */
router.put("/fcm-token", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const token = req.body?.token;
    if (!token || typeof token !== "string" || token.length < 10) {
      return res.status(400).json({ ok: false, error: "INVALID_TOKEN" });
    }

    const { error } = await supabaseAdmin
      .from("notification_settings")
      .update({ fcm_token: token })
      .eq("user_id", userId);

    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/** 로그아웃 시 토큰 제거(선택) */
router.delete("/fcm-token", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { error } = await supabaseAdmin
      .from("notification_settings")
      .update({ fcm_token: null })
      .eq("user_id", userId);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
