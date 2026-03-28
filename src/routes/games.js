import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

/** 종목별 일일 1회 보상 코인 */
const DAILY_GAME_REWARD_COINS = 5;

/** stats_updated_at 이 이 시간 이내일 때만 보상 허용 (분) */
const STATS_FRESH_MINUTES = 25;

function asInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asDoubleOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ymdInSeoulNow() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function seqSecondsEqual(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.02;
}

function statsRowChanged(prev, incoming) {
  if (!prev) return true;
  const pSeq = prev.number_sequence_best_seconds;
  const iSeq = incoming.number_sequence_best_seconds;
  if (pSeq == null && iSeq == null) {
    // both null
  } else if (pSeq == null || iSeq == null) {
    return true;
  } else if (!seqSecondsEqual(pSeq, iSeq)) {
    return true;
  }
  if (asInt(prev.word_game_level, 1) !== asInt(incoming.word_game_level, 1)) return true;
  if (asInt(prev.timing_tap_best_score, 0) !== asInt(incoming.timing_tap_best_score, 0)) return true;
  if (asInt(prev.cigarette_catch_best_stage, 0) !== asInt(incoming.cigarette_catch_best_stage, 0)) return true;
  if (asInt(prev.cigarette_catch_best_score, 0) !== asInt(incoming.cigarette_catch_best_score, 0)) return true;
  return false;
}

