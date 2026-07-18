/**
 * Central environment configuration. Nothing here is committed — values come
 * from Railway service variables (see .env.example).
 */
export const config = {
  port: Number(process.env.PORT) || 8080,
  host: "0.0.0.0",

  // CORS allowlist for browser writes. Comma-separated origins.
  frontendOrigins: (process.env.FRONTEND_ORIGIN ||
    "http://localhost:8080,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || "",

  openrouterApiKey: process.env.OPENROUTER_API_KEY || "",
  openrouterModel: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4",
  openrouterUrl:
    process.env.OPENROUTER_URL || "https://openrouter.ai/api/v1/chat/completions",

  xaiApiKey: process.env.XAI_API_KEY || "",
  // xAI realtime session mint endpoint + client websocket URL. Overridable so
  // the deployment can track xAI API changes without a code change.
  xaiSessionUrl:
    process.env.XAI_SESSION_URL || "https://api.x.ai/v1/realtime/sessions",
  xaiRealtimeUrl:
    process.env.XAI_REALTIME_URL || "wss://api.x.ai/v1/realtime",
  xaiVoiceModel: process.env.XAI_VOICE_MODEL || "grok-voice",

  twilioSid: process.env.TWILIO_SID || "",
  twilioAuth: process.env.TWILIO_AUTH || "",
  twilioFrom: process.env.TWILIO_FROM || "",
  // Public base URL of this gateway, used to build Twilio webhook/signature URLs.
  publicBaseUrl:
    process.env.PUBLIC_BASE_URL || "https://clawagent-production-6805.up.railway.app",

  ntfyServer: process.env.NTFY_SERVER || "https://ntfy.sh",
  ntfyTopic: process.env.NTFY_TOPIC || "",

  // Optional bearer token protecting operator/admin endpoints (QA approvals).
  operatorToken: process.env.OPERATOR_TOKEN || "",
};

export function missingConfig(...keys) {
  return keys.filter((key) => !config[key]);
}
