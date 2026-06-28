import { Router } from "express";
import { sanitizePublicText } from "../lib/profanityFilter.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { seoulMondayStartMs } from "../lib/seoulWeek.js";

const router = Router();

const MAX_TEXT_LEN = 40;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20;

/** @type {Map<string, number[]>} */
const rateByIp = new Map();

/** 담타 화면 동시 접속 하트비트 (인메모리 유지) */
const PRESENCE_TTL_MS = 45 * 1000;
/** @type {Map<string, number>} */
const presenceByUser = new Map();

function allowRate(ip) {
  const now = Date.now();
  const arr = rateByIp.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) return false;
  recent.push(now);
  rateByIp.set(ip, recent);
  return true;
}

function prunePresence() {
  const now = Date.now();
  for (const [uid, t] of presenceByUser) {
    if (now - t > PRESENCE_TTL_MS) presenceByUser.delete(uid);
  }
}

/**
 * GET /v1/community/damta/messages
 * 현재 서울 기준 주(월~일)의 최근 50건을 DB에서 반환
 */
router.get("/messages", async (req, res, next) => {
  try {
    const weekStartMs = seoulMondayStartMs();
    const weekStartIso = new Date(weekStartMs).toISOString();

    const { data, error } = await supabaseAdmin
      .from("damta_messages")
      .select("id, user_id, text, color, author_name, created_at")
      .gte("created_at", weekStartIso)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw error;

    const items = (data ?? []).map((row) => ({
      id: row.id,
      text: row.text,
      color: row.color,
      ts: new Date(row.created_at).getTime(),
      authorName: row.author_name,
    }));

    return res.status(200).json({ ok: true, items });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /v1/community/damta/presence
 * 담타 화면에 머무는 동안 주기적으로 호출 → 동시 접속자 수 집계
 */
router.post("/presence", (req, res) => {
  const uid = req.user?.id;
  if (!uid) {
    return res.status(401).json({ error: "UNAUTH", message: "login required" });
  }
  prunePresence();
  presenceByUser.set(String(uid), Date.now());
  prunePresence();
  return res.status(200).json({ ok: true, count: presenceByUser.size });
});

/**
 * POST /v1/community/damta/messages
 * body: { text, color?, authorName? }
 */
router.post("/messages", async (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    if (!allowRate(ip)) {
      return res.status(429).json({
        error: "RATE_LIMIT",
        message: "Too many messages. Try again later.",
      });
    }

    let text = typeof req.body?.text === "string" ? req.body.text : "";
    text = text.slice(0, MAX_TEXT_LEN);
    text = sanitizePublicText(text).trim();
    if (!text) {
      return res.status(400).json({
        error: "EMPTY",
        message: "Message is empty after filtering.",
      });
    }

    let color =
      typeof req.body?.color === "string" ? req.body.color.trim() : "#22d3ee";
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      color = "#22d3ee";
    }

    // 닉네임: 로그인된 프로필 display_name 우선, 없으면 body.authorName, 없으면 익명
    let authorName = "익명";
    const userId = req.user?.id;
    if (userId) {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      const n = data?.display_name;
      if (typeof n === "string" && n.trim() !== "") {
        authorName = n.trim();
      }
    }
    if (authorName === "익명") {
      const hinted =
        typeof req.body?.authorName === "string"
          ? req.body.authorName.trim()
          : "";
      if (hinted) {
        authorName =
          sanitizePublicText(hinted).slice(0, 12).trim() || "익명";
      }
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("damta_messages")
      .insert({
        user_id: userId ?? null,
        text,
        color,
        author_name: authorName,
      })
      .select("id, text, color, author_name, created_at")
      .single();
    if (insErr) throw insErr;

    const item = {
      id: inserted.id,
      text: inserted.text,
      color: inserted.color,
      ts: new Date(inserted.created_at).getTime(),
      authorName: inserted.author_name,
    };

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    return next(err);
  }
});

export default router;
