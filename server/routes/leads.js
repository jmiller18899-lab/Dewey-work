/**
 * POST /api/leads — validated lead intake.
 * Flow: validate -> insert seo_leads (status 'new') -> enqueue technical SEO
 * audit job (status 'queued', audit gated at 'pending_review') -> ntfy alert
 * with publish-then-readback attestation.
 */
import { Router } from "express";
import { badRequest, validEmail, validHttpUrl, validName } from "../lib/validate.js";
import { insertRow } from "../lib/supabase.js";
import { publishAlert } from "../lib/ntfy.js";
import { rateLimit } from "../lib/ratelimit.js";
import { idempotency } from "../lib/idempotency.js";

export const leadsRouter = Router();

leadsRouter.post(
  "/api/leads",
  rateLimit({ bucket: "leads", max: 5 }),
  idempotency(),
  async (req, res) => {
    const { name, email, url, source } = req.body || {};

    if (!validName(name)) return badRequest(res, "Enter a name between 2 and 120 characters.");
    if (!validEmail(email)) return badRequest(res, "Enter a valid email address.");
    if (!validHttpUrl(url)) return badRequest(res, "Enter a valid public http(s) website URL.");

    try {
      const lead = await insertRow("seo_leads", {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        url,
        source: typeof source === "string" && source.length <= 60 ? source : "claws-work",
        status: "new",
      });

      // Enqueue the technical SEO audit. The human QA gate lives here: the job
      // produces findings into review_status 'pending_review' and NOTHING is
      // emailed or published until an operator approves.
      let job = null;
      try {
        job = await insertRow("seo_audit_jobs", {
          lead_id: lead.id,
          url,
          status: "queued",
          review_status: "pending_review",
        });
      } catch (error) {
        console.error("[leads] audit enqueue failed:", error.message);
      }

      const alert = await publishAlert({
        title: "New ClawAgent lead",
        message: `Lead: ${name.trim()} <${email.trim()}>\nSite: ${url}\nAudit job: ${job ? job.id : "enqueue failed"} (pending_review)`,
        tags: ["fire", "new"],
        context: { kind: "lead", lead_id: lead.id, job_id: job?.id ?? null },
      });

      return res.status(201).json({
        ok: true,
        lead_id: lead.id,
        audit_job_id: job?.id ?? null,
        review_status: "pending_review",
        alert: { published: alert.published, attested: alert.attested, message_id: alert.message_id },
      });
    } catch (error) {
      console.error("[leads] intake failed:", error.message);
      return res.status(502).json({ error: "The lead could not be recorded. Please try again." });
    }
  }
);
