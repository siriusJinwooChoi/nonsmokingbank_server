import { supabaseAdmin } from "./supabaseAdmin.js";
import {
  QUIT_ROOM_IMAGE_RETENTION_DAYS,
  QUIT_ROOM_MAX_IMAGES_PER_ROOM_PER_MONTH,
  QUIT_ROOM_MAX_IMAGES_PER_USER_PER_DAY,
  QUIT_ROOM_POST_RETENTION_DAYS,
  deleteAllQuitRoomImagesForRoom,
  deleteQuitRoomImageByUrl,
  storagePathFromPublicUrl,
} from "./quitRoomImageStorage.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function cutoffIso(days) {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

/** 이미지 업로드 상한 검사 */
export async function assertQuitRoomImageUploadAllowed(roomId, userId) {
  const dayAgo = cutoffIso(1);
  const monthAgo = cutoffIso(30);

  const { count: userDayCount, error: userErr } = await supabaseAdmin
    .from("quit_room_posts")
    .select("*", { count: "exact", head: true })
    .eq("author_id", userId)
    .not("image_url", "is", null)
    .gte("created_at", dayAgo);
  if (userErr) throw userErr;
  if ((userDayCount ?? 0) >= QUIT_ROOM_MAX_IMAGES_PER_USER_PER_DAY) {
    const err = new Error(
      `Daily image upload limit (${QUIT_ROOM_MAX_IMAGES_PER_USER_PER_DAY}/day) exceeded`,
    );
    err.status = 429;
    err.code = "IMAGE_UPLOAD_LIMIT_USER_DAY";
    throw err;
  }

  const { count: roomMonthCount, error: roomErr } = await supabaseAdmin
    .from("quit_room_posts")
    .select("*", { count: "exact", head: true })
    .eq("room_id", roomId)
    .not("image_url", "is", null)
    .gte("created_at", monthAgo);
  if (roomErr) throw roomErr;
  if ((roomMonthCount ?? 0) >= QUIT_ROOM_MAX_IMAGES_PER_ROOM_PER_MONTH) {
    const err = new Error(
      `Room monthly image limit (${QUIT_ROOM_MAX_IMAGES_PER_ROOM_PER_MONTH}/month) exceeded`,
    );
    err.status = 429;
    err.code = "IMAGE_UPLOAD_LIMIT_ROOM_MONTH";
    throw err;
  }
}

async function deleteReactionsForRoom(roomId) {
  const { data: posts, error: postErr } = await supabaseAdmin
    .from("quit_room_posts")
    .select("id")
    .eq("room_id", roomId);
  if (postErr) throw postErr;
  const ids = (posts ?? []).map((p) => p.id).filter(Boolean);
  if (ids.length === 0) return;
  const { error } = await supabaseAdmin
    .from("quit_room_reactions")
    .delete()
    .in("post_id", ids);
  if (error) throw error;
}

/** 방 완전 삭제 — Storage + DB */
export async function deleteQuitRoomCompletely(roomId) {
  await deleteAllQuitRoomImagesForRoom(roomId);
  await deleteReactionsForRoom(roomId);
  const { error: postsErr } = await supabaseAdmin
    .from("quit_room_posts")
    .delete()
    .eq("room_id", roomId);
  if (postsErr) throw postsErr;
  const { error: membersErr } = await supabaseAdmin
    .from("quit_room_members")
    .delete()
    .eq("room_id", roomId);
  if (membersErr) throw membersErr;
  const { error: roomErr } = await supabaseAdmin
    .from("quit_rooms")
    .delete()
    .eq("id", roomId);
  if (roomErr) throw roomErr;
}

