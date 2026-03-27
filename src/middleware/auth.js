import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";

const jwks = createRemoteJWKSet(new URL(`${env.jwtIssuer}/.well-known/jwks.json`));

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
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "Missing bearer token" });
    }

    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.jwtIssuer,
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

