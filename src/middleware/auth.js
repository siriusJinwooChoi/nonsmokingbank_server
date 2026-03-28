import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";

/**
 * .env 에 `https://` 없이 `xxxx.supabase.co` 만 넣은 경우도 허용
 */
function normalizeSupabaseOrigin(raw) {
  let s = (raw ?? "").trim().replace(/\/+$/, "");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s.replace(/^\/+/, "")}`;
  }
  try {
    const u = new URL(s);
    if (!u.hostname) return "";
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function supabaseAuthV1Base() {
  const origin = normalizeSupabaseOrigin(env.supabaseUrl);
  if (!origin) {
    throw new Error(
      "SUPABASE_URL is missing or not a valid URL. Example: https://xxxx.supabase.co",
    );
  }
  return `${origin}/auth/v1`;
}

function effectiveJwtIssuer(authV1Base) {
  const fromEnv = (env.jwtIssuer ?? "").trim();
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) {
    return fromEnv.replace(/\/$/, "");
  }
  return authV1Base;
}

/** import 시점에 env 가 비어 있어도 서버 기동은 되도록 지연 초기화 */
let jwks = null;
let jwtIssuerForVerify = null;

function ensureJwks() {
  if (jwks) return;
  const authV1 = supabaseAuthV1Base();
  const jwksUrl = new URL(`${authV1}/.well-known/jwks.json`);
  jwks = createRemoteJWKSet(jwksUrl);
  jwtIssuerForVerify = effectiveJwtIssuer(authV1);
}

function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
}

export async function requireAuth(req, res, next) {
  try {
    ensureJwks();
  } catch (err) {
    console.error("[auth] JWKS init failed:", err.message);
    return res.status(503).json({
      error: "SERVER_MISCONFIGURED",
      message:
        "SUPABASE_URL (and optional JWT_ISSUER) must be set correctly in environment variables.",
    });
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "Missing bearer token" });
    }

    const { payload } = await jwtVerify(token, jwks, {
      issuer: jwtIssuerForVerify,
      audience: env.jwtAudience,
    });

    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid token subject" });
    }

    req.user = {
      id: userId,
      email: typeof payload.email === "string" ? payload.email : null,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: "UNAUTHORIZED", message: "Token verification failed" });
  }
}

