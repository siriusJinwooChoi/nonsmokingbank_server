const requiredVars = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_ISSUER",
  "JWT_AUDIENCE",
];

function readEnv(name, fallback = "") {
  return process.env[name] ?? fallback;
}

/** 정수 환경변수: 비어 있거나 잘못되면 default, [min,max]로 클램프 */
function readIntEnv(name, defaultVal, min, max) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultVal;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return defaultVal;
  return Math.min(Math.max(n, min), max);
}

export const env = {
  nodeEnv: readEnv("NODE_ENV", "development"),
  port: Number(readEnv("PORT", "3000")),
  supabaseUrl: readEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  jwtIssuer: readEnv("JWT_ISSUER"),
  jwtAudience: readEnv("JWT_AUDIENCE", "authenticated"),
  /** 일일 게임 보상 1회 지급 코인 (Render 등에서 조정) */
  gameRewardCoinsPerClaim: readIntEnv("GAME_REWARD_COINS_PER_CLAIM", 5, 1, 500),
  /** 보상 claim 시 허용하는 game_stats.stats_updated_at 최대 경과(분) */
  gameStatsFreshMinutes: readIntEnv("GAME_STATS_FRESH_MINUTES", 25, 5, 1440),
  /** 단어 게임 보상에 필요한 최소 레벨(서버 저장 레벨과 proof 일치 + 이 값 이상) */
  wordGameMinLevelForReward: readIntEnv("WORD_GAME_MIN_LEVEL_FOR_REWARD", 2, 2, 100),
  /** 완벽 타이밍 보상에 필요한 최소 최고 점수 */
  timingTapMinBestScoreForReward: readIntEnv("TIMING_TAP_MIN_BEST_SCORE_FOR_REWARD", 1, 1, 10_000_000),
  /** 담배맞추기 보상에 필요한 최소 최고 점수 */
  cigaretteCatchMinBestScoreForReward: readIntEnv(
    "CIGARETTE_CATCH_MIN_BEST_SCORE_FOR_REWARD",
    1,
    1,
    10_000_000,
  ),
};

export function validateEnv() {
  const missing = requiredVars.filter((k) => !readEnv(k));
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

