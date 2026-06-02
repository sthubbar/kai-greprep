// Netlify serverless function: detect a wrong-answer pattern across a window of misses.
//
// POST body:
//   { misses: [ { question, chosen, correct, topic } ... ], password }
//
// Response: { insight: "single-line plain text" }

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL_ID = process.env.GRE_TUTOR_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = 350;
const TIMEOUT_MS = 22000;

const SYSTEM_PROMPT =
  "You analyze a list of GRE Math Subject Test wrong answers and identify the SINGLE most actionable repeating mistake pattern. " +
  "Return one short sentence (no more than 35 words) starting with a concrete observation, " +
  "then naming the trap or rule. " +
  "Example shape: 'You picked distractor B on three derivative questions; the trap is the chain rule on composite functions.' " +
  "Plain text only, no markdown, no quotes, no leading bullet. " +
  "Never use the em dash or en dash; use periods, commas, parentheses, or plain hyphens.";

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

function buildUserMessage(misses) {
  const lines = misses.slice(0, 30).map((m, i) => {
    const q = (m.question || "").toString().slice(0, 220);
    const ch = (m.chosen || "").toString().slice(0, 120);
    const co = (m.correct || "").toString().slice(0, 120);
    const t = Array.isArray(m.topic) ? m.topic.join("/") : (m.topic || "").toString();
    return `${i + 1}. [${t}] Q: ${q} | picked: ${ch} | correct: ${co}`;
  });
  return (
    "Recent wrong answers:\n" + lines.join("\n") + "\n\n" +
    "Identify the single most actionable repeating mistake pattern in one short sentence."
  );
}

async function callAnthropic(apiKey, userMessage, signal) {
  const body = {
    model: MODEL_ID,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
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
  if (!resp.ok) throw new Error("Anthropic HTTP " + resp.status + ": " + text);
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
    const misses = Array.isArray(payload.misses) ? payload.misses : [];
    if (misses.length === 0) {
      return jsonResponse(400, { error: "misses array empty" });
    }

    const userMessage = buildUserMessage(misses);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const apiResponse = await callAnthropic(apiKey, userMessage, controller.signal);
      let insight = extractText(apiResponse);
      // Force single line.
      insight = insight.replace(/\s+/g, " ").trim();
      return jsonResponse(200, { insight });
    } catch (e) {
      const msg = e && e.name === "AbortError"
        ? "Pattern detector timed out."
        : (e && e.message) || "Pattern detector failed.";
      return jsonResponse(502, { error: msg });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return jsonResponse(500, { error: error.message });
  }
};