/** 90일 지난 이미지: Storage 삭제 + image_url NULL (글은 유지) */
export async function expireQuitRoomImagesOlderThanRetention() {
  const cutoff = cutoffIso(QUIT_ROOM_IMAGE_RETENTION_DAYS);
  const { data: rows, error } = await supabaseAdmin
    .from("quit_room_posts")
    .select("id, image_url")
    .not("image_url", "is", null)
    .lt("created_at", cutoff)
    .limit(500);
  if (error) throw error;

  let expired = 0;
  for (const row of rows ?? []) {
    if (row.image_url) {
      await deleteQuitRoomImageByUrl(row.image_url);
    }
    const { error: upErr } = await supabaseAdmin
      .from("quit_room_posts")
      .update({ image_url: null })
      .eq("id", row.id);
    if (upErr) {
      console.warn(
        "[quitRoomRetention] image_url clear failed:",
        row.id,
        upErr.message,
      );
      continue;
    }
    expired += 1;
  }
  return { expired };
}

/** 365일 지난 게시글 전체 삭제 */
export async function deleteQuitRoomPostsOlderThanRetention() {
  const cutoff = cutoffIso(QUIT_ROOM_POST_RETENTION_DAYS);
  const { data: rows, error } = await supabaseAdmin
    .from("quit_room_posts")
    .select("id, image_url")
    .lt("created_at", cutoff)
    .limit(500);
  if (error) throw error;

  const ids = (rows ?? []).map((r) => r.id);
  if (ids.length === 0) return { deleted: 0 };

  for (const row of rows ?? []) {
    if (row.image_url) {
      await deleteQuitRoomImageByUrl(row.image_url);
    }
  }

  await supabaseAdmin.from("quit_room_reactions").delete().in("post_id", ids);
  const { error: delErr } = await supabaseAdmin
    .from("quit_room_posts")
    .delete()
    .in("id", ids);
  if (delErr) throw delErr;
  return { deleted: ids.length };
}

/** 방별 Storage 고아 파일 정리 (DB image_url에 없는 파일) */
export async function cleanupOrphanQuitRoomImagesForRoom(roomId) {
  const { data: posts, error: postErr } = await supabaseAdmin
    .from("quit_room_posts")
    .select("image_url")
    .eq("room_id", roomId)
    .not("image_url", "is", null);
  if (postErr) throw postErr;

  const validPaths = new Set(
    (posts ?? [])
      .map((p) => storagePathFromPublicUrl(p.image_url))
      .filter(Boolean),
  );

  const orphanPaths = [];
  const { data: userEntries } = await supabaseAdmin.storage
    .from("quit-room-images")
    .list(roomId, { limit: 1000 });

  for (const entry of userEntries ?? []) {
    const userId = entry?.name;
    if (!userId) continue;
    const prefix = `${roomId}/${userId}`;
    const { data: files } = await supabaseAdmin.storage
      .from("quit-room-images")
      .list(prefix, { limit: 1000 });
    for (const file of files ?? []) {
      if (!file?.name) continue;
      const path = `${prefix}/${file.name}`;
      if (!validPaths.has(path)) orphanPaths.push(path);
    }
  }

  if (orphanPaths.length === 0) return 0;
  const { error } = await supabaseAdmin.storage
    .from("quit-room-images")
    .remove(orphanPaths);
  if (error) {
    console.warn(
      "[quitRoomRetention] orphan cleanup failed:",
      roomId,
      error.message,
    );
    return 0;
  }
  return orphanPaths.length;
}

export async function cleanupOrphanQuitRoomImagesAllRooms() {
  const { data: rooms, error } = await supabaseAdmin
    .from("quit_rooms")
    .select("id");
  if (error) throw error;

  let removed = 0;
  for (const room of rooms ?? []) {
    removed += await cleanupOrphanQuitRoomImagesForRoom(room.id);
  }
  return { removed };
}

export async function runQuitRoomRetentionDailyBatch() {
  const imageResult = await expireQuitRoomImagesOlderThanRetention();
  const postResult = await deleteQuitRoomPostsOlderThanRetention();
  return {
    imagesExpired: imageResult.expired,
    postsDeleted: postResult.deleted,
  };
}
