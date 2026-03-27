const requiredVars = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_ISSUER",
  "JWT_AUDIENCE",
];

function readEnv(name, fallback = "") {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: readEnv("NODE_ENV", "development"),
  port: Number(readEnv("PORT", "3000")),
  supabaseUrl: readEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  jwtIssuer: readEnv("JWT_ISSUER"),
  jwtAudience: readEnv("JWT_AUDIENCE", "authenticated"),
};

export function validateEnv() {
  const missing = requiredVars.filter((k) => !readEnv(k));
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

