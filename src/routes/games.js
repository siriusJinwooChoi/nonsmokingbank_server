import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

function asInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asDoubleOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

    const { error } = await supabaseAdmin.from("game_stats").upsert(
      {
        user_id: userId,
        number_sequence_best_seconds: numberSequenceBestSeconds,
        word_game_level: wordGameLevel,
        timing_tap_best_score: timingTapBestScore,
        cigarette_catch_best_stage: cigaretteCatchBestStage,
        cigarette_catch_best_score: cigaretteCatchBestScore,
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;

    return res.status(200).json({ ok: true });
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

