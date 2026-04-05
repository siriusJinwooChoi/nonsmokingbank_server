import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { getFirebaseAdminApp } from "../lib/firebaseAdmin.js";
import { hourMinuteInSeoulNow } from "../lib/kstTime.js";
import { ymdInSeoulNow } from "../lib/kstDate.js";
import { env } from "../config/env.js";

/** 09/12/18/22 정각 담배 수집 알림 (로컬과 동일) */
const COLLECTION_HOURS = [9, 12, 18, 22];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INACTIVITY_THRESHOLD_MS = 3 * MS_PER_DAY;
const INACTIVITY_REPEAT_MS = MS_PER_DAY;

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

function reasonBody(text) {
  const t = text != null && String(text).trim() !== "" ? String(text).trim() : null;
  return t ?? "오늘도 금연을 이어가세요!";
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

export async function tickFcmDailyReminders() {
  if (!env.enableFcmReminderCron) return;
  const app = getFirebaseAdminApp();
  if (!app) return;

  const { hour, minute } = hourMinuteInSeoulNow();
  const tickKey = `${hour}:${minute}`;
  if (tickKey === _lastTickKey) return;
  _lastTickKey = tickKey;

  const todayYmd = ymdInSeoulNow();
  const nowMs = Date.now();

  const { data: rows, error } = await supabaseAdmin
    .from("notification_settings")
    .select(
      "user_id, reminder_times_json, fcm_token, attendance_reminder_enabled, cigarette_collection_reminder_enabled, " +
        "reason_notification_enabled, inactivity_notification_enabled, last_app_open_time_ms, " +
        "fcm_last_inactivity_sent_ms, fcm_last_reason_sent_ymd",
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

  let reasonMap = new Map();
  if (userIds.length > 0) {
    const { data: reasonRows, error: reasonErr } = await supabaseAdmin
      .from("reasons")
      .select("user_id, selected_reason_text")
      .in("user_id", userIds);

    if (reasonErr) {
      console.error("[fcmDailyReminderCron] reasons select error:", reasonErr.message);
    } else {
      reasonMap = new Map((reasonRows ?? []).map((r) => [r.user_id, r.selected_reason_text]));
    }
  }

  const messaging = app.messaging();

  for (const row of rows ?? []) {
    const token = row.fcm_token;
    if (!token || typeof token !== "string") continue;

    const attendanceOn = notifEnabled(row.attendance_reminder_enabled);
    const collectionOn = notifEnabled(row.cigarette_collection_reminder_enabled);
    const inactivityOn = notifEnabled(row.inactivity_notification_enabled);
    const reasonNotifOn = row.reason_notification_enabled === true;

    const lastDate = coinMap.get(row.user_id);
    const attendedToday = attendanceDatePrefix(lastDate) === todayYmd;

    if (matchesReminderNow(row.reminder_times_json, hour, minute)) {
      try {
        await sendFcm(
          messaging,
          token,
          "금연 리마인더 🌿",
          "오늘도 한 걸음! 금연을 이어가볼까요?",
          "daily_reminder_channel",
        );
      } catch (e) {
        console.error("[fcmDailyReminderCron] daily send failed user", row.user_id, e?.message ?? e);
      }
    }

    if (collectionOn && minute === 0 && COLLECTION_HOURS.includes(hour)) {
      try {
        await sendFcm(
          messaging,
          token,
          "수집 가능 시간",
          "지금부터 20분간 도감 수집을 시도할 수 있어요.",
          "cigarette_collection_reminder_channel",
        );
      } catch (e) {
        console.error("[fcmDailyReminderCron] collection send failed user", row.user_id, e?.message ?? e);
      }
    }

    // 18시 이후 미출석: 정각마다 1시간 간격 (KST 분==0)
    if (attendanceOn && hour >= 18 && minute === 0 && !attendedToday) {
      try {
        await sendFcm(
          messaging,
          token,
          "금연뱅크 출석",
          "금연코인 획득을 위해 금연뱅크에 출석하셔야 합니다.",
          "attendance_reminder_channel",
        );
      } catch (e) {
        console.error("[fcmDailyReminderCron] attendance send failed user", row.user_id, e?.message ?? e);
      }
    }

    if (reasonNotifOn && hour === 12 && minute === 1 && row.fcm_last_reason_sent_ymd !== todayYmd) {
      try {
        const body = reasonBody(reasonMap.get(row.user_id));
        await sendFcm(messaging, token, "🌿 금연할 이유", body, "reason_reminder_channel");
        const { error: upErr } = await supabaseAdmin
          .from("notification_settings")
          .update({ fcm_last_reason_sent_ymd: todayYmd })
          .eq("user_id", row.user_id);
        if (upErr) {
          console.error("[fcmDailyReminderCron] reason dedup update failed", row.user_id, upErr.message);
        }
      } catch (e) {
        console.error("[fcmDailyReminderCron] reason send failed user", row.user_id, e?.message ?? e);
      }
    }

    if (inactivityOn) {
      const lastOpen = row.last_app_open_time_ms;
      if (lastOpen != null && lastOpen > 0) {
        const inactiveMs = nowMs - Number(lastOpen);
        if (inactiveMs >= INACTIVITY_THRESHOLD_MS) {
          const lastSent = row.fcm_last_inactivity_sent_ms;
          const canSend =
            lastSent == null ||
            Number.isNaN(Number(lastSent)) ||
            nowMs - Number(lastSent) >= INACTIVITY_REPEAT_MS;

          if (canSend) {
            try {
              await sendFcm(
                messaging,
                token,
                "금연은 잘 하고 계신가요?",
                "앱에서 금연현황을 확인해보세요!",
                "inactivity_channel",
              );
              const { error: upErr } = await supabaseAdmin
                .from("notification_settings")
                .update({ fcm_last_inactivity_sent_ms: nowMs })
                .eq("user_id", row.user_id);
              if (upErr) {
                console.error(
                  "[fcmDailyReminderCron] inactivity dedup update failed",
                  row.user_id,
                  upErr.message,
                );
              }
            } catch (e) {
              console.error("[fcmDailyReminderCron] inactivity send failed user", row.user_id, e?.message ?? e);
            }
          }
        }
      }
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
