import { Router } from "express";
import { sanitizePublicText } from "../lib/profanityFilter.js";

const router = Router();

/** @type {{ id: string, text: string, color: string, ts: number }[]} */
const messages = [];
const MAX_MESSAGES = 100;
const TTL_MS = 5 * 60 * 1000;
const MAX_TEXT_LEN = 40;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20;

/** @type {Map<string, number[]>} */
const rateByIp = new Map();

function pruneExpired() {
  const now = Date.now();
  while (messages.length > 0 && now - messages[0].ts > TTL_MS) {
    messages.shift();
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

router.get("/messages", (req, res) => {
  pruneExpired();
  const items = messages.slice(-50);
  res.status(200).json({ ok: true, items });
});

router.post("/messages", (req, res) => {
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

  pruneExpired();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const item = { id, text, color, ts: Date.now() };
  messages.push(item);
  while (messages.length > MAX_MESSAGES) {
    messages.shift();
  }

  res.status(201).json({ ok: true, item });
});

export default router;
