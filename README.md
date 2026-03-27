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

## 3) GitHub 업로드

```bash
git init
git add .
git commit -m "Initialize Express API server template"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