function isStatsFresh(statsUpdatedAt) {
  if (!statsUpdatedAt) return false;
  const t = new Date(statsUpdatedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const ageMs = Date.now() - t;
  return ageMs >= 0 && ageMs <= STATS_FRESH_MINUTES * 60 * 1000;
}

router.put("/stats", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const body = req.body ?? {};

    const numberSequenceBestSeconds = asDoubleOrNull(body.numberSequenceBestSeconds);
    const wordGameLevel = asInt(body.wordGameLevel, 1);
    const timingTapBestScore = asInt(body.timingTapBestScore, 0);
    const cigaretteCatchBestStage = asInt(body.cigaretteCatchBestStage, 0);
    const cigaretteCatchBestScore = asInt(body.cigaretteCatchBestScore, 0);

    const incoming = {
      number_sequence_best_seconds: numberSequenceBestSeconds,
      word_game_level: wordGameLevel,
      timing_tap_best_score: timingTapBestScore,
      cigarette_catch_best_stage: cigaretteCatchBestStage,
      cigarette_catch_best_score: cigaretteCatchBestScore,
    };

    const prevRes = await supabaseAdmin.from("game_stats").select("*").eq("user_id", userId).maybeSingle();
    if (prevRes.error) throw prevRes.error;
    const prev = prevRes.data;

    const changed = statsRowChanged(prev, incoming);
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

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /v1/games/reward/claim
 * body: { game: "number_sequence" | "word_game" | "timing_tap" | "cigarette_catch", proof?: {...} }
 * 서버의 game_stats와 proof 일치 + 최근 동기화 + 당일 미수령 시 코인 지급
 */
router.post("/reward/claim", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const game = req.body?.game;
    const proof = req.body?.proof ?? {};

    const allowed = new Set(["number_sequence", "word_game", "timing_tap", "cigarette_catch"]);
    if (typeof game !== "string" || !allowed.has(game)) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "invalid game" });
    }

    const kstDate = ymdInSeoulNow();
    const claimKey = `daily_reward:${kstDate}:${game}`;

    const existing = await supabaseAdmin
      .from("game_reward_claims")
      .select("claim_key")
      .eq("user_id", userId)
      .eq("claim_key", claimKey)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      const bal = await supabaseAdmin
        .from("coins_and_attendance")
        .select("golden_coins")
        .eq("user_id", userId)
        .maybeSingle();
      if (bal.error) throw bal.error;
      const coins = asInt(bal.data?.golden_coins, 0);
      return res.status(200).json({
        ok: true,
        alreadyClaimed: true,
        granted: 0,
        coins,
      });
    }

    const statsRes = await supabaseAdmin.from("game_stats").select("*").eq("user_id", userId).maybeSingle();
    if (statsRes.error) throw statsRes.error;
    const stats = statsRes.data;
    if (!stats) {
      return res.status(400).json({ error: "NO_STATS", message: "sync game stats first" });
    }

    if (!isStatsFresh(stats.stats_updated_at)) {
      return res.status(400).json({
        error: "STALE_STATS",
        message: "game stats must be synced recently; call PUT /v1/games/stats then retry",
      });
    }

    if (game === "number_sequence") {
      const elapsed = asDoubleOrNull(proof.elapsedSeconds);
      if (elapsed == null) {
        return res.status(400).json({ error: "BAD_PROOF", message: "elapsedSeconds required" });
      }
      if (!seqSecondsEqual(elapsed, stats.number_sequence_best_seconds)) {
        return res.status(400).json({ error: "BAD_PROOF", message: "elapsed does not match server best" });
      }
    } else if (game === "word_game") {
      const level = asInt(proof.level, 0);
      if (level < 2) {
        return res.status(400).json({ error: "BAD_PROOF", message: "level must be >= 2" });
      }
      if (level !== asInt(stats.word_game_level, 1)) {
        return res.status(400).json({ error: "BAD_PROOF", message: "level does not match server" });
      }
    } else if (game === "timing_tap") {
      const bestScore = asInt(proof.bestScore, -1);
      if (bestScore < 1) {
        return res.status(400).json({ error: "BAD_PROOF", message: "bestScore invalid" });
      }
      if (bestScore !== asInt(stats.timing_tap_best_score, 0)) {
        return res.status(400).json({ error: "BAD_PROOF", message: "score does not match server" });
      }
    } else if (game === "cigarette_catch") {
      const bestScore = asInt(proof.bestScore, -1);
      if (bestScore < 1) {
        return res.status(400).json({ error: "BAD_PROOF", message: "bestScore invalid" });
      }
      if (bestScore !== asInt(stats.cigarette_catch_best_score, 0)) {
        return res.status(400).json({ error: "BAD_PROOF", message: "score does not match server" });
      }
    }

    const coinRow = await supabaseAdmin
      .from("coins_and_attendance")
      .select("golden_coins, attendance_streak_day, attendance_last_date")
      .eq("user_id", userId)
      .maybeSingle();
    if (coinRow.error) throw coinRow.error;

    const currentCoins = asInt(coinRow.data?.golden_coins, 0);
    const nextCoins = currentCoins + DAILY_GAME_REWARD_COINS;

    const ins = await supabaseAdmin.from("game_reward_claims").insert({
      user_id: userId,
      claim_key: claimKey,
      coins_granted: DAILY_GAME_REWARD_COINS,
    });
    if (ins.error) {
      if (ins.error.code === "23505") {
        const bal = await supabaseAdmin
          .from("coins_and_attendance")
          .select("golden_coins")
          .eq("user_id", userId)
          .maybeSingle();
        if (bal.error) throw bal.error;
        return res.status(200).json({
          ok: true,
          alreadyClaimed: true,
          granted: 0,
          coins: asInt(bal.data?.golden_coins, 0),
        });
      }
      throw ins.error;
    }

    const upd = await supabaseAdmin.from("coins_and_attendance").upsert(
      {
        user_id: userId,
        golden_coins: nextCoins,
        attendance_streak_day: asInt(coinRow.data?.attendance_streak_day, 1),
        attendance_last_date: coinRow.data?.attendance_last_date ?? null,
      },
      { onConflict: "user_id" },
    );
    if (upd.error) {
      await supabaseAdmin.from("game_reward_claims").delete().eq("user_id", userId).eq("claim_key", claimKey);
      throw upd.error;
    }

    return res.status(200).json({
      ok: true,
      alreadyClaimed: false,
      granted: DAILY_GAME_REWARD_COINS,
      coins: nextCoins,
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/rankings", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(Math.max(asInt(req.query?.limit, 10), 1), 50);

    const seqRes = await supabaseAdmin
      .from("game_stats")
      .select("user_id, number_sequence_best_seconds")
      .not("number_sequence_best_seconds", "is", null)
      .order("number_sequence_best_seconds", { ascending: true })
      .limit(limit);

    const wordRes = await supabaseAdmin
      .from("game_stats")
      .select("user_id, word_game_level")
      .order("word_game_level", { ascending: false })
      .limit(limit);

    const catchRes = await supabaseAdmin
      .from("game_stats")
      .select("user_id, cigarette_catch_best_score")
      .order("cigarette_catch_best_score", { ascending: false })
      .limit(limit);

    const timingRes = await supabaseAdmin
      .from("game_stats")
      .select("user_id, timing_tap_best_score")
      .order("timing_tap_best_score", { ascending: false })
      .limit(limit);

    const ids = new Set();
    for (const row of [...(seqRes.data ?? []), ...(wordRes.data ?? []), ...(catchRes.data ?? []), ...(timingRes.data ?? [])]) {
      if (row.user_id) ids.add(row.user_id);
    }

    const profiles = ids.size
      ? await supabaseAdmin.from("profiles").select("id, display_name").in("id", [...ids])
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;

    const displayMap = {};
    for (const p of profiles.data ?? []) {
      displayMap[p.id] = (typeof p.display_name === "string" && p.display_name.trim()) ? p.display_name.trim() : null;
    }

    const myStatsRes = await supabaseAdmin
      .from("game_stats")
      .select("number_sequence_best_seconds, word_game_level, cigarette_catch_best_score, timing_tap_best_score")
      .eq("user_id", userId)
      .maybeSingle();
    if (myStatsRes.error) throw myStatsRes.error;
    const myStats = myStatsRes.data ?? {};

    let seqRank = null;
    const mySeq = asDoubleOrNull(myStats.number_sequence_best_seconds);
    if (mySeq != null) {
      const better = await supabaseAdmin
        .from("game_stats")
        .select("user_id")
        .lt("number_sequence_best_seconds", mySeq)
        .not("number_sequence_best_seconds", "is", null);
      if (better.error) throw better.error;
      seqRank = (better.data?.length ?? 0) + 1;
    }

    const myWord = asInt(myStats.word_game_level, 1);
    const betterWord = await supabaseAdmin.from("game_stats").select("user_id").gt("word_game_level", myWord);
    if (betterWord.error) throw betterWord.error;

    const myCatch = asInt(myStats.cigarette_catch_best_score, 0);
    const betterCatch = await supabaseAdmin.from("game_stats").select("user_id").gt("cigarette_catch_best_score", myCatch);
    if (betterCatch.error) throw betterCatch.error;

    const myTiming = asInt(myStats.timing_tap_best_score, 0);
    const betterTiming = await supabaseAdmin.from("game_stats").select("user_id").gt("timing_tap_best_score", myTiming);
    if (betterTiming.error) throw betterTiming.error;

    const withName = (list) => (list ?? []).map((r) => ({ ...r, display_name: displayMap[r.user_id] ?? null }));

    return res.status(200).json({
      ok: true,
      top: {
        numberSequence: withName(seqRes.data),
        wordGame: withName(wordRes.data),
        cigaretteCatch: withName(catchRes.data),
        timingTap: withName(timingRes.data),
      },
      my: {
        numberSequenceBestSeconds: mySeq,
        wordGameLevel: myWord,
        cigaretteCatchBestScore: myCatch,
        timingTapBestScore: myTiming,
        numberSequenceRank: seqRank,
        wordGameRank: (betterWord.data?.length ?? 0) + 1,
        cigaretteCatchRank: (betterCatch.data?.length ?? 0) + 1,
        timingTapRank: (betterTiming.data?.length ?? 0) + 1,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;

