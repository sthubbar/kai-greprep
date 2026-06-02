// Netlify serverless function: health check.
// GET /.netlify/functions/health -> { status, hasKey, hasPassword, model }

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: CORS_HEADERS, body: "" };
    }
    if (event.httpMethod !== "GET") {
      return {
        statusCode: 405,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method not allowed. Use GET." }),
      };
    }
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "ok",
        phase: 2,
        hasKey: !!process.env.ANTHROPIC_API_KEY,
        hasPassword: !!process.env.ACCESS_PASSWORD,
        model: process.env.GRE_TUTOR_MODEL || "claude-sonnet-4-6",
        functions: ["tutor", "generate", "pattern", "health"],
        ts: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
