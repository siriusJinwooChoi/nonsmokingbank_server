import { Router } from "express";
import { ymdInSeoulNow } from "../lib/kstDate.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

const MILESTONE_DAYS = new Set([7, 14, 21, 28]);
const COINS_PER_DAY = 15;
const COINS_MILESTONE = 20;

function parseYmd(s) {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return { y, mo, d };
}

function daysBetweenYmd(a, b) {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  if (!pa || !pb) return null;
  const da = Date.UTC(pa.y, pa.mo - 1, pa.d);
  const db = Date.UTC(pb.y, pb.mo - 1, pb.d);
  return Math.floor((db - da) / (24 * 60 * 60 * 1000));
}

router.get("/state", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data, error } = await supabaseAdmin
      .from("coins_and_attendance")
      .select("golden_coins, attendance_streak_day, attendance_last_date")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    const coins = Number(data?.golden_coins ?? 0);
    const streakDay = Number(data?.attendance_streak_day ?? 1);
    const lastDate = data?.attendance_last_date ?? null;

    return res.status(200).json({
      ok: true,
      coins,
      streakDay,
      lastDate,
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/check-in", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const day = Number(req.body?.day);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "day must be an integer 1..28" });
    }

    const today = ymdInSeoulNow();
    const { data, error } = await supabaseAdmin
      .from("coins_and_attendance")
      .select("golden_coins, attendance_streak_day, attendance_last_date")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    let coins = Number(data?.golden_coins ?? 0);
    let streakDay = Number(data?.attendance_streak_day ?? 1);
    const lastDate = data?.attendance_last_date ?? null;

    if (lastDate) {
      const diff = daysBetweenYmd(lastDate, today);
      if (diff === 0) {
        return res.status(200).json({
          ok: true,
          alreadyAttended: true,
          awardedCoins: 0,
          coins,
          streakDay,
          lastDate,
        });
      }
      if (diff != null && diff > 1) {
        streakDay = 1;
      }
    }

    if (day != streakDay) {
      return res.status(409).json({
        error: "INVALID_ATTENDANCE_DAY",
        message: "day does not match expected streak day",
        expectedDay: streakDay,
      });
    }

    const awardedCoins = MILESTONE_DAYS.has(day) ? COINS_MILESTONE : COINS_PER_DAY;
    coins += awardedCoins;
    const nextStreakDay = day === 28 ? 1 : day + 1;

    const { error: upsertErr } = await supabaseAdmin.from("coins_and_attendance").upsert(
      {
        user_id: userId,
        golden_coins: coins,
        attendance_streak_day: nextStreakDay,
        attendance_last_date: today,
      },
      { onConflict: "user_id" },
    );
    if (upsertErr) throw upsertErr;

    return res.status(200).json({
      ok: true,
      alreadyAttended: false,
      attendedDay: day,
      awardedCoins,
      coins,
      streakDay: nextStreakDay,
      lastDate: today,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;

