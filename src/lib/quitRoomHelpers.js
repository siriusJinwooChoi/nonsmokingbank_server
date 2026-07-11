import { ymdInSeoulNow } from "./kstDate.js";

export const VALID_POST_TYPES = new Set([
  "text",
  "share",
  "sos",
  "certify",
  "cheer",
  "mission",
  "report",
  "damta",
]);

export const CERTIFY_DAILY_LIMIT = 3;

/** KST 기준 yyyy-mm-dd */
export function ymdInSeoul(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

/** KST 자정(UTC ms) — 해당 KST 날짜 00:00:00 */
export function kstDayStartUtcMs(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = getKstOffsetMs(new Date(utcGuess));
  return utcGuess - offset;
}

function getKstOffsetMs(date) {
  const utc = date.getTime();
  const kstStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  const [h, mi, s] = kstStr.split(":").map(Number);
  const kstMs = (h * 3600 + mi * 60 + s) * 1000;
  const utcH = date.getUTCHours();
  const utcMi = date.getUTCMinutes();
  const utcS = date.getUTCSeconds();
  const utcPart = (utcH * 3600 + utcMi * 60 + utcS) * 1000;
  return kstMs - utcPart;
}

export function computeQuitDaysFromStartMs(startTimeMs) {
  if (!startTimeMs || !Number.isFinite(Number(startTimeMs))) return 0;
  const start = new Date(Number(startTimeMs));
  const now = new Date();
  const startYmd = ymdInSeoul(start);
  const nowYmd = ymdInSeoul(now);
  const startDay = kstDayStartUtcMs(startYmd);
  const nowDay = kstDayStartUtcMs(nowYmd);
  const diff = Math.floor((nowDay - startDay) / (24 * 60 * 60 * 1000));
  return diff < 0 ? 0 : diff + 1;
}

export function isoWeekKeyInSeoul(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const ymd = fmt.format(date);
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const day = new Date(utc).getUTCDay() || 7;
  const thursday = utc + (4 - day) * 86400000;
  const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return `${new Date(thursday).getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function weekRangeInSeoul(weekKey) {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    startYmd: ymdInSeoul(monday),
    endYmd: ymdInSeoul(sunday),
  };
}

export function normalizePostType(raw, isSosAlert = false) {
  if (typeof raw === "string" && VALID_POST_TYPES.has(raw)) return raw;
  if (isSosAlert) return "sos";
  return "text";
}

export function formatPostRow(post, reactionsByPost = {}) {
  const postType = normalizePostType(post.post_type, post.is_sos_alert);
  const reactions = reactionsByPost[post.id] ?? [];
  return {
    id: post.id,
    author_id: post.author_id,
    author_nickname: post.author_nickname,
    content: post.content,
    image_url: post.image_url,
    is_sos_alert: postType === "sos" || post.is_sos_alert === true,
    post_type: postType,
    metadata: post.metadata ?? {},
    author_system: post.author_system === true,
    created_at: post.created_at,
    reactions,
  };
}

export function toRoomResponseExtended(room, extra = {}) {
  return {
    id: room.id,
    name: room.name,
    room_type: room.type,
    invite_code: room.invite_code,
    owner_id: room.creator_id,
    member_count: extra.memberCount ?? 1,
    max_members: room.max_members ?? 10,
    created_at: room.created_at,
    my_nickname: extra.myNickname ?? null,
    my_role: extra.myRole ?? null,
    is_admin: extra.myRole === "owner",
    goal_type: room.goal_type ?? "none",
    goal_days: room.goal_days ?? null,
    goal_end_date: room.goal_end_date ?? null,
    pledge_text: room.pledge_text ?? null,
    challenge_started_at: room.challenge_started_at ?? null,
  };
}

export function todayKstBoundsIso() {
  const ymd = ymdInSeoulNow();
  const startMs = kstDayStartUtcMs(ymd);
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return {
    ymd,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}
