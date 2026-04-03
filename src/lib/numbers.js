export function asInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function asDoubleOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function seqSecondsEqual(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.02;
}

/**
 * game_stats 행과 동기화하려는 필드 묶음이 달라졌는지 (stats_updated_at 갱신 여부)
 * @param {object|null|undefined} prev DB에서 읽은 기존 행
 * @param {object} incoming 필드: number_sequence_best_seconds, word_game_level, …
 */
export function gameStatsFieldsChanged(prev, incoming) {
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

  const pLastClear = prev.number_sequence_last_clear_seconds;
  const iLastClear = incoming.number_sequence_last_clear_seconds;
  if (pLastClear == null && iLastClear == null) {
    // both null
  } else if (pLastClear == null || iLastClear == null) {
    return true;
  } else if (!seqSecondsEqual(pLastClear, iLastClear)) {
    return true;
  }

  const pTapSess = prev.timing_tap_last_session_score;
  const iTapSess = incoming.timing_tap_last_session_score;
  if (pTapSess == null && iTapSess == null) {
    // both null
  } else if (pTapSess == null || iTapSess == null) {
    return true;
  } else if (asInt(pTapSess, 0) !== asInt(iTapSess, 0)) {
    return true;
  }

  const pCatchSess = prev.cigarette_catch_last_session_score;
  const iCatchSess = incoming.cigarette_catch_last_session_score;
  if (pCatchSess == null && iCatchSess == null) {
    // both null
  } else if (pCatchSess == null || iCatchSess == null) {
    return true;
  } else if (asInt(pCatchSess, 0) !== asInt(iCatchSess, 0)) {
    return true;
  }

  return false;
}
