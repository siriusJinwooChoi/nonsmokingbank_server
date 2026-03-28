# nonsmokingbank_server

금연뱅크 앱용 API 서버(Express) 초기 템플릿입니다.

## 1) 로컬 실행

```bash
npm install
npm run dev
```

서버 기본 주소:

- `http://localhost:3000/`
- `http://localhost:3000/health`
- `http://localhost:3000/v1/health`

## 1-1) 추가된 API 구조

- `GET /v1/health` : 버전 헬스체크
- `GET /v1/reasons` : 내 금연 이유 목록/대표 이유 조회 (JWT 필요)
- `PUT /v1/reasons/pinned` : 대표 이유 저장 및 중요 이유 고정 (JWT 필요)

`Authorization: Bearer <supabase_access_token>` 헤더가 필요합니다.

## 2) Render 배포 설정

- Runtime/Language: `Node`
- Build Command: `npm ci`
- Start Command: `npm run start:prod`
- Health Check Path: `/health`

필수 Environment Variables:

- `NODE_ENV=production`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (Auth 프록시용)
- `JWT_AUDIENCE` (선택, 기본 `authenticated`; `JWT_ISSUER`는 비워도 되며 `SUPABASE_URL` 기준으로 검증)

## 2-1) 빠른 테스트 예시

```bash
curl http://localhost:3000/v1/health
```

```bash
curl -X PUT http://localhost:3000/v1/reasons/pinned \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d "{\"text\":\"가족과 더 건강하게 오래 살기 위해\"}"
```

## 2-2) 앱 원격 에셋(이미지·Lottie)

앱 번들 용량을 줄이기 위해 이미지·JSON 애니메이션은 **`public/app-assets`** 에 두고 HTTP로 제공합니다.

- 정적 파일: `GET https://<호스트>/static/<상대경로>`
  - 예: `/static/cigarettes/pack1.png`, `/static/lottie/water.json`, `/static/scoin.png`
- 담배갑 PNG/JPG 목록(JSON): `GET /v1/assets/cigarettes` → `{ "ok": true, "items": ["cigarettes/a.png", ...] }`

로컬 기본 폴더는 `public/app-assets` 입니다. 다른 경로를 쓰려면 환경 변수 **`ASSETS_ROOT`**(절대 경로 권장)를 설정하세요.

배포 후 담배갑을 추가·교체할 때는 서버의 `app-assets/cigarettes/` 에 파일을 넣고 재시작 없이도 목록 API가 디렉터리를 읽어 반영합니다(캐시는 CDN/브라우저 정책에 따름).

## 3) GitHub 업로드

```bash
git init
git add .
git commit -m "Initialize Express API server template"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

