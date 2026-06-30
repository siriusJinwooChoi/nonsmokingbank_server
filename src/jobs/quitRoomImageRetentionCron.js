import { env } from "../config/env.js";
import {
  cleanupOrphanQuitRoomImagesAllRooms,
  runQuitRoomRetentionDailyBatch,
} from "../lib/quitRoomRetention.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

let _dailyInFlight = false;
let _weeklyInFlight = false;
let _lastDailyKey = "";
let _lastWeeklyKey = "";

function dayKeyUtc() {
  return new Date().toISOString().slice(0, 10);
}

function weekKeyUtc() {
  const d = new Date();
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.floor((d - jan1) / MS_PER_WEEK) + 1;
  return `${d.getUTCFullYear()}-W${week}`;
}

async function runDailyIfNeeded() {
  const key = dayKeyUtc();
  if (key === _lastDailyKey || _dailyInFlight) return;
  _dailyInFlight = true;
  try {
    const result = await runQuitRoomRetentionDailyBatch();
    _lastDailyKey = key;
    console.log(
      `[quitRoomRetentionCron] daily done: imagesExpired=${result.imagesExpired} postsDeleted=${result.postsDeleted}`,
    );
  } catch (e) {
    console.error("[quitRoomRetentionCron] daily error:", e?.message ?? e);
  } finally {
    _dailyInFlight = false;
  }
}

async function runWeeklyIfNeeded() {
  const key = weekKeyUtc();
  if (key === _lastWeeklyKey || _weeklyInFlight) return;
  _weeklyInFlight = true;
  try {
    const result = await cleanupOrphanQuitRoomImagesAllRooms();
    _lastWeeklyKey = key;
    console.log(
      `[quitRoomRetentionCron] weekly orphan cleanup removed=${result.removed}`,
    );
  } catch (e) {
    console.error("[quitRoomRetentionCron] weekly error:", e?.message ?? e);
  } finally {
    _weeklyInFlight = false;
  }
}

async function tickQuitRoomRetention() {
  await runDailyIfNeeded();
  await runWeeklyIfNeeded();
}

export function startQuitRoomImageRetentionCron() {
  if (!env.enableQuitRoomRetentionCron) {
    console.log(
      "[quitRoomRetentionCron] disabled (ENABLE_QUIT_ROOM_RETENTION_CRON=false)",
    );
    return;
  }

  const intervalMs = Math.max(60_000, env.quitRoomRetentionCronIntervalMs);
  setInterval(() => {
    tickQuitRoomRetention().catch((e) =>
      console.error("[quitRoomRetentionCron] tick error:", e?.message ?? e),
    );
  }, intervalMs);

  // 기동 직후 1회
  tickQuitRoomRetention().catch((e) =>
    console.error("[quitRoomRetentionCron] initial tick error:", e?.message ?? e),
  );

  console.log(`[quitRoomRetentionCron] started every ${intervalMs}ms`);
}
