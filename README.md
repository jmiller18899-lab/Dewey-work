# ClawAgent — Sales & Lead Capture Platform

Sales and lead-capture platform for technical SEO and AI-search visibility.
Static frontend + Express gateway routes, persisted in Supabase, alerted via
ntfy with publish-then-readback attestation, telephony via Twilio, chat via
OpenRouter, voice via xAI Grok Voice realtime (with browser fallback).

## Layout

```
public/               Frontend (single-page app + PWA manifest/service worker/icons)
server/index.js       Standalone entrypoint (Railway): static frontend + API
server/router.js      Mountable router — drop into the existing clawagent gateway
server/routes/        leads, sales (chat/voice/transcripts), outreach, admin (QA gate)
server/lib/           config, supabase, openrouter, twilio, ntfy attestor,
                      validation, rate limiting, idempotency
db/migrations/        Supabase SQL (sales_messages, sales_transcripts,
                      seo_audit_jobs, outreach_log, alert_log)
```

## Mounting into the existing gateway

The spec calls for these routes to live on the existing clawagent gateway
(`clawagent-production-6805.up.railway.app`), not a new service. The router is
self-contained (body parsing, CORS, /health, all /api routes):

```js
import { createClawagentRouter } from "./server/router.js";
app.use(createClawagentRouter());
```

`server/index.js` is the same router plus static frontend hosting, so this repo
also deploys standalone on Railway (`npm start`, binds `0.0.0.0:$PORT`,
ephemeral disk, no volume).

## API

| Route | Purpose |
|---|---|
| `GET /health` | Liveness + per-capability config status |
| `POST /api/leads` | Validated lead intake → `seo_leads` (`status:'new'`) → audit job enqueued (`pending_review`) → ntfy alert |
| `POST /api/sales/chat` | Streamed sales-associate reply via OpenRouter; each turn persisted to `sales_messages` by `session_id` |
| `POST /api/sales/voice/session` | Mints an ephemeral Grok Voice realtime session (`{}` when `XAI_API_KEY` absent → browser-speech fallback) |
| `POST /api/sales/transcripts` | Persists the completed call transcript to `sales_transcripts` + ntfy alert |
| `POST /api/outreach/sms` / `call` | Twilio outbound with E.164 validation, in-memory **and** durable idempotency, `outreach_log` row per send |
| `POST /api/outreach/inbound/sms` / `voice` | Twilio webhooks for (762) 334-0186 — signature-validated, logged, TwiML reply/voicemail |
| `POST /api/admin/audits/:id/review` | Operator QA gate (`Bearer $OPERATOR_TOKEN`) — flips `pending_review` → `approved`/`rejected` |

## Human QA gate

Every audit job is created with `review_status: 'pending_review'`. Nothing
AI-generated is emailed or published automatically; the Telegram operator bot
(or any operator tool) approves via the admin route above. The sales-associate
system prompt additionally forbids fabricated pricing and requires human
escalation for commitments.

## Third-party verifiability (Definition of Done)

- **Supabase rows**: leads in `seo_leads`, queued audits in `seo_audit_jobs`,
  chat turns in `sales_messages`, call transcripts in `sales_transcripts`,
  every Twilio send in `outreach_log`.
- **ntfy attestation**: every lead and completed call publishes to
  `$NTFY_TOPIC`, then **reads the topic back** and records
  `published`/`attested`/`message_id` in `alert_log` — success is what the ntfy
  server returned, never self-reported.

## Setup

1. Run `db/migrations/001_clawagent_tables.sql` in the Supabase SQL editor
   (project `mmfostoacpcnbqjbwpxq`). Idempotent; RLS stays on, service-role only.
2. Set Railway variables per `.env.example` (never commit `.env`).
3. In the Twilio console, point (762) 334-0186 webhooks at
   `POST $PUBLIC_BASE_URL/api/outreach/inbound/sms` and
   `.../inbound/voice`.
4. Deploy: `npm install && npm start`.

Missing keys degrade gracefully: no `XAI_API_KEY` → browser-speech fallback;
no Twilio/OpenRouter keys → those routes return a clear 503; `/health` reports
which capabilities are live.

## Security

- CORS locked to `FRONTEND_ORIGIN` (credentialed browser requests only from
  the allowlist; webhooks/curl have no Origin and are governed by their own
  auth — Twilio signatures, operator bearer token).
- All inputs validated server-side (email, http(s)+public-host URL, E.164,
  session-id shape, bounded message/transcript sizes). Lead URLs reject
  localhost/private ranges to keep the audit fetcher SSRF-safe.
- Per-IP rate limits: leads 5/min, chat 20/min, outreach 5/min, voice 10/min.
- Idempotency keys replay-protected in memory; Twilio sends also enforce a
  unique key in `outreach_log`.
- Secrets live only in Railway variables; the browser never sees API keys —
  Grok Voice uses server-minted ephemeral tokens.
