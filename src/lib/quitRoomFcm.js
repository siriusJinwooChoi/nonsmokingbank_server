import { supabaseAdmin } from "./supabaseAdmin.js";
import { getFirebaseAdminApp } from "./firebaseAdmin.js";

function notificationText(postType, authorNickname, content) {
  const text = typeof content === "string" ? content.trim().replace(/\s+/g, " ") : "";
  const clipped = text.length > 80 ? `${text.slice(0, 77)}...` : text;

  switch (postType) {
    case "sos":
      return `${authorNickname}님이 지금 힘들어해요. 응원 한 마디 남겨 주세요 💪`;
    case "certify":
      return `${authorNickname}님이 오늘의 금연 인증을 남겼어요 🌱`;
    case "share":
      return `${authorNickname}님이 금연 기록을 공유했어요`;
    case "cheer":
      return clipped || `${authorNickname}님이 응원을 남겼어요`;
    case "mission":
      return `${authorNickname}님이 미션 기록을 남겼어요`;
    case "damta":
      return `${authorNickname}님이 담타 기록을 남겼어요`;
    default:
      return clipped || `${authorNickname}님이 새 메시지를 남겼어요`;
  }
}

/**
 * 금연방 게시물 작성 시 같은 방 멤버(작성자 제외)에게 FCM 전송
 */
export async function sendQuitRoomPostFcm({
  roomId,
  roomName,
  authorNickname,
  excludeUserId,
  postType,
  content,
}) {
  let messaging;
  try {
    messaging = getFirebaseAdminApp().messaging();
  } catch {
    return { sent: 0, skipped: "no_firebase" };
  }

  const { data: members, error: memErr } = await supabaseAdmin
    .from("quit_room_members")
    .select("user_id")
    .eq("room_id", roomId);
  if (memErr) throw memErr;

  const userIds = (members ?? [])
    .map((m) => m.user_id)
    .filter((id) => id && id !== excludeUserId);
  if (userIds.length === 0) return { sent: 0 };

  const { data: settings, error: setErr } = await supabaseAdmin
    .from("notification_settings")
    .select("user_id, fcm_token, quit_room_sos_enabled")
    .in("user_id", userIds);
  if (setErr) throw setErr;

  const isSos = postType === "sos";
  const title = isSos ? `${roomName} · SOS` : roomName;
  const body = notificationText(postType, authorNickname, content);

  let sent = 0;
  for (const row of settings ?? []) {
    if (isSos && row.quit_room_sos_enabled === false) continue;
    const token = row.fcm_token;
    if (!token || typeof token !== "string") continue;
    try {
      await messaging.send({
        token,
        notification: { title, body },
        data: {
          type: isSos ? "quit_room_sos" : "quit_room_post",
          room_id: roomId,
        },
        android: {
          priority: "high",
          notification: {
            sound: "default",
          },
        },
        apns: {
          payload: {
            aps: { sound: "default" },
          },
        },
      });
      sent += 1;
    } catch (e) {
      console.warn("[quitRoomFcm] send failed:", e?.message ?? e);
    }
  }
  return { sent };
}
