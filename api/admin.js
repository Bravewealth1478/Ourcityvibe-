// Vercel Node.js adapter for the existing Phase 2 admin handler.
// Keeping the business logic in netlify/functions/admin.js avoids changing
// authentication, validation, database queries, or session behavior.
const { handler } = require("../netlify/functions/admin");

module.exports = async function adminApi(req, res) {
  const host = req.headers.host || "localhost";
  const requestUrl = new URL(req.url || "/api/admin", `https://${host}`);
  const body = typeof req.body === "string"
    ? req.body
    : req.body === undefined
      ? ""
      : JSON.stringify(req.body);

  const event = {
    httpMethod: req.method || "GET",
    headers: req.headers,
    queryStringParameters: Object.fromEntries(requestUrl.searchParams.entries()),
    body,
  };

  try {
    const result = await handler(event);
    for (const [name, value] of Object.entries(result.headers || {})) {
      if (value !== undefined) res.setHeader(name, value);
    }
    res.statusCode = result.statusCode || 200;
    if (res.statusCode === 204) return res.end();
    return res.end(result.body || "");
  } catch (error) {
    console.error("Vercel admin adapter failed:", error);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "The request could not be completed." }));
  }
};

// Source collection can fetch up to three independently bounded feeds per request.
module.exports.config = { maxDuration: 60 };
