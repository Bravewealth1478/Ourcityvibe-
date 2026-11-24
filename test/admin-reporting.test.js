const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { handler } = require("../netlify/functions/admin");

test("authenticated reports endpoint returns the aggregate report for the selected period", async (t) => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test_key";
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.ADMIN_SESSION_SECRET = "test-session-secret";
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000, nonce: "test" })).toString("base64url");
  const signature = createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
  const originalFetch = global.fetch;
  let rpcBody;
  global.fetch = async (url, options) => {
    assert.match(String(url), /\/rpc\/admin_reporting_summary$/);
    rpcBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      days: 7,
      totals: { genuine_clicks: 12, bot_clicks: 3, visitor_days: 8, events_with_clicks: 2 },
      by_event: [], by_source: [], by_country: [], by_device: [], daily: [],
      generated_at: "2026-11-24T00:00:00.000Z"
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => { global.fetch = originalFetch; });
  const response = await handler({
    httpMethod: "GET",
    headers: { host: "ourcityvibe.vercel.app", cookie: "ocv_admin_session=" + payload + "." + signature },
    queryStringParameters: { action: "reports", days: "7" },
    body: ""
  });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.report.totals.genuine_clicks, 12);
  assert.deepEqual(rpcBody, { p_days: 7 });
});
