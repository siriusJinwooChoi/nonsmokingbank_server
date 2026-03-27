import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

function asInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

router.get("/balance", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data, error } = await supabaseAdmin
      .from("coins_and_attendance")
      .select("golden_coins")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    const coins = asInt(data?.golden_coins, 0);
    return res.status(200).json({ ok: true, coins });
  } catch (err) {
    return next(err);
  }
});

router.post("/consume", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const amount = asInt(req.body?.amount, 0);
    if (amount <= 0) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "amount must be > 0" });
    }

    const { data, error } = await supabaseAdmin
      .from("coins_and_attendance")
      .select("golden_coins, attendance_streak_day, attendance_last_date")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    const currentCoins = asInt(data?.golden_coins, 0);
    if (currentCoins < amount) {
      return res.status(409).json({
        error: "INSUFFICIENT_COINS",
        message: "not enough coins",
        coins: currentCoins,
      });
    }

    const nextCoins = currentCoins - amount;
    const { error: upsertErr } = await supabaseAdmin.from("coins_and_attendance").upsert(
      {
        user_id: userId,
        golden_coins: nextCoins,
        attendance_streak_day: asInt(data?.attendance_streak_day, 1),
        attendance_last_date: data?.attendance_last_date ?? null,
      },
      { onConflict: "user_id" },
    );
    if (upsertErr) throw upsertErr;

    return res.status(200).json({
      ok: true,
      consumed: amount,
      coins: nextCoins,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;

