import { Router } from "express";
import crypto from "crypto";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { uploadQuitRoomImage, deleteQuitRoomImageByUrl } from "../lib/quitRoomImageStorage.js";
import {
  assertQuitRoomImageUploadAllowed,
  deleteQuitRoomCompletely,
} from "../lib/quitRoomRetention.js";
import {
  CERTIFY_DAILY_LIMIT,
  VALID_POST_TYPES,
  computeQuitDaysFromStartMs,
  formatPostRow,
  isoWeekKeyInSeoul,
  todayKstBoundsIso,
  toRoomResponseExtended,
  weekRangeInSeoul,
  ymdInSeoul,
} from "../lib/quitRoomHelpers.js";
import { sendQuitRoomPostFcm } from "../lib/quitRoomFcm.js";

const router = Router();

const ROOM_SELECT =
  "id, name, type, invite_code, creator_id, max_members, created_at, goal_type, goal_days, goal_end_date, pledge_text, challenge_started_at";

const POST_SELECT =
  "id, room_id, author_id, author_nickname, content, image_url, is_sos_alert, post_type, metadata, author_system, created_at";

function generateInviteCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
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

async function assertMembership(roomId, userId) {
  const { data, error } = await supabaseAdmin
    .from("quit_room_members")
    .select("nickname, role")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchReactionsForPosts(postIds) {
  if (!postIds.length) return {};
  const { data, error } = await supabaseAdmin
    .from("quit_room_reactions")
    .select("post_id, emoji")
    .in("post_id", postIds);
  if (error) throw error;
  const map = {};
  for (const row of data ?? []) {
    if (!map[row.post_id]) map[row.post_id] = [];
    map[row.post_id].push({ emoji: row.emoji, count: 1 });
  }
  // merge same emoji counts
  const merged = {};
  for (const [postId, items] of Object.entries(map)) {
    const counts = {};
    for (const { emoji } of items) {
      counts[emoji] = (counts[emoji] ?? 0) + 1;
    }
    merged[postId] = Object.entries(counts).map(([emoji, count]) => ({
      emoji,
      count,
    }));
  }
  return merged;
}

async function deleteRoomIfEmpty(roomId) {
  const count = await countMembers(roomId);
  if (count === 0) {
    await deleteQuitRoomCompletely(roomId);
  }
}

async function fetchQuitProfiles(userIds) {
  if (!userIds.length) return {};
  const { data, error } = await supabaseAdmin
    .from("quit_profile")
    .select("user_id, start_time_ms, quit_mode")
    .in("user_id", userIds);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.user_id, r]));
}

async function countTodayCertifyByUser(roomId, userId) {
  const { startIso, endIso } = todayKstBoundsIso();
  const { count, error } = await supabaseAdmin
    .from("quit_room_posts")
    .select("*", { count: "exact", head: true })
    .eq("room_id", roomId)
    .eq("author_id", userId)
    .eq("post_type", "certify")
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (error) throw error;
  return count ?? 0;
}

async function computeChallengeProgress(room, memberCount) {
  if (!room || room.goal_type === "none") {
    return { progress_days: 0, target_days: null, percent: 0 };
  }

  let targetDays = room.goal_days;
  if (room.goal_type === "date" && room.goal_end_date && room.challenge_started_at) {
    const start = new Date(room.challenge_started_at);
    const end = new Date(`${room.goal_end_date}T00:00:00+09:00`);
    targetDays = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)),
    );
  }
  if (!targetDays) {
    return { progress_days: 0, target_days: null, percent: 0 };
  }

  const { data: posts, error } = await supabaseAdmin
    .from("quit_room_posts")
    .select("created_at")
    .eq("room_id", room.id)
    .eq("post_type", "certify")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const certifiedDays = new Set();
  for (const p of posts ?? []) {
    certifiedDays.add(ymdInSeoul(new Date(p.created_at)));
  }
  const progressDays = certifiedDays.size;
  const percent = Math.min(100, Math.round((progressDays / targetDays) * 100));
  return {
    progress_days: progressDays,
    target_days: targetDays,
    percent,
    member_count: memberCount,
  };
}

