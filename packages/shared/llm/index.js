/**
 * Pluggable LLM narration — explains, in plain language, WHY the deterministic
 * dispatch brain chose a policy. OPTIONAL and OFF BY DEFAULT.
 *
 * Design contract (matches the project's safety story):
 *   - The LLM is NON-AUTHORITATIVE. It only narrates an already-made decision.
 *     It never decides, actuates, or recommends acting — the deterministic brain
 *     and the Command Safety Gate own all of that.
 *   - Degrades cleanly: when LLM_ENABLED is not "true", narrate() returns
 *     { enabled: false } and the rest of the system is unaffected.
 *
 * Providers (LLM_PROVIDER):
 *   - "ollama"    (default) — local, air-gapped friendly; reuses the request
 *                  shape already proven in the n8n ollama analyzer node.
 *   - "anthropic" — Anthropic Messages API (set ANTHROPIC_API_KEY). Minimal raw
 *                  fetch adapter (no SDK dependency) since this path is optional.
 *
 * Pure-ish: a single outbound HTTP call, a hard timeout, and never throws into
 * the caller — failures come back as { enabled:true, text:null, error }.
 */

// -----------------------------------------------------------------------------
// The "pro" system prompt — the analyst persona, with hard safety rails.
// -----------------------------------------------------------------------------
export const OPERATIONS_ANALYST_PROMPT = [
  "You are the operations analyst for a smart-elevator digital twin used in a SCADA control room.",
  "A deterministic dispatch brain has ALREADY chosen a dispatch policy. Your only job is to explain,",
  "in plain language a human operator can act on, WHY that choice is reasonable given the live state",
  "and the brain's own score table.",
  "",
  "Hard rules:",
  "- You are NON-AUTHORITATIVE. You never decide, change, approve, or recommend changing anything.",
  "- Use ONLY the data provided. Never invent sensor values, numbers, floors, or events.",
  "- No commands, no actuation, no recommendations to act. Explanation only.",
  "- Be concrete and concise: at most 2 sentences, operator-grade, no preamble, do not restate the JSON.",
  "- If the data is insufficient to explain the choice, say so briefly instead of guessing.",
  "",
  'Respond with JSON only, exactly: {"why": "<your explanation>"}',
].join("\n");

function env(name, fallback) {
  const v = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return v == null || v === "" ? fallback : v;
}

export function isLLMEnabled() {
  return String(env("LLM_ENABLED", "false")).toLowerCase() === "true";
}

const TIMEOUT_MS = Number.parseInt(env("LLM_TIMEOUT_MS", "9000"), 10) || 9000;
const MAX_TOKENS = Number.parseInt(env("LLM_MAX_TOKENS", "512"), 10) || 512;

// Tolerant JSON extraction — models sometimes wrap JSON in prose or code fences.
function extractWhy(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  try {
    return String(JSON.parse(text).why || "").trim() || null;
  } catch {
    /* fall through to brace extraction */
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return String(JSON.parse(match[0]).why || "").trim() || null;
    } catch {
      /* not JSON */
    }
  }
  // Last resort: a short, fence-stripped plain string.
  return text.replace(/^```(?:json)?|```$/g, "").trim().slice(0, 400) || null;
}

function buildUserPayload({ decision, twinSummary }) {
  // Keep it compact — only what the analyst needs to ground the explanation.
  return JSON.stringify({
    policy: decision?.active_policy || decision?.policy_id,
    previous_policy: decision?.previous_policy,
    brain: decision?.active_brain || decision?.brain_id,
    confidence: decision?.confidence,
    reason: decision?.reason,
    guardrails: decision?.guardrails,
    score_table: (decision?.score_table || []).slice(0, 6),
    shadow_agreement: decision?.shadow_agreement,
    twin: twinSummary || null,
  });
}

async function narrateOllama(userPayload) {
  const baseUrl = env("LOCAL_LLM_URL", "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = env("LOCAL_LLM_MODEL", "llama3.2");
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: 0.1 },
      messages: [
        { role: "system", content: OPERATIONS_ANALYST_PROMPT },
        { role: "user", content: userPayload },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const body = await res.json();
  return { text: extractWhy(body?.message?.content || body?.response), model, provider: "ollama" };
}

async function narrateAnthropic(userPayload) {
  const apiKey = env("ANTHROPIC_API_KEY", "");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = env("ANTHROPIC_MODEL", "claude-opus-4-8");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    // No temperature/top_p — those are rejected on Opus 4.8/4.7. The strict
    // system prompt keeps the output to a short JSON object.
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: OPERATIONS_ANALYST_PROMPT,
      messages: [{ role: "user", content: userPayload }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}`);
  const body = await res.json();
  const textBlock = Array.isArray(body?.content)
    ? body.content.find((b) => b.type === "text")
    : null;
  return { text: extractWhy(textBlock?.text), model, provider: "anthropic" };
}

/**
 * narrate({ decision, twinSummary }) -> { enabled, text, provider, model, error }
 * Never throws. When disabled, returns { enabled:false } immediately.
 */
export async function narrate({ decision, twinSummary } = {}) {
  if (!isLLMEnabled()) return { enabled: false };
  const provider = String(env("LLM_PROVIDER", "ollama")).toLowerCase();
  const userPayload = buildUserPayload({ decision, twinSummary });
  try {
    const out = provider === "anthropic"
      ? await narrateAnthropic(userPayload)
      : await narrateOllama(userPayload);
    return { enabled: true, text: out.text, provider: out.provider, model: out.model, error: null };
  } catch (e) {
    return { enabled: true, text: null, provider, model: null, error: e.message || "LLM error" };
  }
}
