import { supabaseAdmin } from "./supabaseAdmin.js";

const BUCKET = "quit-room-images";
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * 금연방 게시물 이미지를 Supabase Storage에 업로드하고 공개 URL 반환
 */
export async function uploadQuitRoomImage({
  roomId,
  userId,
  base64,
  contentType = "image/jpeg",
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

  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  const path = `${roomId}/${userId}/${Date.now()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: false,
      cacheControl: "3600",
    });
  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
