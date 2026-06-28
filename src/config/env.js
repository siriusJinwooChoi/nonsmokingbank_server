const requiredVars = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
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
  /** GoTrue(로그인·OAuth PKCE 교환) — 앱에는 넣지 않고 서버만 보유 */
  supabaseAnonKey: readEnv("SUPABASE_ANON_KEY"),
  jwtIssuer: readEnv("JWT_ISSUER"),
  jwtAudience: String(readEnv("JWT_AUDIENCE", "authenticated")).trim() || "authenticated",
  /**
   * 앱 원격 에셋(이미지·Lottie) 정적 폴더. 비우면 기본값은 저장소의 public/app-assets (index.js에서 경로 조합).
   */
  assetsRoot: readEnv("ASSETS_ROOT", ""),
  /** Firebase Admin JSON 문자열 또는 서버 디스크 경로 (금연 리마인더 FCM) */
  firebaseServiceAccountJson: readEnv("FIREBASE_SERVICE_ACCOUNT_JSON", ""),
  /** true 이면 매 분 KST로 reminder_times_json 일치 시 FCM 전송 */
  enableFcmReminderCron: readEnv("ENABLE_FCM_REMINDER_CRON", "false") === "true",
  fcmReminderCronIntervalMs: readIntEnv("FCM_REMINDER_CRON_INTERVAL_MS", 15000, 5000, 120000),
  /**
   * 네이티브 Sign in with Apple → GoTrue `grant_type=id_token` 시 `client_id`.
   * identityToken JWT의 `aud`와 동일해야 함(일반적으로 Xcode 번들 ID).
   * Render에서 `APPLE_NATIVE_CLIENT_ID` 로 덮어쓸 수 있음.
   */
  appleNativeClientId: readEnv("APPLE_NATIVE_CLIENT_ID", "com.cjw.nonsmoking"),
};

export function validateEnv() {
  const missing = requiredVars.filter((k) => !String(readEnv(k)).trim());
  if (missing.length > 0) {
    const supabaseLike = Object.keys(process.env).filter((k) =>
      k.toUpperCase().includes("SUPABASE"),
    );
    const hint =
      supabaseLike.length > 0
        ? ` Render에서 설정된 SUPABASE 관련 키 이름: ${supabaseLike.join(", ")} (이름이 위 목록과 정확히 일치해야 합니다.)`
        : "";
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. ` +
        `로컬은 프로젝트 루트에 .env 를 두고 README의 환경 변수 항목을 참고하세요.${hint}`,
    );
  }
}

