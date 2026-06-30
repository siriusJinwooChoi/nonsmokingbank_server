import { Router } from "express";
import crypto from "crypto";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { uploadQuitRoomImage, deleteQuitRoomImageByUrl } from "../lib/quitRoomImageStorage.js";
import {
  assertQuitRoomImageUploadAllowed,
  deleteQuitRoomCompletely,
} from "../lib/quitRoomRetention.js";

const router = Router();

function generateInviteCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase(); // 6자리 HEX
}

/** DB row → 앱 API 응답 형식으로 변환 */
function toRoomResponse(room, { memberCount, myNickname, myRole } = {}) {
  return {
    id: room.id,
    name: room.name,
    room_type: room.type,
    invite_code: room.invite_code,
    owner_id: room.creator_id,
    member_count: memberCount ?? 1,
    max_members: room.max_members ?? 10,
    created_at: room.created_at,
    my_nickname: myNickname ?? null,
    my_role: myRole ?? null,
    is_admin: myRole === "owner",
  };
}

/** 방의 멤버 수가 0이면 방과 모든 게시물·이미지를 삭제 */
async function deleteRoomIfEmpty(roomId) {
  const count = await countMembers(roomId);
  if (count === 0) {
    await deleteQuitRoomCompletely(roomId);
  }
}

async function countMembers(roomId) {
  const { count, error } = await supabaseAdmin
    .from("quit_room_members")
    .select("*", { count: "exact", head: true })
    .eq("room_id", roomId);
  if (error) throw error;
  return count ?? 0;
}

async function countMembersByRoomIds(roomIds) {
  if (!roomIds.length) return {};
  const { data, error } = await supabaseAdmin
    .from("quit_room_members")
    .select("room_id")
    .in("room_id", roomIds);
  if (error) throw error;
  const map = {};
  for (const row of data ?? []) {
    map[row.room_id] = (map[row.room_id] ?? 0) + 1;
  }
  return map;
}

/**
 * GET /v1/quit-rooms
 * 내가 속한 금연방 목록
 */
