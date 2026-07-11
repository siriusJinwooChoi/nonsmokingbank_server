import { supabaseAdmin } from "./supabaseAdmin.js";
import { getFirebaseAdminApp } from "./firebaseAdmin.js";

/**
 * SOS 게시물 작성 시 동방 멤버(작성자 제외)에게 FCM 전송
 */
export async function sendQuitRoomSosFcm({
  roomId,
  roomName,
  authorNickname,
  excludeUserId,
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

  const title = `${roomName} · SOS`;
  const body = `${authorNickname}님이 지금 힘들어해요. 응원 한 마디 남겨 주세요 💪`;

  let sent = 0;
  for (const row of settings ?? []) {
    if (row.quit_room_sos_enabled === false) continue;
    const token = row.fcm_token;
    if (!token || typeof token !== "string") continue;
    try {
      await messaging.send({
        token,
        notification: { title, body },
        data: {
          type: "quit_room_sos",
          room_id: roomId,
        },
        android: {
          priority: "high",
          notification: {
            channelId: "quit_room_sos_channel",
            sound: "default",
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
