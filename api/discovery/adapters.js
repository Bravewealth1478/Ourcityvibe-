"use strict";
const dns = require("node:dns/promises");
const net = require("node:net");

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const UA = "OurCityVibeEventDiscovery/1.0 (+https://ourcityvibe.vercel.app)";

function decode(s = "") {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ");
}
function clean(s = "") { return decode(String(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
function urlOf(value, base) {
  try { const u = new URL(String(value), base); if (!["http:", "https:"].includes(u.protocol)) return null; u.username = ""; u.password = ""; return u.toString(); }
  catch { return null; }
}
function dateOf(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function countryCode(value) {
  const s = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}
function normalise(raw, source, sourceUrl) {
  const loc = raw.location && typeof raw.location === "object" ? raw.location : {};
  const addr = loc.address && typeof loc.address === "object" ? loc.address : {};
  const offers = Array.isArray(raw.offers) ? raw.offers[0] : (raw.offers || {});
  const img = Array.isArray(raw.image) ? raw.image[0] : raw.image;
  const title = clean(raw.name || raw.title || raw.summary || "");
  if (!title) return null;
  const country = raw.country || raw.addressCountry || addr.addressCountry || null;
  const min = Number(offers.lowPrice ?? offers.price ?? raw.price_min);
  const max = Number(offers.highPrice ?? raw.price_max);
  const ticket = urlOf(raw.url || raw.ticket_url || raw.ticketUrl, sourceUrl);
  return {
    external_id: raw.identifier ? String(raw.identifier.value || raw.identifier) : (raw.id == null ? null : String(raw.id)),
    title: title.slice(0, 300),
    description: clean(raw.description || raw.content || "").slice(0, 12000) || null,
    category: clean(raw.category || raw.genre || "").slice(0, 120) || null,
    organizer_name: clean(raw.organizer && (raw.organizer.name || raw.organizer) || raw.organizer_name || "").slice(0, 240) || null,
    venue_name: clean(loc.name || raw.venue_name || raw.venue || "").slice(0, 240) || null,
    address: clean([addr.streetAddress, addr.postalCode].filter(Boolean).join(", ") || raw.address || "").slice(0, 500) || null,
    city: clean(raw.city || raw.addressLocality || addr.addressLocality || "").slice(0, 120) || null,
    region: clean(raw.region || raw.addressRegion || addr.addressRegion || "").slice(0, 120) || null,
    country: clean(typeof country === "object" ? country.name || country.identifier : country || "").slice(0, 120) || null,
    country_code: countryCode(raw.country_code || raw.countryCode || (typeof country === "object" ? country.identifier : null)),
    timezone: raw.timezone || raw.timeZone || null,
    event_date: dateOf(raw.startDate || raw.start_date || raw.start || raw.eventDate || raw.date),
    end_date: dateOf(raw.endDate || raw.end_date || raw.end),
    ticket_url: ticket,
    source_url: urlOf(sourceUrl, source && source.base_url),
    image_url: urlOf(img && (img.url || img) || raw.image_url, sourceUrl),
    currency: offers.priceCurrency || raw.currency || null,
    price_min: Number.isFinite(min) && min >= 0 ? min : null,
    price_max: Number.isFinite(max) && max >= 0 ? max : null,
    popularity_signals: {},
    source_payload: raw
  };
}
function blocks(xml, tag) {
  const re = new RegExp("<(?:[\\w.-]+:)?" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + tag + "\\s*>", "gi");
  const out = []; let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function value(block, tag) {
  const re = new RegExp("<(?:[\\w.-]+:)?" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + tag + "\\s*>", "i");
  const m = re.exec(block);
  return m ? clean(m[1]) : "";
}
function attr(block, tag, name) {
  const m = new RegExp("<(?:[\\w.-]+:)?" + tag + "\\b([^>]*)>", "i").exec(block);
  if (!m) return "";
  const a = new RegExp("\\b" + name + "\\s*=\\s*['" + '"' + "]([^'" + '"' + "]+)['" + '"' + "]", "i").exec(m[1]);
  return a ? decode(a[1]) : "";
}
function parseRssAtom(xml, source) {
  const atom = /<feed(?:\s|>)/i.test(xml);
  return blocks(xml, atom ? "entry" : "item").map((b) => normalise({
    id: value(b, "guid") || value(b, "id"),
    title: value(b, "title"),
    description: value(b, "description") || value(b, "summary") || value(b, "content"),
    startDate: value(b, "startDate") || value(b, "eventDate") || value(b, "pubDate") || value(b, "published") || value(b, "updated"),
    url: atom ? (attr(b, "link", "href") || value(b, "link")) : value(b, "link"),
    category: value(b, "category"),
    image: attr(b, "enclosure", "url") || attr(b, "image", "href")
  }, source, source.base_url)).filter(Boolean);
}
function parseIcalDate(v) {
  if (!v) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return dateOf(v);
  return dateOf(m[1] + "-" + m[2] + "-" + m[3] + "T" + (m[4] || "00") + ":" + (m[5] || "00") + ":" + (m[6] || "00") + "Z");
}
function parseIcal(text, source) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  return unfolded.split(/BEGIN:VEVENT\s*/i).slice(1).map(part => {
    const block = part.split(/END:VEVENT/i)[0];
    const lines = block.split(/\r?\n/);
    const prop = name => {
      const line = lines.find(x => x.toUpperCase().startsWith(name + ";") || x.toUpperCase().startsWith(name + ":"));
      return line ? line.slice(line.indexOf(":") + 1).trim() : "";
    };
    return normalise({
      id: prop("UID"), title: prop("SUMMARY"), description: prop("DESCRIPTION"),
      startDate: parseIcalDate(prop("DTSTART")), endDate: parseIcalDate(prop("DTEND")),
      url: prop("URL"), venue_name: prop("LOCATION")
    }, source, source.base_url);
  }).filter(Boolean);
}
function walkJsonLd(value, found = []) {
  if (!value) return found;
  if (Array.isArray(value)) { value.forEach(x => walkJsonLd(x, found)); return found; }
  if (typeof value !== "object") return found;
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (types.some(t => /event$/i.test(String(t || "")))) found.push(value);
  if (value["@graph"]) walkJsonLd(value["@graph"], found);
  return found;
}
function parseJsonLd(html, source) {
  const out = []; const re = /<script\b[^>]*type\s*=\s*['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { walkJsonLd(JSON.parse(m[1].trim())).forEach(raw => { const e = normalise(raw, source, source.base_url); if (e) out.push(e); }); }
    catch { /* Ignore malformed JSON-LD blocks. */ }
  }
  return out;
}
function parseJsonApi(body, source) {
  let parsed;
  try { parsed = JSON.parse(body); } catch { throw new Error("The configured JSON source returned invalid JSON."); }
  const path = source.config && typeof source.config.items_path === "string" ? source.config.items_path : "";
  let items = parsed;
  if (path) for (const key of path.split(".").filter(Boolean)) items = items && items[key];
  else if (!Array.isArray(items)) items = items.events || items.items || items.results || items.data || [];
  if (!Array.isArray(items)) throw new Error("JSON source did not contain an event array. Configure items_path.");
  return items.map(raw => normalise(raw, source, source.base_url)).filter(Boolean);
}
function blockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a,b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    return s === "::" || s === "::1" || s.startsWith("fc") || s.startsWith("fd") ||
      s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb");
  }
  return true;
}
async function assertPublicHost(value) {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only HTTP and HTTPS sources are supported.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Local network sources are not allowed.");
  if (net.isIP(host)) { if (blockedIp(host)) throw new Error("Private or reserved network addresses are not allowed."); return; }
  const resolved = await dns.lookup(host, { all: true, verbatim: true });
  if (!resolved.length || resolved.some(x => blockedIp(x.address))) throw new Error("Source host resolves to a private or reserved network address.");
}
async function fetchSource(source) {
  let current = urlOf(source.base_url);
  if (!current) throw new Error("Source URL must be HTTP or HTTPS.");
  for (let i = 0; i <= 3; i++) {
    await assertPublicHost(current);
    const response = await fetch(current, {
      redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": UA, accept: "application/json, application/rss+xml, application/atom+xml, text/calendar, application/xml, text/xml, text/html;q=0.9, */*;q=0.1" }
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || i === 3) throw new Error("Source redirected too many times or omitted its redirect target.");
      current = urlOf(location, current);
      if (!current) throw new Error("Source returned an unsafe redirect URL.");
      continue;
    }
    if (!response.ok) throw new Error("Source returned HTTP " + response.status + ".");
    if (Number(response.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("Source response exceeds the 2 MB limit.");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) throw new Error("Source response exceeds the 2 MB limit.");
    return { body: new TextDecoder().decode(buffer), contentType: (response.headers.get("content-type") || "").toLowerCase(), finalUrl: current };
  }
  throw new Error("Unable to fetch source.");
}
async function collectFromSource(source) {
  if (!source || source.enabled === false) throw new Error("This source is disabled.");
  const fetched = await fetchSource(source);
  let events;
  switch (source.source_type) {
    case "api": events = parseJsonApi(fetched.body, { ...source, base_url: fetched.finalUrl }); break;
    case "rss": events = parseRssAtom(fetched.body, { ...source, base_url: fetched.finalUrl }); break;
    case "ical": events = parseIcal(fetched.body, { ...source, base_url: fetched.finalUrl }); break;
    case "website":
    case "directory": events = parseJsonLd(fetched.body, { ...source, base_url: fetched.finalUrl }); break;
    default: throw new Error("Unsupported source type: " + source.source_type);
  }
  return { events, fetched_url: fetched.finalUrl, content_type: fetched.contentType, fetched_at: new Date().toISOString() };
}
module.exports = { collectFromSource, parseJsonApi, parseRssAtom, parseIcal, parseJsonLd, normalise };
