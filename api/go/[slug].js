const { createHash } = require("node:crypto");

const allowedSources = new Set(["instagram", "tiktok", "whatsapp", "x", "facebook", "other"]);
const botPattern = /bot|crawler|spider|preview|facebookexternalhit|facebot|twitterbot|slackbot|telegrambot|linkedinbot|googlebot|discordbot|pinterestbot|applebot|bingbot|embedly|quora link preview/i;

function page(res, message, status) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OurCityVibe</title><body style="margin:0;background:#0b1713;color:#f4f5ef;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:460px;padding:32px"><p style="color:#8bd5a5;font-weight:700;letter-spacing:2px">OURCITYVIBE</p><h1 style="font-size:32px">${message}</h1><p style="color:#a6b5ab">The event link may be unavailable or no longer active.</p></main></body></html>`);
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : (value || "");
}

function makeVisitorHash(ip, userAgent, secret) {
  const date = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${userAgent}|${date}|${secret}`).digest("hex");
}

function getDevice(userAgent) {
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobile|android|iphone|ipod/i.test(userAgent)) return "mobile";
  if (!userAgent) return "unknown";
  return "desktop";
}

async function logClick(url, key, row) {
  const response = await fetch(`${url}/rest/v1/clicks`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`Click insert failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
}

module.exports = async function trackEvent(req, res) {
  const rawSlug = req.query && req.query.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : String(rawSlug || "");
  if (!/^[a-z0-9-]{4,40}$/.test(slug)) {
    return page(res, "This event link could not be found.", 404);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hashSecret = process.env.VISITOR_HASH_SECRET;
  if (!supabaseUrl || !serviceKey || !hashSecret) {
    console.error("Tracker environment is not fully configured.");
    return page(res, "This link is temporarily unavailable.", 503);
  }

  const baseUrl = supabaseUrl.replace(/\/$/, "");
  let lookup;
  try {
    lookup = await fetch(
      `${baseUrl}/rest/v1/events?select=id,ticket_url&slug=eq.${encodeURIComponent(slug)}&status=eq.active&limit=1`,
      { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } },
    );
  } catch (error) {
    console.error("Event lookup request failed:", error);
    return page(res, "This link is temporarily unavailable.", 503);
  }

  if (!lookup.ok) {
    console.error("Event lookup failed:", lookup.status);
    return page(res, "This link is temporarily unavailable.", 503);
  }

  const events = await lookup.json();
  const event = events[0];
  if (!event) return page(res, "This event link could not be found.", 404);

  let destination;
  try {
    destination = new URL(event.ticket_url);
    if (!["https:", "http:"].includes(destination.protocol)) throw new Error("Unsupported protocol");
  } catch {
    console.error("Invalid destination URL for event:", event.id);
    return page(res, "This link is temporarily unavailable.", 503);
  }

  const requestUrl = new URL(req.url || "/", `https://${getHeader(req, "host") || "localhost"}`);
  const userAgent = getHeader(req, "user-agent");
  const sourceParam = (requestUrl.searchParams.get("src") || "other").toLowerCase();
  const source = allowedSources.has(sourceParam) ? sourceParam : "other";

  // Do not classify a real WhatsApp in-app tap as a bot.
  const isWhatsAppPreview = /whatsapp\/\d/i.test(userAgent) && !/android|iphone|ipad|mobile/i.test(userAgent);
  const isBot = botPattern.test(userAgent) || isWhatsAppPreview;

  // Vercel supplies the client IP in x-forwarded-for. It is used only to
  // create a daily hash and is never written to the database.
  const forwardedFor = getHeader(req, "x-forwarded-for");
  const ip = forwardedFor.split(",")[0].trim() || getHeader(req, "x-real-ip");
  const visitorHash = ip ? makeVisitorHash(ip, userAgent, hashSecret) : null;
  const country = getHeader(req, "x-vercel-ip-country") || null;
  const referrer = getHeader(req, "referer");

  const row = {
    event_id: event.id,
    referrer: referrer ? referrer.slice(0, 2048) : null,
    src: source,
    device_type: getDevice(userAgent),
    country,
    visitor_hash: visitorHash,
    is_bot: isBot,
  };

  // Await the insert (but never block the redirect on a logging failure).
  try {
    await logClick(baseUrl, serviceKey, row);
  } catch (error) {
    console.error("Unable to record tracked visit:", error);
  }

  res.statusCode = 302;
  res.setHeader("location", destination.toString());
  res.setHeader("cache-control", "no-store");
  return res.end();
};