/** GET /v1/quit-rooms */
router.get("/", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data: memberships, error: memErr } = await supabaseAdmin
      .from("quit_room_members")
      .select("room_id, nickname, role, joined_at")
      .eq("user_id", userId);
    if (memErr) throw memErr;

    if (!memberships?.length) {
      return res.status(200).json({ ok: true, rooms: [] });
    }

    const roomIds = memberships.map((m) => m.room_id);
    const { data: rooms, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .select(ROOM_SELECT)
      .in("id", roomIds);
    if (roomErr) throw roomErr;

    const memberCounts = await countMembersByRoomIds(roomIds);
    const memMap = Object.fromEntries(memberships.map((m) => [m.room_id, m]));

    const result = (rooms ?? []).map((room) =>
      toRoomResponseExtended(room, {
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

/** POST /v1/quit-rooms */
router.post("/", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const name =
      typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const roomType = req.body?.room_type === "solo" ? "solo" : "group";
    const nickname =
      typeof req.body?.nickname === "string"
        ? req.body.nickname.trim().slice(0, 20)
        : "나";

    const goalType = ["none", "days", "date"].includes(req.body?.goal_type)
      ? req.body.goal_type
      : "none";
    const goalDays =
      goalType === "days" && Number.isFinite(Number(req.body?.goal_days))
        ? Math.min(365, Math.max(1, Number(req.body.goal_days)))
        : null;
    const goalEndDate =
      goalType === "date" && typeof req.body?.goal_end_date === "string"
        ? req.body.goal_end_date.trim().slice(0, 10)
        : null;
    const pledgeText =
      typeof req.body?.pledge_text === "string"
        ? req.body.pledge_text.trim().slice(0, 100)
        : null;

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
    const hasChallenge = goalType !== "none";

    const { data: room, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .insert({
        creator_id: userId,
        name,
        type: roomType,
        invite_code: inviteCode,
        goal_type: roomType === "group" ? goalType : "none",
        goal_days: roomType === "group" ? goalDays : null,
        goal_end_date: roomType === "group" ? goalEndDate : null,
        pledge_text: pledgeText || null,
        challenge_started_at: hasChallenge && roomType === "group" ? new Date().toISOString() : null,
      })
      .select(ROOM_SELECT)
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
      room: toRoomResponseExtended(room, {
        memberCount: 1,
        myNickname: nickname,
        myRole: "owner",
      }),
    });
  } catch (err) {
    return next(err);
  }
});

/** POST /v1/quit-rooms/join */
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
      .select(ROOM_SELECT)
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
    if (memberCount >= (room.max_members ?? 10)) {
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
      room: toRoomResponseExtended(room, {
        memberCount: memberCount + 1,
        myNickname: nickname,
        myRole: "member",
      }),
    });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /v1/quit-rooms/:roomId — 목표·서약 수정 (방장) */