router.get("/", async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { data: memberships, error: memErr } = await supabaseAdmin
      .from("quit_room_members")
      .select("room_id, nickname, role, joined_at")
      .eq("user_id", userId);
    if (memErr) throw memErr;

    if (!memberships || memberships.length === 0) {
      return res.status(200).json({ ok: true, rooms: [] });
    }

    const roomIds = memberships.map((m) => m.room_id);
    const { data: rooms, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .select("id, name, type, invite_code, creator_id, max_members, created_at")
      .in("id", roomIds);
    if (roomErr) throw roomErr;

    const memberCounts = await countMembersByRoomIds(roomIds);
    const memMap = Object.fromEntries(
      memberships.map((m) => [m.room_id, m]),
    );
    const result = (rooms ?? []).map((room) =>
      toRoomResponse(room, {
        memberCount: memberCounts[room.id] ?? 0,
        myNickname: memMap[room.id]?.nickname ?? null,
        myRole: memMap[room.id]?.role ?? "member",
      }),
    );

    return res.status(200).json({ ok: true, rooms: result });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /v1/quit-rooms
 * body: { name, room_type?: "solo"|"group", nickname? }
 * 금연방 생성 및 오너로 자동 입장
 */
router.post("/", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const name =
      typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const roomType =
      req.body?.room_type === "solo" ? "solo" : "group";
    const nickname =
      typeof req.body?.nickname === "string"
        ? req.body.nickname.trim().slice(0, 20)
        : "나";

    if (!name) {
      return res
        .status(400)
        .json({ error: "BAD_REQUEST", message: "name is required" });
    }
    if (name.length > 30) {
      return res
        .status(400)
        .json({ error: "BAD_REQUEST", message: "name must be <= 30 chars" });
    }

    const inviteCode = roomType === "group" ? generateInviteCode() : null;

    const { data: room, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .insert({
        creator_id: userId,
        name,
        type: roomType,
        invite_code: inviteCode,
      })
      .select("id, name, type, invite_code, creator_id, max_members, created_at")
      .single();
    if (roomErr) throw roomErr;

    const { error: memErr } = await supabaseAdmin
      .from("quit_room_members")
      .insert({
        room_id: room.id,
        user_id: userId,
        nickname,
        role: "owner",
      });
    if (memErr) throw memErr;

    return res.status(201).json({
      ok: true,
      room: toRoomResponse(room, {
        memberCount: 1,
        myNickname: nickname,
        myRole: "owner",
      }),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /v1/quit-rooms/join
 * body: { invite_code, nickname? }
 * 초대 코드로 그룹 방 입장
 */
router.post("/join", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const inviteCode =
      typeof req.body?.invite_code === "string"
        ? req.body.invite_code.trim().toUpperCase()
        : "";
    const nickname =
      typeof req.body?.nickname === "string"
        ? req.body.nickname.trim().slice(0, 20)
        : "나";

    if (!inviteCode) {
      return res
        .status(400)
        .json({ error: "BAD_REQUEST", message: "invite_code is required" });
    }

    const { data: room, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .select("id, name, type, invite_code, creator_id, max_members, created_at")
      .eq("invite_code", inviteCode)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Room not found" });
    }
    if (room.type === "solo") {
      return res
        .status(400)
        .json({ error: "BAD_REQUEST", message: "Cannot join a solo room" });
    }

    const memberCount = await countMembers(room.id);
    const maxMembers = room.max_members ?? 10;
    if (memberCount >= maxMembers) {
      return res
        .status(409)
        .json({ error: "ROOM_FULL", message: "Room is full (max 10 members)" });
    }

    const { error: memErr } = await supabaseAdmin
      .from("quit_room_members")
      .insert({
        room_id: room.id,
        user_id: userId,
        nickname,
        role: "member",
      });
    if (memErr) {
      if (memErr.code === "23505") {
        return res
          .status(409)
          .json({ error: "ALREADY_MEMBER", message: "Already a member" });
      }
      throw memErr;
    }

    return res.status(200).json({
      ok: true,
      room: toRoomResponse(room, {
        memberCount: memberCount + 1,
        myNickname: nickname,
        myRole: "member",
      }),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/quit-rooms/:roomId/members
 * 방 멤버 전체 목록 조회 (멤버만 접근 가능)
 */
router.get("/:roomId/members", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    // 해당 방의 멤버인지 확인
    const { data: myMembership } = await supabaseAdmin
      .from("quit_room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!myMembership) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    // 방의 creator_id 조회 (is_admin 판별용)
    const { data: room, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .select("creator_id")
      .eq("id", roomId)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }

    // 전체 멤버 목록
    const { data: members, error: memErr } = await supabaseAdmin
      .from("quit_room_members")
      .select("user_id, nickname, role, joined_at")
      .eq("room_id", roomId)
      .order("joined_at", { ascending: true });
    if (memErr) throw memErr;

    const result = (members ?? []).map((m) => ({
      nickname: m.nickname,
      role: m.role,
      is_admin: m.role === "owner" || m.user_id === room.creator_id,
      joined_at: m.joined_at,
    }));

    return res.status(200).json({ ok: true, members: result });
  } catch (err) {
    return next(err);
  }
});

/**
 * DELETE /v1/quit-rooms/:roomId
 * 방 전체 삭제 (관리자/오너 전용) — 모든 멤버 강제 퇴장 + 게시물 삭제
 */
router.delete("/:roomId", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    // 방 존재 여부 및 creator 확인
    const { data: room, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .select("id, creator_id")
      .eq("id", roomId)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }

    // 관리자(creator)만 삭제 가능
    if (room.creator_id !== userId) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Only the room admin can delete the room" });
    }

    await deleteQuitRoomCompletely(roomId);

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/**
 * DELETE /v1/quit-rooms/:roomId/leave
 * 방 나가기 — 마지막 멤버가 나가면 방 자동 삭제
 */
router.delete("/:roomId/leave", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const { data: room, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .select("id, creator_id")
      .eq("id", roomId)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }

    // 오너가 나가는 경우: 방 전체 삭제 (기존 동작 유지)
    if (room.creator_id === userId) {
      await deleteQuitRoomCompletely(roomId);
      return res.status(200).json({ ok: true, deleted_room: true });
    }

    // 일반 멤버가 나가는 경우
    const { error: leaveErr } = await supabaseAdmin
      .from("quit_room_members")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", userId);
    if (leaveErr) throw leaveErr;

    // 나간 후 남은 멤버가 0명이면 방 자동 삭제
    await deleteRoomIfEmpty(roomId);

    return res.status(200).json({ ok: true, deleted_room: false });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/quit-rooms/:roomId/posts?limit=50
 * 방 피드 조회 (멤버 전용)
 */
router.get("/:roomId/posts", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const { data: mem } = await supabaseAdmin
      .from("quit_room_members")
      .select("room_id")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!mem) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit ?? "50", 10)),
    );

    const { data, error } = await supabaseAdmin
      .from("quit_room_posts")
      .select("id, author_id, author_nickname, content, image_url, is_sos_alert, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw error;

    const posts = (data ?? []).map((post) => ({
      ...post,
      post_type: post.is_sos_alert ? "sos" : "text",
    }));

    return res.status(200).json({ ok: true, posts });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /v1/quit-rooms/:roomId/posts
 * body: { content?, image_url?, image_base64?, image_content_type?, post_type?: "text"|"share"|"sos" }
 */
router.post("/:roomId/posts", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const { data: mem } = await supabaseAdmin
      .from("quit_room_members")
      .select("nickname")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!mem) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const content =
      typeof req.body?.content === "string"
        ? req.body.content.trim().slice(0, 1000)
        : "";
    let imageUrl =
      typeof req.body?.image_url === "string"
        ? req.body.image_url.trim()
        : null;
    const postType = ["text", "share", "sos"].includes(req.body?.post_type)
      ? req.body.post_type
      : "text";

    // base64 이미지 → Supabase Storage 업로드 후 URL 저장
    if (!imageUrl && req.body?.image_base64) {
      try {
        await assertQuitRoomImageUploadAllowed(roomId, userId);
      } catch (limitErr) {
        const status = limitErr.status ?? 429;
        return res.status(status).json({
          error: limitErr.code ?? "IMAGE_UPLOAD_LIMIT",
          message: limitErr.message ?? "Image upload limit exceeded",
        });
      }
      const contentType =
        typeof req.body?.image_content_type === "string"
          ? req.body.image_content_type.trim()
          : "image/jpeg";
      try {
        imageUrl = await uploadQuitRoomImage({
          roomId,
          userId,
          base64: req.body.image_base64,
          contentType,
        });
      } catch (uploadErr) {
        const status = uploadErr.status ?? 500;
        return res.status(status).json({
          error: "UPLOAD_FAILED",
          message: uploadErr.message ?? "Image upload failed",
        });
      }
    }

    if (!content && !imageUrl) {
      return res
        .status(400)
        .json({ error: "BAD_REQUEST", message: "content or image required" });
    }

    const { data: post, error } = await supabaseAdmin
      .from("quit_room_posts")
      .insert({
        room_id: roomId,
        author_id: userId,
        author_nickname: mem.nickname,
        content: content || (imageUrl ? "📷 사진을 공유했어요" : ""),
        image_url: imageUrl,
        is_sos_alert: postType === "sos",
      })
      .select("id, author_id, author_nickname, content, image_url, is_sos_alert, created_at")
      .single();
    if (error) throw error;

    return res.status(201).json({
      ok: true,
      post: {
        ...post,
        post_type: post.is_sos_alert ? "sos" : postType,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * DELETE /v1/quit-rooms/:roomId/posts/:postId
 * 본인 게시글 삭제
 */
router.delete("/:roomId/posts/:postId", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId, postId } = req.params;

    const { data: post, error: fetchErr } = await supabaseAdmin
      .from("quit_room_posts")
      .select("id, author_id, room_id, image_url")
      .eq("id", postId)
      .eq("room_id", roomId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!post) return res.status(404).json({ error: "NOT_FOUND" });
    if (post.author_id !== userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    if (post.image_url) {
      await deleteQuitRoomImageByUrl(post.image_url);
    }

    const { error } = await supabaseAdmin
      .from("quit_room_posts")
      .delete()
      .eq("id", postId);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /v1/quit-rooms/:roomId/posts/:postId/reactions
 * body: { emoji }
 */
router.post("/:roomId/posts/:postId/reactions", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId, postId } = req.params;

    const { data: mem } = await supabaseAdmin
      .from("quit_room_members")
      .select("room_id")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!mem) return res.status(403).json({ error: "FORBIDDEN" });

    const emoji =
      typeof req.body?.emoji === "string" ? req.body.emoji.trim() : "";
    if (!emoji) {
      return res
        .status(400)
        .json({ error: "BAD_REQUEST", message: "emoji required" });
    }

    const { error } = await supabaseAdmin.from("quit_room_reactions").upsert(
      { post_id: postId, user_id: userId, emoji },
      { onConflict: "post_id,user_id,emoji" },
    );
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
