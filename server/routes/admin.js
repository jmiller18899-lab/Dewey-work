/**
 * Operator-only QA gate actions. The Telegram approval bot (or any operator
 * tool) calls these with `Authorization: Bearer $OPERATOR_TOKEN`. Nothing
 * AI-generated ships without one of these approvals flipping review_status.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { config } from "../lib/config.js";
import { supabase } from "../lib/supabase.js";
import { publishAlert } from "../lib/ntfy.js";

export const adminRouter = Router();

function requireOperator(req, res) {
  if (!config.operatorToken) {
    res.status(503).json({ error: "Operator access is not configured (OPERATOR_TOKEN)." });
    return false;
  }
  const header = req.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = Buffer.from(config.operatorToken);
  const provided = Buffer.from(token);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    res.status(401).json({ error: "Operator authentication required." });
    return false;
  }
  return true;
}

adminRouter.post("/api/admin/audits/:id/review", async (req, res) => {
  if (!requireOperator(req, res)) return;

  const decision = req.body?.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'." });
  }

  const db = supabase();
  if (!db) return res.status(503).json({ error: "Supabase is not configured." });

  const { data, error } = await db
    .from("seo_audit_jobs")
    .update({ review_status: decision, reviewed_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("review_status", "pending_review")
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Audit job not found or not pending review." });
  }

  await publishAlert({
    title: `Audit ${decision}`,
    message: `Audit job ${data.id} for ${data.url} was ${decision} by an operator.`,
    tags: [decision === "approved" ? "white_check_mark" : "x"],
    context: { kind: "qa_review", job_id: data.id, decision },
  });

  return res.json({ ok: true, job_id: data.id, review_status: decision });
});