router.patch("/:roomId", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const { data: room, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .select(ROOM_SELECT)
      .eq("id", roomId)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) return res.status(404).json({ error: "NOT_FOUND" });
    if (room.creator_id !== userId) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Only owner can update" });
    }

    const patch = {};
    if (["none", "days", "date"].includes(req.body?.goal_type)) {
      patch.goal_type = req.body.goal_type;
      if (req.body.goal_type === "none") {
        patch.goal_days = null;
        patch.goal_end_date = null;
        patch.challenge_started_at = null;
      } else if (!room.challenge_started_at) {
        patch.challenge_started_at = new Date().toISOString();
      }
    }
    if (req.body?.goal_days != null && patch.goal_type !== "none") {
      patch.goal_days = Math.min(365, Math.max(1, Number(req.body.goal_days)));
    }
    if (typeof req.body?.goal_end_date === "string") {
      patch.goal_end_date = req.body.goal_end_date.trim().slice(0, 10);
    }
    if (typeof req.body?.pledge_text === "string") {
      patch.pledge_text = req.body.pledge_text.trim().slice(0, 100) || null;
    }

    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "No fields to update" });
    }

    const { data: updated, error } = await supabaseAdmin
      .from("quit_rooms")
      .update(patch)
      .eq("id", roomId)
      .select(ROOM_SELECT)
      .single();
    if (error) throw error;

    const memberCount = await countMembers(roomId);
    const mem = await assertMembership(roomId, userId);

    return res.status(200).json({
      ok: true,
      room: toRoomResponseExtended(updated, {
        memberCount,
        myNickname: mem?.nickname,
        myRole: mem?.role,
      }),
    });
  } catch (err) {
    return next(err);
  }
});

