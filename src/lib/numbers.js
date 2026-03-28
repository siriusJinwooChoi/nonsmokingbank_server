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
  return false;
}
