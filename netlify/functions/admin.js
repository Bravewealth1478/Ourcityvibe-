const { createHmac, timingSafeEqual, randomBytes } = require("node:crypto");

const COOKIE_NAME = "ocv_admin_session";
const SESSION_SECONDS = 60 * 60 * 8;
const SOURCES = ["instagram", "tiktok", "whatsapp", "x", "facebook", "other"];
const PLATFORMS = ["ticketmaster", "eventbrite", "posh", "other"];

function json(statusCode, body, extraHeaders = {}) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }, body: JSON.stringify(body) };
}
function env() {
  const values = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"];
  const missing = values.filter((key) => !process.env[key]);
  if (missing.length) throw new Error("Server configuration is incomplete: " + missing.join(", "));
  return {
    url: process.env.SUPABASE_URL.replace(/\/$/, ""),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    password: process.env.ADMIN_PASSWORD,
    secret: process.env.ADMIN_SESSION_SECRET,
  };
}
function signature(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
function makeCookie(secret) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_SECONDS * 1000, nonce: randomBytes(12).toString("hex") })).toString("base64url");
  return `${COOKIE_NAME}=${payload}.${signature(payload, secret)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
}
function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
function cookies(event) {
  const header = event.headers.cookie || event.headers.Cookie || "";
  return Object.fromEntries(header.split(";").map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter((pair) => pair.length === 2));
}
function validSession(event, secret) {
  const token = cookies(event)[COOKIE_NAME];
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const supplied = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(payload, secret));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number.isFinite(data.exp) && data.exp > Date.now();
  } catch { return false; }
}
function safeEqual(a, b) {
  const left = createHmac("sha256", "ocv-password-check").update(a).digest();
  const right = createHmac("sha256", "ocv-password-check").update(b).digest();
  return timingSafeEqual(left, right);
}
function checkOrigin(event) {
  const origin = event.headers.origin;
  const host = event.headers.host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
async function supabase(config, path, options = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Database request failed (${response.status}): ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}
function slugBase(title) {
  return title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "event";
}
async function uniqueSlug(config, title) {
  const base = slugBase(title);
  for (let i = 0; i < 8; i++) {
    const suffix = i === 0 ? "" : "-" + randomBytes(2).toString("hex");
    const slug = (base.slice(0, 39 - suffix.length) + suffix).slice(0, 40);
    const rows = await supabase(config, `events?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`);
    if (!rows.length) return slug;
  }
  throw new Error("Could not generate a unique event link. Please try again.");
}
function validateEvent(body, creating) {
  if (!body || typeof body !== "object") throw new Error("Invalid event details.");
  const title = String(body.title || "").trim();
  const ticketUrl = String(body.ticket_url || "").trim();
  const platform = String(body.platform || "other");
  if (!title || title.length > 180) throw new Error("Enter an event title (maximum 180 characters).");
  let parsed;
  try { parsed = new URL(ticketUrl); } catch { throw new Error("Enter a valid ticket URL."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Ticket URL must use HTTP or HTTPS.");
  if (!PLATFORMS.includes(platform)) throw new Error("Select a supported platform.");
  const city = body.city == null ? null : String(body.city).trim().slice(0, 100) || null;
  const eventDate = body.event_date || null;
  if (eventDate && !Number.isFinite(Date.parse(eventDate))) throw new Error("Enter a valid event date.");
  return { title, ticket_url: parsed.toString(), platform, city, event_date: eventDate, ...(creating ? {} : {}) };
}
exports.handler = async (event) => {
  let config;
  try { config = env(); } catch (error) { return json(503, { error: error.message }); }
  const action = event.queryStringParameters?.action || "";
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (["login", "logout"].includes(action) && event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  if (action === "login") {
    if (!checkOrigin(event)) return json(403, { error: "Request origin could not be verified." });
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid request." }); }
    const password = typeof body.password === "string" ? body.password : "";
    if (!password || !safeEqual(password, config.password)) return json(401, { error: "Incorrect password." });
    return json(200, { ok: true }, { "set-cookie": makeCookie(config.secret) });
  }
  if (action === "logout") return json(200, { ok: true }, { "set-cookie": clearCookie() });
  if (!validSession(event, config.secret)) return json(401, { error: "Please sign in to continue." });
  if (action === "me" && event.httpMethod === "GET") return json(200, { authenticated: true });
  try {
    if (action === "events" && event.httpMethod === "GET") {
      const events = await supabase(config, "events?select=id,title,ticket_url,platform,city,event_date,slug,status,created_at&order=created_at.desc");
      const clicks = await supabase(config, "clicks?select=event_id,visitor_hash,is_bot");
      const stats = new Map();
      for (const click of clicks || []) {
        if (click.is_bot) continue;
        const item = stats.get(click.event_id) || { genuine_clicks: 0, visitors: new Set() };
        item.genuine_clicks++;
        if (click.visitor_hash) item.visitors.add(click.visitor_hash);
        stats.set(click.event_id, item);
      }
      return json(200, { events: events.map((item) => ({ ...item, genuine_clicks: stats.get(item.id)?.genuine_clicks || 0, unique_visitors: stats.get(item.id)?.visitors.size || 0 })) });
    }
    if (action === "event" && event.httpMethod === "GET") {
      const id = event.queryStringParameters?.id || "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Invalid event id." });
      const rows = await supabase(config, `events?select=id,title,ticket_url,platform,city,event_date,slug,status&id=eq.${id}&limit=1`);
      if (!rows.length) return json(404, { error: "Event not found." });
      return json(200, { event: rows[0] });
    }
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
    if (!checkOrigin(event)) return json(403, { error: "Request origin could not be verified." });
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid request." }); }
    if (action === "create") {
      const values = validateEvent(body, true);
      const slug = await uniqueSlug(config, values.title);
      const rows = await supabase(config, "events?select=id,title,ticket_url,platform,city,event_date,slug,status,created_at", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({ ...values, slug }) });
      return json(201, { event: rows[0] });
    }
    if (action === "update") {
      if (!/^[0-9a-f-]{36}$/i.test(body.id || "")) return json(400, { error: "Invalid event id." });
      const values = validateEvent(body, false);
      const rows = await supabase(config, `events?id=eq.${body.id}&select=id,title,ticket_url,platform,city,event_date,slug,status`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify(values) });
      if (!rows.length) return json(404, { error: "Event not found." });
      return json(200, { event: rows[0] });
    }
    if (action === "archive") {
      if (!/^[0-9a-f-]{36}$/i.test(body.id || "")) return json(400, { error: "Invalid event id." });
      const rows = await supabase(config, `events?id=eq.${body.id}&select=id,status`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ status: "archived" }) });
      if (!rows.length) return json(404, { error: "Event not found." });
      return json(200, { event: rows[0] });
    }
    return json(404, { error: "Unknown admin action." });
  } catch (error) {
    console.error("Admin request failed:", error);
    return json(500, { error: error.message || "The request could not be completed." });
  }
};