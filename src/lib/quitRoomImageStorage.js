import { supabaseAdmin } from "./supabaseAdmin.js";

const BUCKET = "quit-room-images";
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

// 허용할 MIME type 화이트리스트 (클라이언트 입력값 검증)
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * 금연방 게시물 이미지를 Supabase Storage에 업로드하고 공개 URL 반환
 * - contentType은 서버에서 직접 파일 매직 바이트로 재검증
 */
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

  // 파일 매직 바이트로 실제 이미지 타입 검증 (클라이언트 입력 무시)
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

/**
 * 파일 매직 바이트로 MIME 타입 감지 (화이트리스트 방식)
 * @param {Buffer} buf
 * @returns {string|null}
 */
function detectMimeFromBuffer(buf) {
  if (buf.length < 4) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  // WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
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
