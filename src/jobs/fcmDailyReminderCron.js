import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { getFirebaseAdminApp } from "../lib/firebaseAdmin.js";
import { hourMinuteInSeoulNow } from "../lib/kstTime.js";
import { ymdInSeoulNow } from "../lib/kstDate.js";
import { env } from "../config/env.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INACTIVITY_THRESHOLD_MS = 3 * MS_PER_DAY;
const INACTIVITY_REPEAT_MS = MS_PER_DAY;

/** reminder_times_json 항목이 현재 KST 시·분과 일치하는지 */
function matchesReminderNow(reminderTimesJson, hour, minute) {
  if (!Array.isArray(reminderTimesJson)) return false;
  for (const item of reminderTimesJson) {
    if (!item || typeof item !== "object") continue;
    const h = item.h ?? item.hour;
    const m = item.m ?? item.minute ?? 0;
    if (h === undefined || h === null) continue;
    if (Number(h) === hour && Number(m) === minute) return true;
  }
  return false;
}

/** null/undefined → 켜짐 */
function notifEnabled(val) {
  return val !== false;
}

function reasonBody(text) {
  const t = text != null && String(text).trim() !== "" ? String(text).trim() : null;
  return t ?? "오늘도 금연을 이어가세요!";
}

/** 피크 시각 기준 3분 전 알림 시각 */
function patternNotifyHourMinuteFromPeak(peakHour, peakMinute) {
  let nh = Number(peakHour);
  let nm = Number(peakMinute) - 3;
  if (nm < 0) {
    nm += 60;
    nh -= 1;
  }
  if (nh < 0) nh += 24;
  return { hour: nh, minute: nm };
}

function patternReminderSlotsList(slotsJson) {
  if (!Array.isArray(slotsJson)) return [];
  const out = [];
  for (let i = 0; i < slotsJson.length; i++) {
    const item = slotsJson[i];
    if (!item || typeof item !== "object") continue;
    const h = item.h ?? item.hour;
    const m = item.m ?? item.minute ?? 0;
    if (h === undefined || h === null) continue;
    out.push({ slotIndex: i, peakHour: Number(h), peakMinute: Number(m) });
  }
  return out;
}

function displayNameForPattern(name) {
  const t = name != null ? String(name).trim() : "";
  return t !== "" ? t : "회원";
}

let _lastTickKey = "";

async function sendFcm(messaging, token, title, body, channelId) {
  await messaging.send({
    token,
    notification: { title, body },
    android: {
      priority: "high",
      notification: { channelId, sound: "default" },
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

  // 알림 설정 조회 (신규 스키마: calendar_reminder_enabled)
  const { data: rows, error } = await supabaseAdmin
    .from("notification_settings")
    .select(
      "user_id, reminder_times_json, fcm_token, calendar_reminder_enabled, " +
        "reason_notification_enabled, inactivity_notification_enabled, last_app_open_time_ms, " +
        "fcm_last_inactivity_sent_ms, fcm_last_reason_sent_ymd, pattern_reminder_enabled, " +
        "pattern_reminder_slots_json, fcm_pattern_last_sent_ymd_by_slot",
    )
    .not("fcm_token", "is", null);

  if (error) {
    console.error("[fcmDailyReminderCron] select error:", error.message);
    return;
  }

  const userIds = (rows ?? []).map((r) => r.user_id).filter(Boolean);

  // quit_calendar에서 오늘 기록이 있는 사용자 집합
  let calendarRecordedSet = new Set();
  if (userIds.length > 0) {
    const { data: calData, error: calErr } = await supabaseAdmin
      .from("quit_calendar")
      .select("user_id")
      .in("user_id", userIds)
      .eq("record_date", todayYmd);
    if (calErr) {
      console.error("[fcmDailyReminderCron] quit_calendar select error:", calErr.message);
    } else {
      calendarRecordedSet = new Set((calData ?? []).map((r) => r.user_id));
    }
  }

  // 금연 이유 조회
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

  // 닉네임 조회
  let displayNameMap = new Map();
  if (userIds.length > 0) {
    const { data: profRows, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    if (profErr) {
      console.error("[fcmDailyReminderCron] profiles select error:", profErr.message);
    } else {
      displayNameMap = new Map((profRows ?? []).map((p) => [p.id, p.display_name]));
    }
  }

  const messaging = app.messaging();

  for (const row of rows ?? []) {
    const token = row.fcm_token;
    if (!token || typeof token !== "string") continue;

    const calendarOn = notifEnabled(row.calendar_reminder_enabled);
    const inactivityOn = notifEnabled(row.inactivity_notification_enabled);
    const reasonNotifOn = row.reason_notification_enabled === true;
    const patternOn = notifEnabled(row.pattern_reminder_enabled);

    const recordedToday = calendarRecordedSet.has(row.user_id);

    // 사용자가 설정한 시각에 금연 리마인더
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

    // 흡연 패턴 미리 알림: 피크 시각 3분 전, 슬롯별 일 1회
    if (patternOn) {
      const slots = patternReminderSlotsList(row.pattern_reminder_slots_json);
      for (const slot of slots) {
        const { hour: nh, minute: nm } = patternNotifyHourMinuteFromPeak(
          slot.peakHour,
          slot.peakMinute,
        );
        if (nh !== hour || nm !== minute) continue;

        const dedup = row.fcm_pattern_last_sent_ymd_by_slot;
        const dedupObj =
          dedup && typeof dedup === "object" && !Array.isArray(dedup)
            ? dedup
            : {};
        const key = String(slot.slotIndex);
        if (dedupObj[key] === todayYmd) continue;

        const nick = displayNameForPattern(displayNameMap.get(row.user_id));
        try {
          await sendFcm(
            messaging,
            token,
            "흡연 패턴 미리 알림",
            `${nick}님은 이 시간대에 담배를 피고 싶어하세요. 참아보세요!`,
            "smoking_pattern_channel",
          );
          const nextDedup = { ...dedupObj, [key]: todayYmd };
          const { error: patUpErr } = await supabaseAdmin
            .from("notification_settings")
            .update({ fcm_pattern_last_sent_ymd_by_slot: nextDedup })
            .eq("user_id", row.user_id);
          if (patUpErr) {
            console.error("[fcmDailyReminderCron] pattern dedup update failed", row.user_id, patUpErr.message);
          } else {
            row.fcm_pattern_last_sent_ymd_by_slot = nextDedup;
          }
        } catch (e) {
          console.error("[fcmDailyReminderCron] pattern send failed user", row.user_id, e?.message ?? e);
        }
      }
    }

    // 18시 이후 금연 캘린더 미기록 시 매 정각 알림
    if (calendarOn && hour >= 18 && minute === 0 && !recordedToday) {
      try {
        await sendFcm(
          messaging,
          token,
          "오늘의 금연 기록",
          "아직 오늘의 금연 기록이 없어요. 잠깐 앱을 열어 기록해보세요! 🌿",
          "calendar_reminder_channel",
        );
      } catch (e) {
        console.error("[fcmDailyReminderCron] calendar send failed user", row.user_id, e?.message ?? e);
      }
    }

    // 매일 12:01 금연 이유 알림
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

    // 3일 이상 앱 미사용 시 비활성 알림 (일 1회)
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
