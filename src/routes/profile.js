import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, terms_accepted_at")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return res.status(200).json({
      ok: true,
      display_name: data?.display_name ?? null,
      terms_accepted_at: data?.terms_accepted_at ?? null,
    });
  } catch (err) {
    return next(err);
  }
});

router.patch("/", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const body = req.body ?? {};
    const patch = {};
    if (typeof body.display_name === "string") {
      patch.display_name = body.display_name.trim();
    }
    if (body.terms_accepted_at === true) {
      patch.terms_accepted_at = new Date().toISOString();
    } else if (typeof body.terms_accepted_at === "string") {
      patch.terms_accepted_at = body.terms_accepted_at;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "no valid fields" });
    }
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", userId);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
