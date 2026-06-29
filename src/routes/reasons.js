import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

function normalizeText(v) {
  return String(v ?? "").trim();
}

function toReasonItem(raw, fallbackOrder = 1) {
  const now = Date.now();
  const text = normalizeText(raw?.text);
  return {
    id: normalizeText(raw?.id) || String(now),
    text,
    pinned: Boolean(raw?.pinned),
    createdAt: Number.isFinite(raw?.createdAt) ? Number(raw.createdAt) : now,
    displayNumber: Number.isFinite(raw?.displayNumber)
      ? Number(raw.displayNumber)
      : fallbackOrder,
  };
}

/** reasons_json 배열에서 pinned 항목의 text를 추출 */
function extractPinnedText(reasonsJson) {
  if (!Array.isArray(reasonsJson)) return "";
  const pinned = reasonsJson.find((r) => r?.pinned);
  return normalizeText(pinned?.text);
}

router.get("/", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data, error } = await supabaseAdmin
      .from("reasons")
      .select("reasons_json, selected_reason_id, selected_reason_text")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    const reasonsJson = Array.isArray(data?.reasons_json)
      ? data.reasons_json
      : [];
    const reasons = reasonsJson
      .map((item, idx) => toReasonItem(item, idx + 1))
      .filter((r) => r.text);

    return res.status(200).json({
      ok: true,
      reasons,
      pinnedReasonText: extractPinnedText(reasonsJson),
      selectedReasonId: data?.selected_reason_id ?? null,
      selectedReasonText: data?.selected_reason_text ?? null,
    });
  } catch (err) {
    return next(err);
  }
});

router.put("/pinned", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const text = normalizeText(req.body?.text);

    if (!text) {
      return res
        .status(400)
        .json({ error: "BAD_REQUEST", message: "text is required" });
    }
    if (text.length > 120) {
      return res
        .status(400)
        .json({ error: "BAD_REQUEST", message: "text must be <= 120 chars" });
    }

    const { data: row, error: getErr } = await supabaseAdmin
      .from("reasons")
      .select("reasons_json, selected_reason_id, selected_reason_text")
      .eq("user_id", userId)
      .maybeSingle();
    if (getErr) throw getErr;

    const existing = Array.isArray(row?.reasons_json) ? row.reasons_json : [];
    const list = existing.map((item, idx) => toReasonItem(item, idx + 1));
    const now = Date.now();

    let previouslyPinned = null;
    for (const r of list) {
      if (r.pinned) {
        previouslyPinned = r;
        break;
      }
    }

    for (const r of list) {
      r.pinned = false;
    }

    let target;
    if (previouslyPinned) {
      previouslyPinned.text = text;
      previouslyPinned.pinned = true;
      target = previouslyPinned;
    } else {
      target = list.find((r) => normalizeText(r.text) === text);
      if (!target) {
        const maxDisplay = list.reduce(
          (m, r) => Math.max(m, Number(r.displayNumber || 0)),
          0,
        );
        target = {
          id: String(now),
          text,
          pinned: true,
          createdAt: now,
          displayNumber: maxDisplay + 1,
        };
        list.push(target);
      } else {
        target.text = text;
        target.pinned = true;
      }
    }

    const payload = {
      user_id: userId,
      reasons_json: list,
    };
    const selId =
      row?.selected_reason_id != null ? String(row.selected_reason_id) : null;
    if (previouslyPinned && selId && previouslyPinned.id === selId) {
      payload.selected_reason_text = text;
    }

    const { error: upsertErr } = await supabaseAdmin
      .from("reasons")
      .upsert(payload, { onConflict: "user_id" });
    if (upsertErr) throw upsertErr;

    return res.status(200).json({
      ok: true,
      pinnedReasonText: text,
      reason: target,
      reasons: list,
    });
  } catch (err) {
    return next(err);
  }
});

router.put("/sync", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const inputReasons = Array.isArray(req.body?.reasons) ? req.body.reasons : [];
    const selectedReasonId = normalizeText(req.body?.selectedReasonId) || null;
    const selectedReasonText =
      normalizeText(req.body?.selectedReasonText) || null;

    const reasons = inputReasons
      .map((item, idx) => toReasonItem(item, idx + 1))
      .filter((r) => normalizeText(r.text).length > 0);

    let foundPinned = false;
    for (const r of reasons) {
      if (r.pinned && !foundPinned) {
        foundPinned = true;
      } else {
        r.pinned = false;
      }
    }

    const { error } = await supabaseAdmin.from("reasons").upsert(
      {
        user_id: userId,
        reasons_json: reasons,
        selected_reason_id: selectedReasonId,
        selected_reason_text: selectedReasonText,
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;

    return res.status(200).json({
      ok: true,
      reasons,
      pinnedReasonText: extractPinnedText(reasons),
      selectedReasonId,
      selectedReasonText,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
