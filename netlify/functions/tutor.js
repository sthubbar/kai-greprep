// Netlify serverless function: GRE tutor (Phase 2, multi-turn chat).
// Accepts either:
//   1. Legacy single-shot payload (Phase 1 frontend):
//        { question, choices, wrongChoice, correctChoice, password }
//   2. New chat payload (Phase 2 frontend):
//        { mode: "chat", context: { question, choices, wrongChoice, correctChoice },
//          messages: [{ role: "user"|"assistant", content: "..." }, ...],
//          password }
//
// Env vars:
//   ANTHROPIC_API_KEY  required
//   ACCESS_PASSWORD    required
//   GRE_TUTOR_MODEL    optional, defaults to claude-sonnet-4-6

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL_ID = process.env.GRE_TUTOR_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS_SHORT = 400;
const MAX_TOKENS_CHAT = 600;
const TIMEOUT_MS = 25000;

const SYSTEM_SHORT =
  "You are tutoring a strong high-school math student preparing for the GRE Math Subject Test. " +
  "The student already has math maturity through introductory analysis. They just got a question wrong. " +
  "Your job is to give the SHORTEST possible teaching that would let them answer THIS family of questions correctly next time. " +
  "Word budget: 80 to 150 words plus optionally one short worked example. " +
  "Do NOT explain the topic in general. Focus on the rule, trick, or pattern that is the key to this specific question. " +
  "End with one sentence beginning with the word Rule: that names the rule for future recall. " +
  "Use LaTeX math notation in dollar signs for inline math and double dollar signs for display math, " +
  "since the student's app renders KaTeX. " +
  "Never use the em dash or the en dash; use periods, commas, parentheses, or plain hyphens.";

const SYSTEM_CHAT =
  "You are tutoring a strong high-school math student preparing for the GRE Math Subject Test in a multi-turn chat. " +
  "Each reply should be tight: aim for 80 to 150 words by default; if the student asks a specific follow-up that needs detail, " +
  "you may extend up to 250 words but no further. " +
  "Stay focused on the question at hand and the rule the student needs. " +
  "When you finish a teaching block (e.g. the first reply, or any reply where you state a generalizable principle), " +
  "end that reply with one sentence beginning with the word Rule: that names the rule for future recall. " +
  "Brief follow-up clarifications do not need a new Rule line. " +
  "Use LaTeX math: dollar signs for inline, double dollar signs for display, since the app renders KaTeX. " +
  "Never use the em dash or the en dash; use periods, commas, parentheses, or plain hyphens.";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

function extractText(apiResponse) {
  const blocks = apiResponse.content || [];
  const out = [];
  for (const b of blocks) {
    if (b && b.type === "text" && typeof b.text === "string") {
      out.push(b.text);
    }
  }
  return out.join("").trim();
}

function buildContextLine(ctx) {
  if (!ctx) return "";
  const question = (ctx.question || "").toString().trim();
  const choices = Array.isArray(ctx.choices) ? ctx.choices : [];
  const wrong = (ctx.wrongChoice || "").toString();
  const correct = (ctx.correctChoice || "").toString();
  return (
    "Original question: " + question + "\n" +
    "Choices: " + choices.join(" | ") + "\n" +
    "Student picked: " + wrong + "\n" +
    "Correct answer: " + correct
  );
}

function buildLegacyUserMessage(payload) {
  const question = (payload.question || "").toString().trim();
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const wrong = (payload.wrongChoice || "").toString();
  const correct = (payload.correctChoice || "").toString();
  return (
    "Question: " + question + "\n" +
    "Choices: " + choices.join("\n") + "\n" +
    "Student picked: " + wrong + "\n" +
    "Correct answer: " + correct
  );
}

function sanitizeMessages(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const m of arr) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = (m.content || "").toString();
    if (!content.trim()) continue;
    out.push({ role, content });
  }
  return out;
}

async function callAnthropic({ apiKey, system, messages, maxTokens, signal }) {
  const body = {
    model: MODEL_ID,
    max_tokens: maxTokens,
    system,
    messages,
  };
  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error("Anthropic HTTP " + resp.status + ": " + text);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("Anthropic returned non-JSON: " + text.slice(0, 200));
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: CORS_HEADERS, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return jsonResponse(405, { error: "Method not allowed. Use POST." });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const accessPassword = process.env.ACCESS_PASSWORD;
    if (!apiKey || !accessPassword) {
      return jsonResponse(500, { error: "Server not configured" });
    }

    let payload;
    try {
      payload = event.body ? JSON.parse(event.body) : {};
    } catch (e) {
      return jsonResponse(400, { error: "Invalid JSON body: " + e.message });
    }

    if (!payload || payload.password !== accessPassword) {
      return jsonResponse(401, { error: "Bad password" });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // Detect mode.
      const isChat = payload.mode === "chat" || Array.isArray(payload.messages);

      if (isChat) {
        const ctx = payload.context || null;
        const messages = sanitizeMessages(payload.messages);
        if (messages.length === 0) {
          return jsonResponse(400, { error: "messages array empty" });
        }
        // Prepend a system-style context line as the first user message
        // (kept inside user role so model treats it as setup data).
        const ctxLine = buildContextLine(ctx);
        const finalMessages = ctxLine
          ? [{ role: "user", content: "Context for this conversation:\n" + ctxLine }]
              .concat(messages)
          : messages;

        const apiResponse = await callAnthropic({
          apiKey,
          system: SYSTEM_CHAT,
          messages: finalMessages,
          maxTokens: MAX_TOKENS_CHAT,
          signal: controller.signal,
        });
        const reply = extractText(apiResponse);
        return jsonResponse(200, { reply, teaching: reply });
      }

      // Legacy single-shot.
      if (!payload.question || !Array.isArray(payload.choices)) {
        return jsonResponse(400, { error: "Missing question or choices." });
      }
      const userMessage = buildLegacyUserMessage(payload);
      const apiResponse = await callAnthropic({
        apiKey,
        system: SYSTEM_SHORT,
        messages: [{ role: "user", content: userMessage }],
        maxTokens: MAX_TOKENS_SHORT,
        signal: controller.signal,
      });
      const teaching = extractText(apiResponse);
      return jsonResponse(200, { teaching, reply: teaching });
    } catch (e) {
      const msg = e && e.name === "AbortError"
        ? "Tutor request timed out."
        : (e && e.message) || "Tutor call failed.";
      return jsonResponse(502, { error: msg });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return jsonResponse(500, { error: error.message });
  }
};
