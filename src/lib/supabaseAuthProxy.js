import { env } from "../config/env.js";

function supabaseOrigin() {
  return env.supabaseUrl.replace(/\/$/, "");
}

/**
 * Supabase GoTrue (Auth) REST — anon 키는 서버에만 둠.
 */
export async function supabaseAuthPost(pathWithQuery, body) {
  const path = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const url = `${supabaseOrigin()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${env.supabaseAnonKey}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      json?.error_description || json?.msg || json?.message || json?.error || res.statusText || "auth_error",
    );
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}
