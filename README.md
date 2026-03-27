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
- `JWT_ISSUER`
- `JWT_AUDIENCE=authenticated`

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

## 3) GitHub 업로드

```bash
git init
git add .
git commit -m "Initialize Express API server template"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

