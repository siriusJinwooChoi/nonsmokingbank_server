import admin from "firebase-admin";
import { readFileSync } from "fs";
import { env } from "../config/env.js";

let _initialized = false;

/** @returns {import("firebase-admin").app.App | null} */
export function getFirebaseAdminApp() {
  if (_initialized) return admin.app();
  const raw = env.firebaseServiceAccountJson?.trim();
  if (!raw) return null;
  try {
    const cred =
      raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(readFileSync(raw, "utf8"));
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    _initialized = true;
    return admin.app();
  } catch (e) {
    console.error("[firebase-admin] init failed:", e?.message ?? e);
    return null;
  }
}
