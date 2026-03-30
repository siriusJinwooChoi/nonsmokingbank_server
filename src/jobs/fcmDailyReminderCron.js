import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { getFirebaseAdminApp } from "../lib/firebaseAdmin.js";
import { hourMinuteInSeoulNow } from "../lib/kstTime.js";
import { ymdInSeoulNow } from "../lib/kstDate.js";
import { env } from "../config/env.js";

/** 09/12/18/22 정각 담배 수집 알림 (로컬과 동일) */
const COLLECTION_HOURS = [9, 12, 18, 22];

/** reminder_times_json 항목이 현재 KST 시·분과 일치하는지 */
function matchesReminderNow(reminderTimesJson, hour, minute) {
  if (!Array.isArray(reminderTimesJson)) return false;
  for (const item of reminderTimesJson) {
    if (!item || typeof item !== "object") continue;
    const keys = Object.keys(item);
    if (keys.length === 0) continue;
    const h = item.h ?? item.hour;
    const m = item.m ?? item.minute ?? 0;
    if (h === undefined || h === null) continue;
    if (Number(h) === hour && Number(m) === minute) return true;
  }
  return false;
}

/** null/undefined → 켜짐 (sync triBool과 동일) */
function notifEnabled(val) {
  return val !== false;
}

function attendanceDatePrefix(v) {
  if (v == null) return null;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

let _lastTickKey = "";

async function sendFcm(messaging, token, title, body, channelId) {
  await messaging.send({
    token,
    notification: { title, body },
    android: {
      priority: "high",
      notification: {
        channelId,
        sound: "default",
      },
    },
  });
}

/**
 * 매 분 KST 기준으로 일일 리마인더·담배수집 정각·출석(18시 이후 10분 간격) FCM 전송.
 * 동일 분 중복 tick 방지를 위해 분 단위 키를 사용합니다.
 */
export async function tickFcmDailyReminders() {
  if (!env.enableFcmReminderCron) return;
  const app = getFirebaseAdminApp();
  if (!app) return;

  const { hour, minute } = hourMinuteInSeoulNow();
  const tickKey = `${hour}:${minute}`;
  if (tickKey === _lastTickKey) return;
  _lastTickKey = tickKey;

  const todayYmd = ymdInSeoulNow();

  const { data: rows, error } = await supabaseAdmin
    .from("notification_settings")
    .select(
      "user_id, reminder_times_json, fcm_token, attendance_reminder_enabled, cigarette_collection_reminder_enabled",
    )
    .not("fcm_token", "is", null);

  if (error) {
    console.error("[fcmDailyReminderCron] select error:", error.message);
    return;
  }

  const userIds = (rows ?? []).map((r) => r.user_id).filter(Boolean);
  let coinMap = new Map();
  if (userIds.length > 0) {
    const { data: coins, error: coinErr } = await supabaseAdmin
      .from("coins_and_attendance")
      .select("user_id, attendance_last_date")
      .in("user_id", userIds);

    if (coinErr) {
      console.error("[fcmDailyReminderCron] coins_and_attendance select error:", coinErr.message);
    } else {
      coinMap = new Map((coins ?? []).map((c) => [c.user_id, c.attendance_last_date]));
    }
  }

  const messaging = app.messaging();

  for (const row of rows ?? []) {
    const token = row.fcm_token;
    if (!token || typeof token !== "string") continue;

    const attendanceOn = notifEnabled(row.attendance_reminder_enabled);
    const collectionOn = notifEnabled(row.cigarette_collection_reminder_enabled);

    const lastDate = coinMap.get(row.user_id);
    const attendedToday = attendanceDatePrefix(lastDate) === todayYmd;

    try {
      if (matchesReminderNow(row.reminder_times_json, hour, minute)) {
        await sendFcm(
          messaging,
          token,
          "금연 리마인더 🌿",
          "오늘도 한 걸음! 금연을 이어가볼까요?",
          "daily_reminder_channel",
        );
      }

      if (collectionOn && minute === 0 && COLLECTION_HOURS.includes(hour)) {
        await sendFcm(
          messaging,
          token,
          "수집 가능 시간",
          "지금부터 20분간 도감 수집을 시도할 수 있어요.",
          "cigarette_collection_reminder_channel",
        );
      }

      if (attendanceOn && hour >= 18 && minute % 10 === 0 && !attendedToday) {
        await sendFcm(
          messaging,
          token,
          "금연뱅크 출석",
          "금연코인 획득을 위해 금연뱅크에 출석하셔야 합니다.",
          "attendance_reminder_channel",
        );
      }
    } catch (e) {
      console.error("[fcmDailyReminderCron] send failed user", row.user_id, e?.message ?? e);
    }
  }
}

export function startFcmDailyReminderCron() {
  if (!env.enableFcmReminderCron) {
    console.log("[fcmDailyReminderCron] disabled (ENABLE_FCM_REMINDER_CRON=false)");
    return;
  }
  if (!getFirebaseAdminApp()) {
    console.warn("[fcmDailyReminderCron] skipped: FIREBASE_SERVICE_ACCOUNT_JSON not set or invalid");
    return;
  }
  const intervalMs = Math.max(5000, env.fcmReminderCronIntervalMs);
  setInterval(() => {
    tickFcmDailyReminders().catch((e) =>
      console.error("[fcmDailyReminderCron] tick error:", e?.message ?? e),
    );
  }, intervalMs);
  console.log(`[fcmDailyReminderCron] started every ${intervalMs}ms`);
}
