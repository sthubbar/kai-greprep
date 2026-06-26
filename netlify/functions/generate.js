// Netlify serverless function: generate 3 similar GRE Math Subject practice questions.
//
// POST body:
//   { source: { question, choices, correctChoice, topics }, password }
//
// Response:
//   { questions: [ { id, question, choices, correct_answer, topics, explanation }, ... ] }

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL_ID = "claude-opus-4-8";
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 28000;

const SYSTEM_PROMPT =
  "You generate fresh GRE Math Subject Test practice questions modeled on a given seed question. " +
  "Each generated question must match the seed in topic family and difficulty, but must NOT be a near-duplicate. " +
  "Use the same canonical-tag taxonomy as the seed (the topics list provided). " +
  "Each question is 5-choice multiple choice with exactly one correct answer. " +
  "Use LaTeX in dollar signs for inline math, double dollar signs for display math (KaTeX renders the app). " +
  "Never use the em dash or en dash; use periods, commas, parentheses, or plain hyphens. " +
  "Output ONLY the JSON object. Do not wrap in code fences. Do not prefix with any language tag like jsonl or json. " +
  "Schema: {\"questions\":[{\"id\":\"GEN_xxx\",\"question\":\"...\",\"choices\":[\"...\",\"...\",\"...\",\"...\",\"...\"],\"correct_answer\":0,\"topics\":[\"...\"],\"explanation\":\"...\"}]} " +
  "where correct_answer is the 0-based index of the correct choice. Generate exactly 3 questions.";

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

function tryParseJSON(raw) {
  // Strip markdown fences if model adds them anyway. Accept any language tag
  // (json, jsonl, javascript, etc.) and tolerate leading whitespace before fence.
  let s = (raw || "").trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/```\s*$/, "").trim();
  }
  try {
    return JSON.parse(s);
  } catch (e) {
    // Try to find the first {...} block.
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(s.slice(start, end + 1)); } catch (_) { /* fall through */ }
    }
    return null;
  }
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
  if (!resp.ok) {
    throw new Error("Anthropic HTTP " + resp.status + ": " + text);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("Anthropic returned non-JSON: " + text.slice(0, 200));
  }
}

function buildUserMessage(source) {
  const q = (source && source.question) ? source.question.toString() : "";
  const c = Array.isArray(source && source.choices) ? source.choices : [];
  const correct = (source && source.correctChoice) ? source.correctChoice.toString() : "";
  const topics = Array.isArray(source && source.topics) ? source.topics : [];
  return (
    "Seed question:\n" + q + "\n\n" +
    "Seed choices:\n" + c.map((x, i) => `(${i}) ${x}`).join("\n") + "\n\n" +
    "Seed correct answer: " + correct + "\n" +
    "Seed canonical topics: " + topics.join(", ") + "\n\n" +
    "Generate exactly 3 similar but distinct practice questions in the JSON schema described."
  );
}

function validateGenerated(payload) {
  if (!payload || !Array.isArray(payload.questions)) return null;
  const qs = payload.questions.slice(0, 3).map((q, i) => {
    const id = (q.id && /^GEN_/.test(q.id)) ? q.id : `GEN_${Date.now()}_${i}`;
    const question = (q.question || "").toString();
    const choices = Array.isArray(q.choices) ? q.choices.map(x => x.toString()) : [];
    let correct = q.correct_answer;
    if (typeof correct !== "number" || correct < 0 || correct >= choices.length) correct = 0;
    const topics = Array.isArray(q.topics) ? q.topics.map(t => t.toString()) : [];
    const explanation = (q.explanation || "").toString();
    if (!question || choices.length < 2) return null;
    return { id, question, choices, correct_answer: correct, topics, explanation };
  }).filter(Boolean);
  return qs.length === 3 ? qs : null;
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

    const source = payload.source || {};
    if (!source.question || !Array.isArray(source.choices)) {
      return jsonResponse(400, { error: "Missing source.question or source.choices" });
    }

    const userMessage = buildUserMessage(source);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const apiResponse = await callAnthropic(apiKey, userMessage, controller.signal);
      const text = extractText(apiResponse);
      const parsed = tryParseJSON(text);
      const cleaned = validateGenerated(parsed);
      if (!cleaned) {
        return jsonResponse(502, { error: "Generator returned malformed JSON.", raw: text.slice(0, 800) });
      }
      return jsonResponse(200, { questions: cleaned });
    } catch (e) {
      const msg = e && e.name === "AbortError"
        ? "Generator timed out."
        : (e && e.message) || "Generator call failed.";
      return jsonResponse(502, { error: msg });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return jsonResponse(500, { error: error.message });
  }
};
