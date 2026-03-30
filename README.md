# nonsmokingbank_server

금연뱅크 앱용 API 서버(Express + Supabase Admin).

## 로컬 실행

```bash
npm install
npm run dev
```

- `http://localhost:3000/` — 서비스 상태
- `http://localhost:3000/health`
- `http://localhost:3000/v1/health`

## 환경 변수

프로젝트 루트에 **`.env`** 파일을 두고 설정합니다. (Git에 올리지 마세요. `.gitignore`에 포함됨.)

### 필수

| 변수 | 설명 |
|------|------|
| `SUPABASE_URL` | `https://xxxx.supabase.co` 또는 `xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 서비스 롤 키 (서버 전용, 앱에 넣지 않음) |
| `SUPABASE_ANON_KEY` | Auth 프록시(로그인·OAuth PKCE)용 anon 공개 키 |

### 선택

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `NODE_ENV` | `development` | `production` 권장(배포) |
| `PORT` | `3000` | 리슨 포트 |
| `JWT_ISSUER` | (비움) | 비우면 `SUPABASE_URL` 기준 `.../auth/v1` 로 JWT 검증 |
| `JWT_AUDIENCE` | `authenticated` | JWT `aud` |
| `GAME_REWARD_COINS_PER_CLAIM` | `2` | 미니게임 일일 보상 코인(종목당 1일 1회) |
| `GAME_STATS_FRESH_MINUTES` | `25` | 보상 claim 시 허용하는 `stats_updated_at` 최대 경과(분) |
| `WORD_GAME_MIN_LEVEL_FOR_REWARD` | `2` | 단어 게임 보상 최소 레벨 |
| `TIMING_TAP_MIN_BEST_SCORE_FOR_REWARD` | `1` | 완벽 타이밍 보상 최소 최고 점수 |
| `CIGARETTE_CATCH_MIN_BEST_SCORE_FOR_REWARD` | `1` | 담배맞추기 보상 최소 최고 점수 |
| `ASSETS_ROOT` | (비움) | 원격 에셋 폴더 절대 경로. 비우면 저장소 `public/app-assets` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | (비움) | Firebase **서비스 계정** JSON 전체를 **한 줄 문자열**로 넣거나, 서버 디스크의 **절대 경로** (Admin SDK로 FCM 발송) |
| `ENABLE_FCM_REMINDER_CRON` | `false` | `true`일 때만 매 분 KST로 일일·수집·출석 FCM 전송 크론 동작 |
| `FCM_REMINDER_CRON_INTERVAL_MS` | `15000` | 크론 폴링 간격(ms). 최소 `5000`, 최대 `120000` |

**앱이 Android에서 FCM 토큰 등록에 성공하면 로컬 알람(일일·수집·출석)이 꺼지고, 이 크론이 실제로 알림을 보냅니다.** 배포 환경에서 `ENABLE_FCM_REMINDER_CRON=true` 와 유효한 `FIREBASE_SERVICE_ACCOUNT_JSON` 이 없으면 해당 알림은 **오지 않습니다.**

### `.env` 예시 (값만 바꿔서 사용)

```env
NODE_ENV=development
PORT=3000

SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret
SUPABASE_ANON_KEY=your-anon-key

JWT_ISSUER=
JWT_AUDIENCE=authenticated

# 선택 — 게임·에셋 튜닝
# GAME_REWARD_COINS_PER_CLAIM=2
# ASSETS_ROOT=

# FCM 일일·수집·출석 알림 (앱이 토큰 등록 시 로컬 대신 서버 푸시 사용)
# ENABLE_FCM_REMINDER_CRON=true
# FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
# FCM_REMINDER_CRON_INTERVAL_MS=15000
```

## API 개요

- `GET /v1/health`
- `POST /v1/auth/sign-in`, `sign-up`, `refresh`, `oauth/pkce`, `GET .../oauth/authorize-url`
- `GET|PATCH /v1/profile` (JWT)
- `GET /v1/sync/pull`, `PUT /v1/sync/push` (JWT)
- `GET|PUT /v1/reasons`, `PUT /v1/reasons/pinned`, `PUT /v1/reasons/sync` (JWT)
- `GET /v1/attendance/state`, `POST /v1/attendance/check-in` (JWT)
- `GET /v1/coins/balance`, `POST /v1/coins/consume` (JWT)
- `PUT /v1/games/stats`, `GET /v1/games/reward/settings`, `POST /v1/games/reward/claim`, `GET /v1/games/rankings` (JWT)

`Authorization: Bearer <supabase_access_token>` 가 필요한 엔드포인트는 위에 (JWT) 로 표시했습니다.

## Render 배포

- Runtime: **Node**
- Build Command: `npm ci` (또는 대시보드에 `npm ci && npm run build` 로 되어 있으면 그대로 두어도 됩니다. `build` 는 문법 검사만 수행합니다.)
- Start Command: `npm run start:prod`
- Health Check Path: `/health`

Render 대시보드에 위 **필수** 환경 변수를 넣고, 게임 보상 금액을 바꿀 때는 `GAME_REWARD_COINS_PER_CLAIM` 을 설정합니다.

**FCM 알림을 쓰려면** 같은 환경에 `ENABLE_FCM_REMINDER_CRON=true` 와 `FIREBASE_SERVICE_ACCOUNT_JSON` 을 추가한 뒤 **재배포**하세요. 배포 로그에 `[fcmDailyReminderCron] started every ...ms` 가 보이면 크론이 떠 있는 것입니다. (Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 JSON 생성)

## 원격 에셋(이미지·Lottie)

앱 번들을 줄이기 위해 정적 파일은 **`public/app-assets`** 에 두고 HTTP로 제공합니다.

- `GET https://<호스트>/static/<상대경로>`  
  예: `/static/cigarettes/pack1.png`, `/static/lottie/water.json`
- 담배갑 목록: `GET /v1/assets/cigarettes` → `{ "ok": true, "items": [...] }`

다른 경로를 쓰려면 **`ASSETS_ROOT`**(절대 경로 권장)를 설정하세요.

## 빠른 테스트

```bash
curl http://localhost:3000/v1/health
```

```bash
curl -X PUT http://localhost:3000/v1/reasons/pinned \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d "{\"text\":\"가족과 더 건강하게 오래 살기 위해\"}"
```