/** GET /v1/quit-rooms/:roomId/stats */
router.get("/:roomId/stats", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const mem = await assertMembership(roomId, userId);
    if (!mem) return res.status(403).json({ error: "FORBIDDEN" });

    const { data: room, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .select(ROOM_SELECT)
      .eq("id", roomId)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) return res.status(404).json({ error: "NOT_FOUND" });

    const memberCount = await countMembers(roomId);
    const { startIso, endIso, ymd } = todayKstBoundsIso();

    const { data: todayPosts, error: tpErr } = await supabaseAdmin
      .from("quit_room_posts")
      .select("author_id, post_type, metadata")
      .eq("room_id", roomId)
      .gte("created_at", startIso)
      .lt("created_at", endIso);
    if (tpErr) throw tpErr;

    const certifyAuthors = new Set();
    let totalSaved = 0;
    let sosToday = 0;
    for (const p of todayPosts ?? []) {
      if (p.post_type === "certify" || p.post_type === "share") {
        if (p.author_id) certifyAuthors.add(p.author_id);
        const saved = Number(p.metadata?.saved_money ?? 0);
        if (Number.isFinite(saved)) totalSaved += saved;
      }
      if (p.post_type === "sos") sosToday += 1;
    }

    const myCertifyToday = await countTodayCertifyByUser(roomId, userId);

    const { data: members } = await supabaseAdmin
      .from("quit_room_members")
      .select("user_id, nickname")
      .eq("room_id", roomId);
    const profiles = await fetchQuitProfiles((members ?? []).map((m) => m.user_id));

    let longestDays = 0;
    let longestNickname = null;
    for (const m of members ?? []) {
      const prof = profiles[m.user_id];
      const days = computeQuitDaysFromStartMs(prof?.start_time_ms);
      if (days > longestDays) {
        longestDays = days;
        longestNickname = m.nickname;
      }
    }

    const challenge = await computeChallengeProgress(room, memberCount);

    const { data: lastPost } = await supabaseAdmin
      .from("quit_room_posts")
      .select("post_type, content, author_nickname, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: activeDamta } = await supabaseAdmin
      .from("quit_room_damta_sessions")
      .select("id, ends_at, started_by")
      .eq("room_id", roomId)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let damtaParticipants = 0;
    if (activeDamta) {
      const { count } = await supabaseAdmin
        .from("quit_room_damta_participants")
        .select("*", { count: "exact", head: true })
        .eq("session_id", activeDamta.id);
      damtaParticipants = count ?? 0;
    }

    return res.status(200).json({
      ok: true,
      stats: {
        today_ymd: ymd,
        today_certify_count: certifyAuthors.size,
        member_count: memberCount,
        my_certify_today: myCertifyToday,
        my_certify_limit: CERTIFY_DAILY_LIMIT,
        total_saved_today: totalSaved,
        sos_today: sosToday,
        longest_quit_days: longestDays,
        longest_nickname: longestNickname,
        challenge,
        last_post: lastPost
          ? {
              post_type: lastPost.post_type ?? "text",
              content: lastPost.content,
              author_nickname: lastPost.author_nickname,
              created_at: lastPost.created_at,
            }
          : null,
        active_damta: activeDamta
          ? {
              session_id: activeDamta.id,
              ends_at: activeDamta.ends_at,
              participants: damtaParticipants,
            }
          : null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/** GET /v1/quit-rooms/:roomId/weekly-report */
router.get("/:roomId/weekly-report", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;
    const weekKey =
      typeof req.query.week === "string"
        ? req.query.week.trim()
        : isoWeekKeyInSeoul();

    const mem = await assertMembership(roomId, userId);
    if (!mem) return res.status(403).json({ error: "FORBIDDEN" });

    const range = weekRangeInSeoul(weekKey);
    if (!range) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "Invalid week" });
    }

    const startIso = new Date(`${range.startYmd}T00:00:00+09:00`).toISOString();
    const endIso = new Date(`${range.endYmd}T23:59:59+09:00`).toISOString();

    const { data: posts, error } = await supabaseAdmin
      .from("quit_room_posts")
      .select("post_type, metadata, created_at")
      .eq("room_id", roomId)
      .gte("created_at", startIso)
      .lte("created_at", endIso);
    if (error) throw error;

    let certifyCount = 0;
    let sosCount = 0;
    let cheerCount = 0;
    let totalSaved = 0;
    const hourCounts = {};

    for (const p of posts ?? []) {
      if (p.post_type === "certify" || p.post_type === "share") certifyCount += 1;
      if (p.post_type === "sos") sosCount += 1;
      if (p.post_type === "cheer") cheerCount += 1;
      const saved = Number(p.metadata?.saved_money ?? 0);
      if (Number.isFinite(saved)) totalSaved += saved;
      const h = new Date(p.created_at).toLocaleString("en-US", {
        timeZone: "Asia/Seoul",
        hour: "numeric",
        hour12: false,
      });
      const hour = Number(h);
      hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
    }

    let peakHour = null;
    let peakMax = 0;
    for (const [h, c] of Object.entries(hourCounts)) {
      if (c > peakMax) {
        peakMax = c;
        peakHour = Number(h);
      }
    }

    return res.status(200).json({
      ok: true,
      report: {
        week_key: weekKey,
        start_ymd: range.startYmd,
        end_ymd: range.endYmd,
        certify_count: certifyCount,
        sos_count: sosCount,
        cheer_count: cheerCount,
        total_saved: totalSaved,
        peak_hour: peakHour,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/** GET /v1/quit-rooms/:roomId/members */
router.get("/:roomId/members", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const myMembership = await assertMembership(roomId, userId);
    if (!myMembership) return res.status(403).json({ error: "FORBIDDEN" });

    const { data: room, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .select("creator_id")
      .eq("id", roomId)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) return res.status(404).json({ error: "NOT_FOUND" });

    const { data: members, error: memErr } = await supabaseAdmin
      .from("quit_room_members")
      .select("user_id, nickname, role, joined_at")
      .eq("room_id", roomId)
      .order("joined_at", { ascending: true });
    if (memErr) throw memErr;

    const userIds = (members ?? []).map((m) => m.user_id);
    const profiles = await fetchQuitProfiles(userIds);
    const { startIso, endIso } = todayKstBoundsIso();

    const { data: todayCertify } = await supabaseAdmin
      .from("quit_room_posts")
      .select("author_id")
      .eq("room_id", roomId)
      .eq("post_type", "certify")
      .gte("created_at", startIso)
      .lt("created_at", endIso);
    const certifiedToday = new Set((todayCertify ?? []).map((p) => p.author_id));

    const result = (members ?? []).map((m) => {
      const prof = profiles[m.user_id];
      return {
        nickname: m.nickname,
        role: m.role,
        is_admin: m.role === "owner" || m.user_id === room.creator_id,
        joined_at: m.joined_at,
        quit_days: computeQuitDaysFromStartMs(prof?.start_time_ms),
        quit_mode: prof?.quit_mode ?? "continuous",
        certified_today: certifiedToday.has(m.user_id),
      };
    });

    return res.status(200).json({ ok: true, members: result });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:roomId", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const { data: room, error: roomErr } = await supabaseAdmin
      .from("quit_rooms")
      .select("id, creator_id")
      .eq("id", roomId)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) return res.status(404).json({ error: "NOT_FOUND" });
    if (room.creator_id !== userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    await deleteQuitRoomCompletely(roomId);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

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
    if (!room) return res.status(404).json({ error: "NOT_FOUND" });

    if (room.creator_id === userId) {
      await deleteQuitRoomCompletely(roomId);
      return res.status(200).json({ ok: true, deleted_room: true });
    }

    const { error: leaveErr } = await supabaseAdmin
      .from("quit_room_members")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", userId);
    if (leaveErr) throw leaveErr;

    await deleteRoomIfEmpty(roomId);
    return res.status(200).json({ ok: true, deleted_room: false });
  } catch (err) {
    return next(err);
  }
});

/** GET /v1/quit-rooms/:roomId/posts */
router.get("/:roomId/posts", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const mem = await assertMembership(roomId, userId);
    if (!mem) return res.status(403).json({ error: "FORBIDDEN" });

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "50", 10)));

    let query = supabaseAdmin
      .from("quit_room_posts")
      .select(POST_SELECT)
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (typeof req.query.date === "string" && req.query.date.length >= 10) {
      const ymd = req.query.date.trim().slice(0, 10);
      const startIso = new Date(`${ymd}T00:00:00+09:00`).toISOString();
      const endIso = new Date(`${ymd}T23:59:59.999+09:00`).toISOString();
      query = query.gte("created_at", startIso).lte("created_at", endIso);
    }

    const { data, error } = await query;
    if (error) throw error;

    const postIds = (data ?? []).map((p) => p.id);
    const reactionsByPost = await fetchReactionsForPosts(postIds);
    const posts = (data ?? []).map((post) =>
      formatPostRow(post, reactionsByPost),
    );

    return res.status(200).json({ ok: true, posts });
  } catch (err) {
    return next(err);
  }
});

