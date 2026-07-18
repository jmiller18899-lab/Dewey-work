/** OpenRouter chat completion streaming for the ClawAgent sales associate. */
import { config } from "./config.js";

export const SALES_SYSTEM_PROMPT = `You are ClawAgent, a sales associate for a technical SEO and AI-search visibility agency.

Scope:
- Help prospects understand technical SEO problems (crawlability, indexation, metadata, site health, Core Web Vitals) and how their site surfaces in AI-powered search / answer engines.
- Explain what a ClawAgent technical visibility review covers and encourage prospects to submit their website through the lead form.

Hard rules:
- NEVER fabricate pricing, discounts, timelines, or guarantees. If asked about pricing or contractual terms, say a human team member will follow up with specifics and offer to collect their details.
- Escalate to a human for any commitment: contracts, refunds, legal claims, custom quotes, or promises about ranking outcomes. Say clearly that a human will confirm.
- Every automated audit or recommendation is reviewed by a human operator before it is shared — never present unreviewed automated output as final.
- Stay on topic (technical SEO and AI-search visibility). Politely decline unrelated requests.
- Be concise, friendly, and concrete. Ask one clarifying question at a time.`;

/**
 * Stream a completion from OpenRouter.
 * Calls onDelta(text) for each token chunk; resolves with the full reply text.
 */
export async function streamSalesReply(messages, onDelta) {
  if (!config.openrouterApiKey) {
    throw Object.assign(new Error("Chat is not configured (OPENROUTER_API_KEY missing)."), {
      status: 503,
    });
  }

  const response = await fetch(config.openrouterUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.publicBaseUrl,
      "X-Title": "ClawAgent Sales Associate",
    },
    body: JSON.stringify({
      model: config.openrouterModel,
      stream: true,
      max_tokens: 1024,
      messages: [{ role: "system", content: SALES_SYSTEM_PROMPT }, ...messages],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw Object.assign(
      new Error(`OpenRouter request failed (${response.status}): ${detail.slice(0, 300)}`),
      { status: 502 }
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onDelta(delta);
        }
      } catch {
        // Ignore malformed keep-alive lines.
      }
    }
  }

  return fullText;
}
