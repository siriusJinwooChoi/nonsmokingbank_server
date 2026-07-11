import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { hourMinuteInSeoulNow } from "../lib/kstTime.js";
import {
  formatPostRow,
  isoWeekKeyInSeoul,
  weekRangeInSeoul,
} from "../lib/quitRoomHelpers.js";
import { env } from "../config/env.js";

const POST_SELECT =
  "id, room_id, author_id, author_nickname, content, image_url, is_sos_alert, post_type, metadata, author_system, created_at";

let _lastWeeklyKey = "";
let _weeklyInFlight = false;

async function buildWeeklyReportContent(roomId, weekKey) {
  const range = weekRangeInSeoul(weekKey);
  if (!range) return null;

  const startIso = new Date(`${range.startYmd}T00:00:00+09:00`).toISOString();
  const endIso = new Date(`${range.endYmd}T23:59:59+09:00`).toISOString();

  const { data: posts, error } = await supabaseAdmin
    .from("quit_room_posts")
    .select("post_type, metadata, created_at")
    .eq("room_id", roomId)
    .gte("created_at", startIso)
    .lte("created_at", endIso);
  if (error) throw error;

  let certifyCount = 0;
  let sosCount = 0;
  let cheerCount = 0;
  let totalSaved = 0;
  const hourCounts = {};

  for (const p of posts ?? []) {
    if (p.post_type === "certify" || p.post_type === "share") certifyCount += 1;
    if (p.post_type === "sos") sosCount += 1;
    if (p.post_type === "cheer") cheerCount += 1;
    const saved = Number(p.metadata?.saved_money ?? 0);
    if (Number.isFinite(saved)) totalSaved += saved;
    const h = Number(
      new Date(p.created_at).toLocaleString("en-US", {
        timeZone: "Asia/Seoul",
        hour: "numeric",
        hour12: false,
      }),
    );
    hourCounts[h] = (hourCounts[h] ?? 0) + 1;
  }

  let peakHour = null;
  let peakMax = 0;
  for (const [h, c] of Object.entries(hourCounts)) {
    if (c > peakMax) {
      peakMax = c;
      peakHour = Number(h);
    }
  }

  const peakLabel = peakHour != null ? `${peakHour}시` : "—";
  const savedLabel =
    totalSaved >= 10000
      ? `₩${Math.round(totalSaved / 10000)}만`
      : `₩${totalSaved.toLocaleString("ko-KR")}`;

  const content = [
    `📈 주간 레포트 (${range.startYmd.slice(5).replace("-", "/")} ~ ${range.endYmd.slice(5).replace("-", "/")})`,
    `· 인증 ${certifyCount}회 · SOS ${sosCount}회 · 응원 ${cheerCount}회`,
    `· 가장 힘든 시간대: ${peakLabel}`,
    `· 합산 절약: ${savedLabel}`,
    "다음 주도 같이 가요 💪",
  ].join("\n");

  return {
    content,
    metadata: {
      week_key: weekKey,
      start_ymd: range.startYmd,
      end_ymd: range.endYmd,
      certify_count: certifyCount,
      sos_count: sosCount,
      cheer_count: cheerCount,
      total_saved: totalSaved,
      peak_hour: peakHour,
    },
  };
}

async function createWeeklyReportForRoom(roomId, weekKey) {
  const { data: existing } = await supabaseAdmin
    .from("quit_room_weekly_reports")
    .select("post_id")
    .eq("room_id", roomId)
    .eq("week_key", weekKey)
    .maybeSingle();
  if (existing) return { skipped: true };

  const report = await buildWeeklyReportContent(roomId, weekKey);
  if (!report) return { skipped: true };

  const { data: post, error: postErr } = await supabaseAdmin
    .from("quit_room_posts")
    .insert({
      room_id: roomId,
      author_id: null,
      author_nickname: "금연뱅크",
      content: report.content,
      is_sos_alert: false,
      post_type: "report",
      metadata: report.metadata,
      author_system: true,
    })
    .select(POST_SELECT)
    .single();
  if (postErr) throw postErr;

  await supabaseAdmin.from("quit_room_weekly_reports").insert({
    room_id: roomId,
    week_key: weekKey,
    post_id: post.id,
  });

  return { created: true, post: formatPostRow(post, {}) };
}

export async function runQuitRoomWeeklyReportsForAllRooms(weekKey) {
  const { data: rooms, error } = await supabaseAdmin
    .from("quit_rooms")
    .select("id");
  if (error) throw error;

  let created = 0;
  let skipped = 0;
  for (const room of rooms ?? []) {
    try {
      const result = await createWeeklyReportForRoom(room.id, weekKey);
      if (result.created) created += 1;
      else skipped += 1;
    } catch (e) {
      console.error(
        `[quitRoomWeeklyReportCron] room ${room.id}:`,
        e?.message ?? e,
      );
    }
  }
  return { created, skipped, weekKey };
}

async function tickWeeklyReport() {
  const { hour, minute } = hourMinuteInSeoulNow();
  // 월요일 09:00 KST
  const day = new Date().toLocaleString("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  });
  if (day !== "Mon" || hour !== 9 || minute !== 0) return;

  const weekKey = isoWeekKeyInSeoul();
  if (weekKey === _lastWeeklyKey || _weeklyInFlight) return;

  _weeklyInFlight = true;
  try {
    const result = await runQuitRoomWeeklyReportsForAllRooms(weekKey);
    _lastWeeklyKey = weekKey;
    console.log(
      `[quitRoomWeeklyReportCron] week=${weekKey} created=${result.created} skipped=${result.skipped}`,
    );
  } finally {
    _weeklyInFlight = false;
  }
}

export function startQuitRoomWeeklyReportCron() {
  if (!env.enableQuitRoomWeeklyReportCron) {
    console.log(
      "[quitRoomWeeklyReportCron] disabled (ENABLE_QUIT_ROOM_WEEKLY_REPORT_CRON=false)",
    );
    return;
  }

  const intervalMs = Math.max(30_000, env.quitRoomWeeklyReportCronIntervalMs);
  setInterval(() => {
    tickWeeklyReport().catch((e) =>
      console.error("[quitRoomWeeklyReportCron] tick:", e?.message ?? e),
    );
  }, intervalMs);

  tickWeeklyReport().catch((e) =>
    console.error("[quitRoomWeeklyReportCron] initial:", e?.message ?? e),
  );

  console.log(`[quitRoomWeeklyReportCron] started every ${intervalMs}ms`);
}