/** POST /v1/quit-rooms/:roomId/posts */
router.post("/:roomId/posts", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const mem = await assertMembership(roomId, userId);
    if (!mem) return res.status(403).json({ error: "FORBIDDEN" });

    const rawType = req.body?.post_type;
    const postType = VALID_POST_TYPES.has(rawType) ? rawType : "text";

    if (postType === "report") {
      return res.status(403).json({ error: "FORBIDDEN", message: "System posts only" });
    }

    if (postType === "certify") {
      const count = await countTodayCertifyByUser(roomId, userId);
      if (count >= CERTIFY_DAILY_LIMIT) {
        return res.status(429).json({
          error: "CERTIFY_LIMIT",
          message: `하루 ${CERTIFY_DAILY_LIMIT}회까지 인증할 수 있어요.`,
        });
      }
    }

    const content =
      typeof req.body?.content === "string"
        ? req.body.content.trim().slice(0, 1000)
        : "";

    let metadata = {};
    if (req.body?.metadata && typeof req.body.metadata === "object") {
      metadata = req.body.metadata;
    }

    const structuredTypes = new Set([
      "certify",
      "share",
      "cheer",
      "sos",
      "mission",
      "damta",
    ]);
    if (structuredTypes.has(postType) && !content) {
      const defaults = {
        certify: "오늘도 버텼어요 🌱",
        share: "기록을 공유했어요",
        cheer: "응원해요!",
        sos: "지금 힘들어요…",
        mission: "3분 미션",
        damta: "담타 같이 버티기",
      };
      // content required for DB NOT NULL — use default
    }

    let imageUrl =
      typeof req.body?.image_url === "string" ? req.body.image_url.trim() : null;

    if (!imageUrl && req.body?.image_base64) {
      try {
        await assertQuitRoomImageUploadAllowed(roomId, userId);
      } catch (limitErr) {
        return res.status(limitErr.status ?? 429).json({
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
        return res.status(uploadErr.status ?? 500).json({
          error: "UPLOAD_FAILED",
          message: uploadErr.message ?? "Image upload failed",
        });
      }
    }

    const finalContent =
      content ||
      (postType === "certify"
        ? "오늘도 버텼어요 🌱"
        : postType === "share"
          ? "기록을 공유했어요"
          : postType === "cheer"
            ? "응원해요!"
            : postType === "sos"
              ? "지금 힘들어요…"
              : postType === "mission"
                ? "3분 미션"
                : postType === "damta"
                  ? "담타 같이 버티기"
                  : imageUrl
                    ? "📷 사진을 공유했어요"
                    : "");

    if (!finalContent && !imageUrl) {
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
        content: finalContent,
        image_url: imageUrl,
        is_sos_alert: postType === "sos",
        post_type: postType,
        metadata,
        author_system: false,
      })
      .select(POST_SELECT)
      .single();
    if (error) throw error;

    const formatted = formatPostRow(post, {});

    const { data: roomRow } = await supabaseAdmin
      .from("quit_rooms")
      .select("name")
      .eq("id", roomId)
      .maybeSingle();
    sendQuitRoomPostFcm({
      roomId,
      roomName: roomRow?.name ?? "금연방",
      authorNickname: mem.nickname,
      excludeUserId: userId,
      postType,
      content: finalContent,
    }).catch((e) => console.warn("[quitRooms] post FCM:", e?.message ?? e));

    return res.status(201).json({ ok: true, post: formatted });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:roomId/posts/:postId", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId, postId } = req.params;

    const { data: post, error: fetchErr } = await supabaseAdmin
      .from("quit_room_posts")
      .select("id, author_id, room_id, image_url, author_system")
      .eq("id", postId)
      .eq("room_id", roomId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!post) return res.status(404).json({ error: "NOT_FOUND" });
    if (post.author_system) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
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

router.post("/:roomId/posts/:postId/reactions", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId, postId } = req.params;

    const mem = await assertMembership(roomId, userId);
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

/** POST /v1/quit-rooms/:roomId/damta/start */
router.post("/:roomId/damta/start", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const mem = await assertMembership(roomId, userId);
    if (!mem) return res.status(403).json({ error: "FORBIDDEN" });

    const { data: room } = await supabaseAdmin
      .from("quit_rooms")
      .select("type")
      .eq("id", roomId)
      .maybeSingle();
    if (!room) return res.status(404).json({ error: "NOT_FOUND" });
    if (room.type !== "group") {
      return res.status(400).json({ error: "BAD_REQUEST", message: "Group rooms only" });
    }

    const memberCount = await countMembers(roomId);
    if (memberCount < 2) {
      return res.status(400).json({
        error: "BAD_REQUEST",
        message: "담타는 2명 이상일 때 시작할 수 있어요.",
      });
    }

    const { data: existing } = await supabaseAdmin
      .from("quit_room_damta_sessions")
      .select("id")
      .eq("room_id", roomId)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .maybeSingle();
    if (existing) {
      return res.status(409).json({
        error: "DAMTA_ACTIVE",
        message: "이미 진행 중인 담타가 있어요.",
        session_id: existing.id,
      });
    }

    const durationSec = 300;
    const endsAt = new Date(Date.now() + durationSec * 1000).toISOString();

    const { data: session, error: sessErr } = await supabaseAdmin
      .from("quit_room_damta_sessions")
      .insert({
        room_id: roomId,
        started_by: userId,
        ends_at: endsAt,
        status: "active",
      })
      .select("id, ends_at, started_at")
      .single();
    if (sessErr) throw sessErr;

    await supabaseAdmin.from("quit_room_damta_participants").upsert({
      session_id: session.id,
      user_id: userId,
    });

    const metadata = {
      damta_status: "started",
      session_id: session.id,
      ends_at: session.ends_at,
      duration_sec: durationSec,
    };

    const { data: post, error: postErr } = await supabaseAdmin
      .from("quit_room_posts")
      .insert({
        room_id: roomId,
        author_id: userId,
        author_nickname: mem.nickname,
        content: "담타 같이 버티기를 시작했어요 🔥",
        is_sos_alert: false,
        post_type: "damta",
        metadata,
        author_system: false,
      })
      .select(POST_SELECT)
      .single();
    if (postErr) throw postErr;

    return res.status(201).json({
      ok: true,
      session: { id: session.id, ends_at: session.ends_at },
      post: formatPostRow(post, {}),
    });
  } catch (err) {
    return next(err);
  }
});

