const { createHmac, timingSafeEqual, randomBytes, createHash } = require("node:crypto");
const { collectFromSource } = require("../../api/discovery/adapters");

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
  const authHeaders = { apikey: config.key };
  // Supabase's newer sb_secret_* keys are opaque API keys, not JWTs.
  // They must be sent as apikey only, never as Authorization: Bearer.
  if (!config.key.startsWith("sb_secret_")) {
    authHeaders.authorization = `Bearer ${config.key}`;
  }
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...authHeaders,
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
  let imageUrl = null;
  if (body.image_url) {
    try { const image = new URL(String(body.image_url)); if (!["http:", "https:"].includes(image.protocol)) throw new Error(); imageUrl = image.toString(); }
    catch { throw new Error("Enter a valid image URL or leave it blank."); }
  }
  return { title, ticket_url: parsed.toString(), platform, city, event_date: eventDate, image_url: imageUrl };
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
  if (action === "candidates" && event.httpMethod === "GET") {
    try {
      const status = ["pending","duplicate","rejected","approved"].includes(event.queryStringParameters?.status) ? event.queryStringParameters.status : "pending";
      const candidates = await supabase(config, "discovered_events?select=id,source_id,discovery_run_id,title,description,category,organizer_name,venue_name,address,city,region,country,country_code,event_date,end_date,ticket_url,source_url,image_url,currency,price_min,price_max,popularity_score,review_status,duplicate_of,review_note,approved_event_id,first_seen_at,last_seen_at,event_sources(name,source_type)&review_status=eq." + status + "&order=event_date.asc.nullslast,created_at.desc&limit=100");
      return json(200, { candidates });
    } catch (error) { return json(500, { error: error.message }); }
  }
  if (action === "sources" && event.httpMethod === "GET") {
    try {
      const sources = await supabase(config, "event_sources?select=id,name,source_type,base_url,enabled,country_scope,country_codes,config,last_checked_at,last_success_at,last_error,created_at,updated_at&order=created_at.desc");
      return json(200, { sources: sources.map((source) => {
        const credentialName = source.config?.auth_header_env || source.config?.auth_query_env || null;
        return { ...source, credential_name: credentialName, credential_ready: !credentialName || Boolean(process.env[credentialName]) };
      }) });
    } catch (error) { console.error("Source listing failed:", error); return json(500, { error: error.message }); }
  }
  try {
    if (action === "promo-caption" && event.httpMethod === "GET") {
      const id = event.queryStringParameters?.id || "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Invalid event id." });
      const rows = await supabase(config, "event_promo_captions?select=id,event_id,caption,short_caption,affiliate_disclosure,status,model,generated_at,updated_at,approved_at&event_id=eq." + id + "&limit=1");
      return json(200, { draft: rows[0] || null });
    }
    if (action === "promo-generate" && event.httpMethod === "POST") {
      if (!process.env.OPENAI_API_KEY) return json(503, { error: "AI captions are not configured yet. Add OPENAI_API_KEY to the Netlify environment variables, then redeploy." });
      if (!/^[0-9a-f-]{36}$/i.test(body.id || "")) return json(400, { error: "Invalid event id." });
      const events = await supabase(config, "events?select=id,title,description,city,event_date,venue_name,organizer_name,ticket_url,slug,status&id=eq." + body.id + "&limit=1");
      if (!events.length || events[0].status !== "active") return json(404, { error: "Active event not found." });
      const item = events[0];
      const trackedLink = "https://" + String(event.headers.host || "ourcityvibe.vercel.app") + "/go/" + item.slug;
      const disclosure = String(body.affiliate_disclosure || process.env.AFFILIATE_DISCLOSURE || "").trim().slice(0, 500);
      const facts = { title: item.title, city: item.city, venue: item.venue_name, organizer: item.organizer_name, date: item.event_date, description: item.description, ticket_url: item.ticket_url, tracked_link: trackedLink };
      const prompt = ["Write promotional copy using only supplied event facts. Do not invent performers, prices, availability, venue details, dates, urgency, or claims.", "Create two versions: a concise storytelling social caption and a very short WhatsApp Status / Stories version.", "Use a natural, inviting voice. Include the tracked link exactly as supplied in BOTH versions. Do not add unsupported hashtags.", "Return strict JSON with string fields caption and short_caption. No markdown fences.", "Event facts: " + JSON.stringify(facts)].join("\n\n");
      const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer " + process.env.OPENAI_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", temperature: 0.7, response_format: { type: "json_object" }, messages: [{ role: "system", content: "You are a careful event copywriter. Never invent event facts." }, { role: "user", content: prompt }] }), signal: AbortSignal.timeout(30000) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("AI caption generation failed (" + response.status + "): " + (result.error?.message || "Provider request failed."));
      let generated;
      try { generated = JSON.parse(result.choices?.[0]?.message?.content || "{}"); } catch { throw new Error("The AI returned an unreadable caption. Please try again."); }
      const caption = String(generated.caption || "").trim().slice(0, 5000);
      const shortCaption = String(generated.short_caption || "").trim().slice(0, 1500);
      if (!caption || !shortCaption) throw new Error("The AI did not return both caption versions. Please try again.");
      const now = new Date().toISOString();
      const values = { event_id: item.id, caption, short_caption: shortCaption, affiliate_disclosure: disclosure || null, status: "draft", model: process.env.OPENAI_MODEL || "gpt-4o-mini", generated_at: now, updated_at: now, approved_at: null };
      const saved = await supabase(config, "event_promo_captions?on_conflict=event_id", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(values) });
      return json(200, { draft: saved[0] || values });
    }
    if (action === "promo-save" && event.httpMethod === "POST") {
      if (!/^[0-9a-f-]{36}$/i.test(body.id || "")) return json(400, { error: "Invalid event id." });
      const caption = String(body.caption || "").trim(), shortCaption = String(body.short_caption || "").trim(), disclosure = String(body.affiliate_disclosure || "").trim().slice(0, 500);
      if (!caption || caption.length > 5000 || !shortCaption || shortCaption.length > 1500) return json(400, { error: "Both caption versions are required and must be within the length limits." });
      const now = new Date().toISOString();
      const values = { event_id: body.id, caption, short_caption: shortCaption, affiliate_disclosure: disclosure || null, status: body.approve ? "approved" : "draft", updated_at: now, approved_at: body.approve ? now : null };
      const saved = await supabase(config, "event_promo_captions?on_conflict=event_id", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(values) });
      return json(200, { draft: saved[0] || values });
    }
    if (action === "events" && event.httpMethod === "GET") {
      const events = await supabase(config, "events?select=id,title,ticket_url,platform,city,event_date,image_url,slug,status,created_at&order=created_at.desc");
      const statsRows = await supabase(config, "rpc/admin_event_click_stats", { method: "POST", body: "{}" });
      const stats = new Map((statsRows || []).map((item) => [item.event_id, item]));
      return json(200, { events: events.map((item) => ({ ...item, genuine_clicks: Number(stats.get(item.id)?.genuine_clicks || 0), unique_visitors: Number(stats.get(item.id)?.unique_visitors || 0) })) });
    }
    if (action === "reports" && event.httpMethod === "GET") {
      const requestedDays = Number.parseInt(event.queryStringParameters?.days || "30", 10);
      const days = Number.isFinite(requestedDays) ? Math.max(1, Math.min(365, requestedDays)) : 30;
      const rows = await supabase(config, "rpc/admin_reporting_summary", { method: "POST", body: JSON.stringify({ p_days: days }) });
      return json(200, { report: rows });
    }
    if (action === "event" && event.httpMethod === "GET") {
      const id = event.queryStringParameters?.id || "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Invalid event id." });
      const rows = await supabase(config, `events?select=id,title,ticket_url,platform,city,event_date,image_url,slug,status&id=eq.${id}&limit=1`);
      if (!rows.length) return json(404, { error: "Event not found." });
      return json(200, { event: rows[0] });
    }
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
    if (!checkOrigin(event)) return json(403, { error: "Request origin could not be verified." });
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid request." }); }
    if (action === "collect" && event.httpMethod === "POST") {
      const sourceId = body.source_id ? String(body.source_id) : null;
      if (sourceId && !/^[0-9a-f-]{36}$/i.test(sourceId)) return json(400, { error: "Invalid source id." });
      const sourceFilter = sourceId ? "&id=eq." + sourceId : "";
      const offset = Math.max(0, Math.min(10000, Number.parseInt(body.offset || "0", 10) || 0));
      const sources = await supabase(config, "event_sources?select=id,name,source_type,base_url,enabled,country_scope,country_codes,config&id=not.is.null" + sourceFilter + "&enabled=eq.true&source_type=neq.manual&order=created_at.asc&limit=1&offset=" + offset);
      if (!sources.length) return json(200, { results: [], message: "No discovery sources are configured yet. Add your sources once in Advanced source settings, then Fetch Events will run them for you." });
      const summaries = [];
      for (const source of sources) {
        const requiredCredential = source.config?.auth_header_env || source.config?.auth_query_env || null;
        if (requiredCredential && !process.env[requiredCredential]) {
          summaries.push({ source_id: source.id, source_name: source.name, status: "skipped", items_seen: 0, items_created: 0, items_updated: 0, duplicates_found: 0, error: null, note: "Waiting for " + requiredCredential + " to be configured in Vercel." });
          continue;
        }
        const runRows = await supabase(config, "discovery_runs?select=id", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({ source_id: source.id, trigger_type: "manual", status: "running" }) });
        const runId = runRows[0].id;
        let seen = 0, created = 0, updated = 0, duplicates = 0, runError = null;
        try {
          const result = await collectFromSource(source);
          for (const candidate of result.events.slice(0, 500)) {
            seen++;
            const fingerprintBase = [candidate.title, candidate.event_date || "", candidate.city || "", candidate.country_code || ""].join("|").toLowerCase().replace(/\s+/g, " ").trim();
            const fingerprint = createHash("sha256").update(fingerprintBase).digest("hex");
            const external = candidate.external_id ? String(candidate.external_id).slice(0, 500) : null;
            let existing = [];
            if (external) existing = await supabase(config, "discovered_events?select=id,review_status&source_id=eq." + source.id + "&external_id=eq." + encodeURIComponent(external) + "&limit=1");
            if (!existing.length) existing = await supabase(config, "discovered_events?select=id,review_status&source_id=eq." + source.id + "&fingerprint=eq." + fingerprint + "&limit=1");
            const payload = {
              source_id: source.id, discovery_run_id: runId, external_id: external,
              title: candidate.title, description: candidate.description, category: candidate.category,
              organizer_name: candidate.organizer_name, venue_name: candidate.venue_name, address: candidate.address,
              city: candidate.city, region: candidate.region, country: candidate.country, country_code: candidate.country_code,
              timezone: candidate.timezone, event_date: candidate.event_date, end_date: candidate.end_date,
              ticket_url: candidate.ticket_url, source_url: candidate.source_url, image_url: candidate.image_url,
              currency: candidate.currency, price_min: candidate.price_min, price_max: candidate.price_max,
              popularity_signals: candidate.popularity_signals || {}, fingerprint,
              source_payload: (() => { const raw = JSON.stringify(candidate.source_payload || {}); return raw.length <= 50000 ? (candidate.source_payload || {}) : { truncated: true, preview: raw.slice(0, 49000) }; })(),
              last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString()
            };
            if (existing.length) {
              await supabase(config, "discovered_events?id=eq." + existing[0].id, { method: "PATCH", body: JSON.stringify(payload) });
              updated++;
              continue;
            }
            const crossSource = await supabase(config, "discovered_events?select=id,review_status&fingerprint=eq." + fingerprint + "&limit=1");
            if (crossSource.length) {
              payload.review_status = "duplicate";
              payload.duplicate_of = crossSource[0].id;
              duplicates++;
            }
            await supabase(config, "discovered_events", { method: "POST", body: JSON.stringify(payload), headers: { prefer: "return=minimal" } });
            created++;
          }
          await supabase(config, "discovery_runs?id=eq." + runId, { method: "PATCH", body: JSON.stringify({ status: "succeeded", finished_at: new Date().toISOString(), items_seen: seen, items_created: created, items_updated: updated, duplicates_found: duplicates, metadata: { fetched_url: result.fetched_url, content_type: result.content_type } }) });
          await supabase(config, "event_sources?id=eq." + source.id, { method: "PATCH", body: JSON.stringify({ last_checked_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }) });
        } catch (error) {
          runError = String(error.message || "Collection failed").slice(0, 1000);
          await supabase(config, "discovery_runs?id=eq." + runId, { method: "PATCH", body: JSON.stringify({ status: seen ? "partial" : "failed", finished_at: new Date().toISOString(), items_seen: seen, items_created: created, items_updated: updated, duplicates_found: duplicates, error_message: runError }) });
          await supabase(config, "event_sources?id=eq." + source.id, { method: "PATCH", body: JSON.stringify({ last_checked_at: new Date().toISOString(), last_error: runError, updated_at: new Date().toISOString() }) });
        }
        summaries.push({ source_id: source.id, source_name: source.name, status: runError ? "failed" : "succeeded", items_seen: seen, items_created: created, items_updated: updated, duplicates_found: duplicates, error: runError });
      }
      return json(200, { results: summaries });
    }
    if (action === "candidate-approve") {
      if (!/^[0-9a-f-]{36}$/i.test(body.id || "")) return json(400, { error: "Invalid candidate id." });
      const candidates = await supabase(config, "discovered_events?select=*&id=eq." + body.id + "&limit=1");
      if (!candidates.length) return json(404, { error: "Candidate not found." });
      const candidate = candidates[0];
      if (candidate.review_status !== "pending") return json(409, { error: "Only pending candidates can be approved." });
      let ticketUrl;
      try { ticketUrl = new URL(String(body.ticket_url || candidate.ticket_url || "")); } catch { return json(400, { error: "Add a valid event or ticket URL before approval." }); }
      if (!["http:","https:"].includes(ticketUrl.protocol)) return json(400, { error: "Ticket URL must use HTTP or HTTPS." });
      const platform = /ticketmaster/i.test(ticketUrl.hostname) ? "ticketmaster" : /eventbrite/i.test(ticketUrl.hostname) ? "eventbrite" : /posh/i.test(ticketUrl.hostname) ? "posh" : "other";
      const slug = await uniqueSlug(config, candidate.title);
      const eventValues = {
        title: candidate.title, ticket_url: ticketUrl.toString(), platform, city: candidate.city,
        event_date: candidate.event_date, image_url: candidate.image_url, slug, status: "active",
        discovered_event_id: candidate.id, description: candidate.description, venue_name: candidate.venue_name,
        region: candidate.region, country: candidate.country, country_code: candidate.country_code,
        timezone: candidate.timezone, organizer_name: candidate.organizer_name, source_url: candidate.source_url
      };
      const created = await supabase(config, "events?select=id,title,slug,status", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(eventValues) });
      try {
        await supabase(config, "discovered_events?id=eq." + candidate.id, { method: "PATCH", body: JSON.stringify({ ticket_url: ticketUrl.toString(), review_status: "approved", approved_event_id: created[0].id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      } catch (error) {
        await supabase(config, "events?id=eq." + created[0].id, { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
        throw error;
      }
      return json(201, { event: created[0] });
    }
    if (action === "candidate-reject") {
      if (!/^[0-9a-f-]{36}$/i.test(body.id || "")) return json(400, { error: "Invalid candidate id." });
      const rows = await supabase(config, "discovered_events?id=eq." + body.id + "&review_status=eq.pending&select=id,review_status", { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ review_status: "rejected", review_note: String(body.note || "").slice(0, 1000) || null, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      if (!rows.length) return json(404, { error: "Pending candidate not found." });
      return json(200, { candidate: rows[0] });
    }
    if (action === "source-create" || action === "source-update") {
      const id = body.id;
      if (action === "source-update" && !/^[0-9a-f-]{36}$/i.test(id || "")) return json(400, { error: "Invalid source id." });
      const name = String(body.name || "").trim();
      const sourceType = String(body.source_type || "");
      let parsedUrl;
      try { parsedUrl = new URL(String(body.base_url || "")); } catch { return json(400, { error: "Enter a valid source URL." }); }
      if (!name || name.length > 120) return json(400, { error: "Enter a source name (maximum 120 characters)." });
      if (!["http:", "https:"].includes(parsedUrl.protocol)) return json(400, { error: "Source URL must use HTTP or HTTPS." });
      if (!["api","rss","ical","website","directory","manual"].includes(sourceType)) return json(400, { error: "Choose a supported source type." });
      const scope = String(body.country_scope || "global");
      if (!["global","country","regional","local"].includes(scope)) return json(400, { error: "Choose a valid coverage scope." });
      const codes = Array.isArray(body.country_codes) ? [...new Set(body.country_codes.map(x => String(x).trim().toUpperCase()).filter(Boolean))] : [];
      if (codes.some(x => !/^[A-Z]{2}$/.test(x))) return json(400, { error: "Country codes must be two-letter ISO codes." });
      if (scope !== "global" && !codes.length) return json(400, { error: "Add at least one two-letter country code for this scope." });
      let sourceConfig = {};
      try { sourceConfig = typeof body.config === "string" ? JSON.parse(body.config || "{}") : (body.config || {}); } catch { return json(400, { error: "Source configuration must be valid JSON." }); }
      if (!sourceConfig || Array.isArray(sourceConfig) || typeof sourceConfig !== "object") return json(400, { error: "Source configuration must be a JSON object." });
      const values = { name, source_type: sourceType, base_url: parsedUrl.toString(), enabled: body.enabled !== false, country_scope: scope, country_codes: codes, config: sourceConfig };
      const rows = action === "source-create"
        ? await supabase(config, "event_sources?select=id,name,source_type,base_url,enabled,country_scope,country_codes,config,created_at", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(values) })
        : await supabase(config, "event_sources?id=eq." + id + "&select=id,name,source_type,base_url,enabled,country_scope,country_codes,config,updated_at", { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }) });
      if (!rows.length) return json(404, { error: "Source not found." });
      return json(action === "source-create" ? 201 : 200, { source: rows[0] });
    }
    if (action === "source-toggle") {
      if (!/^[0-9a-f-]{36}$/i.test(body.id || "")) return json(400, { error: "Invalid source id." });
      const rows = await supabase(config, "event_sources?id=eq." + body.id + "&select=id,enabled", { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ enabled: Boolean(body.enabled), updated_at: new Date().toISOString() }) });
      if (!rows.length) return json(404, { error: "Source not found." });
      return json(200, { source: rows[0] });
    }
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