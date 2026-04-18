import { Router } from "express";
import { env } from "../config/env.js";
import { supabaseAuthPost } from "../lib/supabaseAuthProxy.js";

const router = Router();

function authSuccessPayload(data) {
  return {
    ok: true,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    token_type: data.token_type,
    user: data.user ?? null,
  };
}

/** 이메일·비밀번호 로그인 */
router.post("/sign-in", async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "email and password required" });
    }
    const data = await supabaseAuthPost("/auth/v1/token?grant_type=password", { email, password });
    return res.status(200).json(authSuccessPayload(data));
  } catch (err) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 401;
    return res.status(status).json({
      error: "AUTH_FAILED",
      message: err.message,
      details: err.body ?? null,
    });
  }
});

/** 회원가입 (이메일 확인 끈 프로젝트면 세션이 바로 올 수 있음) */
router.post("/sign-up", async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "email and password required" });
    }
    const data = await supabaseAuthPost("/auth/v1/signup", { email, password });
    return res.status(200).json({ ok: true, user: data.user ?? null, session: data.session ?? null });
  } catch (err) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 400;
    return res.status(status).json({
      error: "SIGNUP_FAILED",
      message: err.message,
      details: err.body ?? null,
    });
  }
});

/** 리프레시 토큰으로 액세스 토큰 갱신 */
router.post("/refresh", async (req, res) => {
  try {
    const refresh_token =
      typeof req.body?.refresh_token === "string" ? req.body.refresh_token : "";
    if (!refresh_token) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "refresh_token required" });
    }
    const data = await supabaseAuthPost("/auth/v1/token?grant_type=refresh_token", { refresh_token });
    return res.status(200).json(authSuccessPayload(data));
  } catch (err) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 401;
    return res.status(status).json({
      error: "REFRESH_FAILED",
      message: err.message,
      details: err.body ?? null,
    });
  }
});

/**
 * OAuth PKCE: 브라우저에서 받은 code + 앱이 보관한 code_verifier 로 세션 발급
 */
router.post("/oauth/pkce", async (req, res) => {
  try {
    const auth_code = typeof req.body?.auth_code === "string" ? req.body.auth_code : "";
    const code_verifier = typeof req.body?.code_verifier === "string" ? req.body.code_verifier : "";
    if (!auth_code || !code_verifier) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "auth_code and code_verifier required" });
    }
    const data = await supabaseAuthPost("/auth/v1/token?grant_type=pkce", {
      auth_code,
      code_verifier,
    });
    return res.status(200).json(authSuccessPayload(data));
  } catch (err) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 401;
    return res.status(status).json({
      error: "OAUTH_PKCE_FAILED",
      message: err.message,
      details: err.body ?? null,
    });
  }
});

/**
 * iOS/macOS 네이티브 Sign in with Apple → identityToken 을 Supabase 세션으로 교환
 * POST /v1/auth/oauth/apple-id-token  { id_token, nonce? }
 */
router.post("/oauth/apple-id-token", async (req, res) => {
  try {
    const id_token = typeof req.body?.id_token === "string" ? req.body.id_token : "";
    const nonce = typeof req.body?.nonce === "string" ? req.body.nonce : "";
    if (!id_token) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "id_token required" });
    }
    const body = { provider: "apple", id_token };
    if (nonce) body.nonce = nonce;
    const data = await supabaseAuthPost("/auth/v1/token?grant_type=id_token", body);
    return res.status(200).json(authSuccessPayload(data));
  } catch (err) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 401;
    return res.status(status).json({
      error: "APPLE_ID_TOKEN_FAILED",
      message: err.message,
      details: err.body ?? null,
    });
  }
});

/**
 * 브라우저에서 열 Supabase /authorize URL (앱은 Supabase URL/anon 없이 BFF만 호출)
 * GET /v1/auth/oauth/authorize-url?provider=google&redirect_to=...&code_challenge=...&code_challenge_method=S256&scopes=...
 */
router.get("/oauth/authorize-url", (req, res) => {
  const provider = typeof req.query.provider === "string" ? req.query.provider : "";
  const redirect_to = typeof req.query.redirect_to === "string" ? req.query.redirect_to : "";
  const code_challenge = typeof req.query.code_challenge === "string" ? req.query.code_challenge : "";
  const code_challenge_method =
    typeof req.query.code_challenge_method === "string" ? req.query.code_challenge_method : "S256";
  const scopes = typeof req.query.scopes === "string" ? req.query.scopes : "";

  if (!provider || !redirect_to || !code_challenge) {
    return res.status(400).json({
      error: "BAD_REQUEST",
      message: "provider, redirect_to, code_challenge required",
    });
  }

  const base = `${env.supabaseUrl.replace(/\/$/, "")}/auth/v1/authorize`;
  const u = new URL(base);
  u.searchParams.set("provider", provider);
  u.searchParams.set("redirect_to", redirect_to);
  u.searchParams.set("code_challenge", code_challenge);
  u.searchParams.set("code_challenge_method", code_challenge_method);
  if (scopes.trim()) {
    u.searchParams.set("scopes", scopes.trim());
  }

  return res.status(200).json({ ok: true, url: u.toString() });
});

export default router;