/** POST /v1/quit-rooms/:roomId/damta/join */
router.post("/:roomId/damta/join", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;
    const sessionId =
      typeof req.body?.session_id === "string" ? req.body.session_id.trim() : "";

    const mem = await assertMembership(roomId, userId);
    if (!mem) return res.status(403).json({ error: "FORBIDDEN" });
    if (!sessionId) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "session_id required" });
    }

    const { data: session, error: sessErr } = await supabaseAdmin
      .from("quit_room_damta_sessions")
      .select("id, room_id, status, ends_at")
      .eq("id", sessionId)
      .eq("room_id", roomId)
      .maybeSingle();
    if (sessErr) throw sessErr;
    if (!session || session.status !== "active") {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    if (new Date(session.ends_at).getTime() < Date.now()) {
      return res.status(410).json({ error: "EXPIRED" });
    }

    await supabaseAdmin.from("quit_room_damta_participants").upsert({
      session_id: sessionId,
      user_id: userId,
    });

    const { count } = await supabaseAdmin
      .from("quit_room_damta_participants")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);

    return res.status(200).json({
      ok: true,
      participants: count ?? 1,
      ends_at: session.ends_at,
    });
  } catch (err) {
    return next(err);
  }
});

/** POST /v1/quit-rooms/:roomId/damta/complete */
router.post("/:roomId/damta/complete", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;
    const sessionId =
      typeof req.body?.session_id === "string" ? req.body.session_id.trim() : "";

    const mem = await assertMembership(roomId, userId);
    if (!mem) return res.status(403).json({ error: "FORBIDDEN" });
    if (!sessionId) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "session_id required" });
    }

    const { data: session, error: sessErr } = await supabaseAdmin
      .from("quit_room_damta_sessions")
      .select("id, room_id, status")
      .eq("id", sessionId)
      .eq("room_id", roomId)
      .maybeSingle();
    if (sessErr) throw sessErr;
    if (!session) return res.status(404).json({ error: "NOT_FOUND" });

    if (session.status === "active") {
      await supabaseAdmin
        .from("quit_room_damta_sessions")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", sessionId);
    }

    const { count } = await supabaseAdmin
      .from("quit_room_damta_participants")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);

    const participants = count ?? 1;
    const metadata = {
      damta_status: "completed",
      session_id: sessionId,
      participants,
    };

    const { data: post, error: postErr } = await supabaseAdmin
      .from("quit_room_posts")
      .insert({
        room_id: roomId,
        author_id: userId,
        author_nickname: mem.nickname,
        content: `${participants}명이 함께 담타를 버텼어요! 🔥`,
        is_sos_alert: false,
        post_type: "damta",
        metadata,
        author_system: false,
      })
      .select(POST_SELECT)
      .single();
    if (postErr) throw postErr;

    return res.status(201).json({
      ok: true,
      post: formatPostRow(post, {}),
      participants,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
