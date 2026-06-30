import { supabaseAdmin } from "./supabaseAdmin.js";

export const QUIT_ROOM_IMAGES_BUCKET = "quit-room-images";
const BUCKET = QUIT_ROOM_IMAGES_BUCKET;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

export const QUIT_ROOM_IMAGE_RETENTION_DAYS = 90;
export const QUIT_ROOM_POST_RETENTION_DAYS = 365;
export const QUIT_ROOM_MAX_IMAGES_PER_ROOM_PER_MONTH = 300;
export const QUIT_ROOM_MAX_IMAGES_PER_USER_PER_DAY = 10;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Supabase 공개 URL → Storage 객체 경로 (예: roomId/userId/123.jpg)
 */
export function storagePathFromPublicUrl(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.trim()) return null;
  const url = imageUrl.trim();
  const publicMarker = `/object/public/${BUCKET}/`;
  const publicIdx = url.indexOf(publicMarker);
  if (publicIdx >= 0) {
    return url.slice(publicIdx + publicMarker.length).split("?")[0];
  }
  const shortMarker = `/${BUCKET}/`;
  const shortIdx = url.indexOf(shortMarker);
  if (shortIdx >= 0) {
    return url.slice(shortIdx + shortMarker.length).split("?")[0];
  }
  return null;
}

/** 단일 이미지 삭제 (없어도 무시) */
export async function deleteQuitRoomImageByUrl(imageUrl) {
  const path = storagePathFromPublicUrl(imageUrl);
  if (!path) return;
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error && !/not found/i.test(error.message ?? "")) {
    console.warn("[quitRoomImageStorage] delete failed:", path, error.message);
  }
}

/** 방 폴더(roomId/**) 아래 모든 이미지 삭제 */
export async function deleteAllQuitRoomImagesForRoom(roomId) {
  if (!roomId) return;

  const paths = [];
  const { data: userEntries, error: listErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .list(roomId, { limit: 1000 });
  if (listErr) {
    console.warn(
      "[quitRoomImageStorage] list room failed:",
      roomId,
      listErr.message,
    );
    return;
  }

  for (const entry of userEntries ?? []) {
    const userId = entry?.name;
    if (!userId) continue;
    const prefix = `${roomId}/${userId}`;
    const { data: files, error: fileErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(prefix, { limit: 1000 });
    if (fileErr) continue;
    for (const file of files ?? []) {
      if (file?.name) paths.push(`${prefix}/${file.name}`);
    }
  }

  if (paths.length === 0) return;
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove(paths);
  if (error) {
    console.warn(
      "[quitRoomImageStorage] bulk delete failed:",
      roomId,
      error.message,
    );
  }
}

/** 사용자가 올린 이미지 URL 기준 일괄 삭제 (계정 삭제 시) */
export async function deleteAllQuitRoomImagesForUser(userId) {
  if (!userId) return;
  const { data: posts, error } = await supabaseAdmin
    .from("quit_room_posts")
    .select("image_url")
    .eq("author_id", userId)
    .not("image_url", "is", null);
  if (error) throw error;
  for (const row of posts ?? []) {
    if (row.image_url) {
      await deleteQuitRoomImageByUrl(row.image_url);
    }
  }
}

export async function uploadQuitRoomImage({
  roomId,
  userId,
  base64,
  contentType,
}) {
  const raw = typeof base64 === "string" ? base64.trim() : "";
  if (!raw) {
    throw Object.assign(new Error("Empty image data"), { status: 400 });
  }

  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) {
    throw Object.assign(new Error("Invalid image data"), { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    throw Object.assign(new Error("Image too large (max 5MB)"), { status: 413 });
  }

  const detectedType = detectMimeFromBuffer(buffer);
  if (!detectedType) {
    throw Object.assign(
      new Error("Unsupported image format (jpeg, png, webp only)"),
      { status: 415 },
    );
  }

  const extMap = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const ext = extMap[detectedType] ?? "jpg";
  const path = `${roomId}/${userId}/${Date.now()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: detectedType,
      upsert: false,
      cacheControl: "3600",
    });
  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function detectMimeFromBuffer(buf) {
  if (buf.length < 4) return null;

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}
