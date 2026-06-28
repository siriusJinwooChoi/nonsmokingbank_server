import { Router } from "express";
import {
  asDoubleOrNull,
  asInt,
  gameStatsFieldsChanged,
  seqSecondsEqual,
} from "../lib/numbers.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

router.put("/stats", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const body = req.body ?? {};

    let numberSequenceBestSeconds = asDoubleOrNull(body.numberSequenceBestSeconds);
    if (numberSequenceBestSeconds != null && numberSequenceBestSeconds <= 0) {
      numberSequenceBestSeconds = null;
    }
    const wordGameLevel = asInt(body.wordGameLevel, 1);
    const timingTapBestScore = asInt(body.timingTapBestScore, 0);
    const cigaretteCatchBestStage = asInt(body.cigaretteCatchBestStage, 0);
    const cigaretteCatchBestScore = asInt(body.cigaretteCatchBestScore, 0);

    const prevRes = await supabaseAdmin
      .from("game_stats")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (prevRes.error) throw prevRes.error;
    const prev = prevRes.data;

    const numberSequenceLastClearSeconds =
      body.numberSequenceLastClearSeconds === undefined
        ? (prev?.number_sequence_last_clear_seconds ?? null)
        : asDoubleOrNull(body.numberSequenceLastClearSeconds);
    const timingTapLastSessionScore =
      body.timingTapLastSessionScore === undefined
        ? (prev?.timing_tap_last_session_score ?? null)
        : body.timingTapLastSessionScore === null
          ? null
          : asInt(body.timingTapLastSessionScore, 0);
    const cigaretteCatchLastSessionScore =
      body.cigaretteCatchLastSessionScore === undefined
        ? (prev?.cigarette_catch_last_session_score ?? null)
        : body.cigaretteCatchLastSessionScore === null
          ? null
          : asInt(body.cigaretteCatchLastSessionScore, 0);

    const incoming = {
      number_sequence_best_seconds: numberSequenceBestSeconds,
      number_sequence_last_clear_seconds: numberSequenceLastClearSeconds,
      word_game_level: wordGameLevel,
      timing_tap_best_score: timingTapBestScore,
      timing_tap_last_session_score: timingTapLastSessionScore,
      cigarette_catch_best_stage: cigaretteCatchBestStage,
      cigarette_catch_best_score: cigaretteCatchBestScore,
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

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

function numberSequenceRankingFilters(q) {
  return q
    .gt("number_sequence_best_seconds", 0)
    .or(
      "number_sequence_last_clear_seconds.is.null,number_sequence_last_clear_seconds.gt.0",
    );
}

router.get("/rankings", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(Math.max(asInt(req.query?.limit, 10), 1), 50);

    const [seqRes, wordRes, catchRes, timingRes] = await Promise.all([
      numberSequenceRankingFilters(
        supabaseAdmin
          .from("game_stats")
          .select(
            "user_id, number_sequence_best_seconds, number_sequence_last_clear_seconds",
          ),
      )
        .order("number_sequence_best_seconds", { ascending: true })
        .limit(limit),
      supabaseAdmin
        .from("game_stats")
        .select("user_id, word_game_level")
        .gt("word_game_level", 1)
        .order("word_game_level", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("game_stats")
        .select("user_id, cigarette_catch_best_score")
        .gt("cigarette_catch_best_score", 0)
        .order("cigarette_catch_best_score", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("game_stats")
        .select("user_id, timing_tap_best_score")
        .gt("timing_tap_best_score", 0)
        .order("timing_tap_best_score", { ascending: false })
        .limit(limit),
    ]);

    if (seqRes.error) throw seqRes.error;
    if (wordRes.error) throw wordRes.error;
    if (catchRes.error) throw catchRes.error;
    if (timingRes.error) throw timingRes.error;

    const ids = new Set();
    for (const row of [
      ...(seqRes.data ?? []),
      ...(wordRes.data ?? []),
      ...(catchRes.data ?? []),
      ...(timingRes.data ?? []),
    ]) {
      if (row.user_id) ids.add(row.user_id);
    }

    const profiles = ids.size
      ? await supabaseAdmin
          .from("profiles")
          .select("id, display_name")
          .in("id", [...ids])
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;

    const displayMap = {};
    for (const p of profiles.data ?? []) {
      displayMap[p.id] =
        typeof p.display_name === "string" && p.display_name.trim()
          ? p.display_name.trim()
          : null;
    }

    const myStatsRes = await supabaseAdmin
      .from("game_stats")
      .select(
        "number_sequence_best_seconds, number_sequence_last_clear_seconds, " +
          "word_game_level, cigarette_catch_best_score, timing_tap_best_score",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (myStatsRes.error) throw myStatsRes.error;
    const myStats = myStatsRes.data ?? {};

    const myLastClear = asDoubleOrNull(myStats.number_sequence_last_clear_seconds);
    const mySeq = asDoubleOrNull(myStats.number_sequence_best_seconds);
    const mySeqValid =
      mySeq != null && mySeq > 0 && (myLastClear == null || myLastClear > 0);

    let seqRank = null;
    if (mySeqValid) {
      const better = await numberSequenceRankingFilters(
        supabaseAdmin
          .from("game_stats")
          .select("user_id", { count: "exact", head: true })
          .lt("number_sequence_best_seconds", mySeq),
      );
      if (better.error) throw better.error;
      seqRank = (better.count ?? 0) + 1;
    }

    const myWord = asInt(myStats.word_game_level, 1);
    let wordGameRank = null;
    if (myWord > 1) {
      const betterWord = await supabaseAdmin
        .from("game_stats")
        .select("user_id", { count: "exact", head: true })
        .gt("word_game_level", myWord)
        .gt("word_game_level", 1);
      if (betterWord.error) throw betterWord.error;
      wordGameRank = (betterWord.count ?? 0) + 1;
    }

    const myCatch = asInt(myStats.cigarette_catch_best_score, 0);
    let cigaretteCatchRank = null;
    if (myCatch > 0) {
      const betterCatch = await supabaseAdmin
        .from("game_stats")
        .select("user_id", { count: "exact", head: true })
        .gt("cigarette_catch_best_score", myCatch)
        .gt("cigarette_catch_best_score", 0);
      if (betterCatch.error) throw betterCatch.error;
      cigaretteCatchRank = (betterCatch.count ?? 0) + 1;
    }

    const myTiming = asInt(myStats.timing_tap_best_score, 0);
    let timingTapRank = null;
    if (myTiming > 0) {
      const betterTiming = await supabaseAdmin
        .from("game_stats")
        .select("user_id", { count: "exact", head: true })
        .gt("timing_tap_best_score", myTiming)
        .gt("timing_tap_best_score", 0);
      if (betterTiming.error) throw betterTiming.error;
      timingTapRank = (betterTiming.count ?? 0) + 1;
    }

    const withName = (list) =>
      (list ?? []).map((r) => ({
        ...r,
        display_name: displayMap[r.user_id] ?? null,
      }));

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
        numberSequenceLastClearSeconds: myLastClear,
        wordGameLevel: myWord,
        cigaretteCatchBestScore: myCatch,
        timingTapBestScore: myTiming,
        numberSequenceRank: seqRank,
        wordGameRank,
        cigaretteCatchRank,
        timingTapRank,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
