import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

/**
 * 라우트 모듈이 import 될 때 바로 createClient 하면 .env 가 비어 있을 때 프로세스가 죽습니다.
 * 첫 Supabase 접근 시점에만 클라이언트를 만듭니다.
 */
let _admin = null;

function ensureSupabaseAdmin() {
  if (_admin) return _admin;
  const url = (env.supabaseUrl ?? "").trim();
  const key = (env.supabaseServiceRoleKey ?? "").trim();
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 비어 있습니다. " +
        "프로젝트 루트에 .env 파일을 두고 값을 채우세요. (.env.example 참고)",
    );
  }
  _admin = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return _admin;
}

export const supabaseAdmin = new Proxy(
  /** @type {import("@supabase/supabase-js").SupabaseClient} */ ({}),
  {
    get(_target, prop) {
      const client = ensureSupabaseAdmin();
      const value = client[prop];
      if (typeof value === "function") {
        return value.bind(client);
      }
      return value;
    },
  },
);
