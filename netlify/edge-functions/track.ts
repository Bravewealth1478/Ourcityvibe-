import type { Config, Context } from "@netlify/edge-functions";

const allowedSources = new Set(["instagram", "tiktok", "whatsapp", "x", "facebook", "other"]);
const botPattern = /bot|crawler|spider|preview|facebookexternalhit|facebot|twitterbot|slackbot|telegrambot|linkedinbot|googlebot|discordbot|pinterestbot|applebot|bingbot|embedly|quora link preview/i;

function page(message: string, status: number) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OurCityVibe</title><body style="margin:0;background:#0b1713;color:#f4f5ef;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:460px;padding:32px"><p style="color:#8bd5a5;font-weight:700;letter-spacing:2px">OURCITYVIBE</p><h1 style="font-size:32px">${message}</h1><p style="color:#a6b5ab">The event link may be unavailable or no longer active.</p></main></body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function makeVisitorHash(ip: string, userAgent: string, secret: string): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  const data = new TextEncoder().encode(`${ip}|${userAgent}|${date}|${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getDevice(userAgent: string): string {
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobile|android|iphone|ipod/i.test(userAgent)) return "mobile";
  if (!userAgent) return "unknown";
  return "desktop";
}

async function logClick(url: string, key: string, row: Record<string, unknown>) {
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
  if (!response.ok) throw new Error(`Click insert failed: ${response.status} ${await response.text()}`);
}

export default async function handler(request: Request, context: Context): Promise<Response> {
  const slug = context.params.slug;
  if (!slug || !/^[a-z0-9-]{4,40}$/.test(slug)) return page("This event link could not be found.", 404);

  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hashSecret = Netlify.env.get("VISITOR_HASH_SECRET");
  if (!supabaseUrl || !serviceKey || !hashSecret) {
    console.error("Tracker environment is not fully configured.");
    return page("This link is temporarily unavailable.", 503);
  }

  const lookup = await fetch(
    `${supabaseUrl}/rest/v1/events?select=id,ticket_url&slug=eq.${encodeURIComponent(slug)}&status=eq.active&limit=1`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } },
  );
  if (!lookup.ok) {
    console.error("Event lookup failed:", lookup.status);
    return page("This link is temporarily unavailable.", 503);
  }
  const events = await lookup.json() as Array<{ id: string; ticket_url: string }>;
  const event = events[0];
  if (!event) return page("This event link could not be found.", 404);

  let destination: URL;
  try {
    destination = new URL(event.ticket_url);
    if (destination.protocol !== "https:" && destination.protocol !== "http:") throw new Error("Unsupported protocol");
  } catch {
    console.error("Invalid destination URL for event:", event.id);
    return page("This event link is temporarily unavailable.", 503);
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  const sourceParam = new URL(request.url).searchParams.get("src")?.toLowerCase() ?? "other";
  const source = allowedSources.has(sourceParam) ? sourceParam : "other";
  // WhatsApp's real in-app browser identifies as Android/iOS. Only classify its
  // standalone preview-style user agent as a bot, not a person's actual tap.
  const isWhatsAppPreview = /whatsapp\/\d/i.test(userAgent) && !/android|iphone|ipad|mobile/i.test(userAgent);
  const isBot = botPattern.test(userAgent) || isWhatsAppPreview;
  const ip = context.ip ?? "";
  const visitorHash = ip ? await makeVisitorHash(ip, userAgent, hashSecret) : null;
  const referrer = request.headers.get("referer");
  const row = {
    event_id: event.id,
    referrer: referrer ? referrer.slice(0, 2048) : null,
    src: source,
    device_type: getDevice(userAgent),
    country: context.geo.country?.code ?? null,
    visitor_hash: visitorHash,
    is_bot: isBot,
  };

  context.waitUntil(logClick(supabaseUrl, serviceKey, row).catch((error) => {
    console.error("Unable to record tracked visit:", error);
  }));

  return Response.redirect(destination.toString(), 302);
}

export const config: Config = { path: "/go/:slug" };