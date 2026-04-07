import { Router } from "express";
import { sanitizePublicText } from "../lib/profanityFilter.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { seoulMondayStartMs } from "../lib/seoulWeek.js";

const router = Router();

/** @type {{ id: string, text: string, color: string, ts: number, authorName: string }[]} */
const messages = [];
const MAX_MESSAGES = 300;
const MAX_TEXT_LEN = 40;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20;

/** @type {Map<string, number[]>} */
const rateByIp = new Map();

/** 담타 화면 동시 접속(하트비트). 단일 Node 프로세스 기준. */
const PRESENCE_TTL_MS = 45 * 1000;
/** @type {Map<string, number>} */
const presenceByUser = new Map();

/** 현재 서울 기준 주(월~일)에 속한 메시지만 유지. 일요일 밤 이후(월요일 00:00) 이전 주는 일괄 제거. */
function pruneExpired() {
  const weekStart = seoulMondayStartMs();
  for (let i = messages.length - 1; i >= 0; i--) {
    if (seoulMondayStartMs(messages[i].ts) !== weekStart) {
      messages.splice(i, 1);
    }
  }
}

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

router.get("/messages", (req, res) => {
  pruneExpired();
  const items = messages.slice(-50);
  res.status(200).json({ ok: true, items });
});

/**
 * POST /v1/community/damta/presence
 * 담타 화면에 머무는 동안 주기적으로 호출 → 동시 접속자 수 집계.
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
    const hinted = typeof req.body?.authorName === "string" ? req.body.authorName.trim() : "";
    if (hinted) {
      authorName = sanitizePublicText(hinted).slice(0, 12).trim() || "익명";
    }
  }

  pruneExpired();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const item = { id, text, color, ts: Date.now(), authorName };
  messages.push(item);
  while (messages.length > MAX_MESSAGES) {
    messages.shift();
  }

  res.status(201).json({ ok: true, item });
  } catch (err) {
    return next(err);
  }
});

export default router;
