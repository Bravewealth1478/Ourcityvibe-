"use strict";
const dns = require("node:dns/promises");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");

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
  const ticketmasterVenue = raw._embedded && raw._embedded.venues && raw._embedded.venues[0] || {};
  const eventbriteVenue = raw.venue || {};
  const loc = raw.location && typeof raw.location === "object" ? raw.location : ticketmasterVenue;
  const addr = loc.address && typeof loc.address === "object" ? loc.address : (eventbriteVenue.address || {});
  const offers = Array.isArray(raw.offers) ? raw.offers[0] : (raw.offers || raw.priceRanges && raw.priceRanges[0] || {});
  const img = Array.isArray(raw.image) ? raw.image[0] : (Array.isArray(raw.images) ? raw.images[0] : raw.image);
  const title = clean(raw.name && (raw.name.text || raw.name) || raw.title || raw.summary || "");
  if (!title) return null;
  const country = raw.country || raw.addressCountry || addr.addressCountry || null;
  const min = Number(offers.lowPrice ?? offers.price ?? offers.min ?? raw.price_min);
  const max = Number(offers.highPrice ?? offers.max ?? raw.price_max);
  return {
    external_id: raw.identifier ? String(raw.identifier.value || raw.identifier) : (raw.id == null ? null : String(raw.id)),
    title: title.slice(0, 300),
    description: clean(raw.description && (raw.description.text || raw.description) || raw.content || "").slice(0, 12000) || null,
    category: clean(raw.category || raw.genre || "").slice(0, 120) || null,
    organizer_name: clean(raw.organizer && (raw.organizer.name || raw.organizer) || raw.organizer_name || raw.promoter && raw.promoter.name || "").slice(0, 240) || null,
    venue_name: clean(loc.name || raw.venue_name || (typeof raw.venue === "string" ? raw.venue : "") || "").slice(0, 240) || null,
    address: clean([addr.streetAddress, addr.postalCode].filter(Boolean).join(", ") || raw.address || "").slice(0, 500) || null,
    city: clean(raw.city || raw.addressLocality || addr.addressLocality || addr.city || ticketmasterVenue.city && ticketmasterVenue.city.name || "").slice(0, 120) || null,
    region: clean(raw.region || raw.addressRegion || addr.addressRegion || ticketmasterVenue.state && ticketmasterVenue.state.name || "").slice(0, 120) || null,
    country: clean(country && typeof country === "object" ? country.name || country.identifier : country || addr.country || ticketmasterVenue.country && ticketmasterVenue.country.name || "").slice(0, 120) || null,
    country_code: countryCode(raw.country_code || raw.countryCode || addr.country_code || ticketmasterVenue.country && ticketmasterVenue.country.countryCode || (country && typeof country === "object" ? country.identifier : (String(country || "").length === 2 ? country : null))),
    timezone: raw.timezone || raw.timeZone || null,
    event_date: dateOf(raw.startDate || raw.start_date || raw.start && (raw.start.utc || raw.start.dateTime || raw.start.localDate || raw.start) || raw.dates && raw.dates.start && (raw.dates.start.dateTime || raw.dates.start.date) || raw.eventDate || raw.date),
    end_date: dateOf(raw.endDate || raw.end_date || raw.end),
    ticket_url: urlOf(raw.url || raw.ticket_url || raw.ticketUrl, sourceUrl),
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
  return blocks(xml, atom ? "entry" : "item").map(b => normalise({
    id: value(b, "guid") || value(b, "id"),
    title: value(b, "title"),
    description: value(b, "description") || value(b, "summary") || value(b, "content"),
    startDate: value(b, "startDate") || value(b, "eventDate") || value(b, "dtstart"),
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
  const provider = source.config && source.config.provider;
  let items;
  if (provider === "ticketmaster") items = parsed && parsed._embedded && parsed._embedded.events || [];
  else if (provider === "eventbrite") items = parsed && parsed.events || [];
  else {
    const path = source.config && typeof source.config.items_path === "string" ? source.config.items_path : "";
    items = parsed;
    if (path) for (const key of path.split(".").filter(Boolean)) items = items && items[key];
    else if (!Array.isArray(items)) items = items.events || items.items || items.results || items.data || [];
  }
  if (!Array.isArray(items)) throw new Error("JSON source did not contain an event array. Configure items_path.");
  return items.map(raw => {
    if (provider === "eventbrite") {
      const venue = raw.venue || {};
      return normalise({ ...raw, name: raw.name && raw.name.text, description: raw.description && raw.description.text,
        start: raw.start && raw.start.utc, url: raw.url, venue_name: venue.name,
        city: venue.address && venue.address.city, country: venue.address && venue.address.country,
        country_code: venue.address && venue.address.country_code,
        image: raw.logo && raw.logo.url }, source, source.base_url);
    }
    return normalise(raw, source, source.base_url);
  }).filter(Boolean);
}
function blockedIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    const [a,b,c] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 2 || b === 168)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 255 && b === 255 && c === 255);
  }
  if (family === 6) {
    const s = ip.toLowerCase();
    // Only globally-routable unicast space is accepted. This excludes
    // loopback, link-local, unique-local, multicast, mapped and transition ranges.
    if (!(s.startsWith("2") || s.startsWith("3"))) return true;
    if (s.startsWith("2001:db8:") || s.startsWith("2001:10:") || s.startsWith("2001:20:")) return true;
    return false;
  }
  return true;
}
async function resolvePublicAddress(value) {
  const u = new URL(value);
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Local network sources are not allowed.");
  if (net.isIP(host)) {
    if (blockedIp(host)) throw new Error("Private or reserved network addresses are not allowed.");
    return { address: host, family: net.isIP(host) };
  }
  const resolved = await dns.lookup(host, { all: true, verbatim: true });
  if (!resolved.length || resolved.some(x => blockedIp(x.address))) throw new Error("Source host resolves to a private or reserved network address.");
  return resolved[0];
}
function requestPinned(value, resolved, extraHeaders = {}) {
  const u = new URL(value);
  const transport = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const options = {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: "GET",
      headers: {
        "user-agent": UA,
        accept: "application/json, application/rss+xml, application/atom+xml, text/calendar, application/xml, text/xml, text/html;q=0.9",
        ...extraHeaders
      },
      agent: false,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions && lookupOptions.all) callback(null, [resolved]);
        else callback(null, resolved.address, resolved.family);
      },
      ...(u.protocol === "https:" ? { servername: u.hostname } : {})
    };
    const req = transport.request(options, response => {
      const status = response.statusCode || 0;
      if ([301,302,303,307,308].includes(status)) {
        response.resume();
        resolve({ status, location: response.headers.location || null });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        resolve({ status });
        return;
      }
      const length = Number(response.headers["content-length"] || 0);
      if (length > MAX_BYTES) {
        req.destroy(new Error("Source response exceeds the 2 MB limit."));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          req.destroy(new Error("Source response exceeds the 2 MB limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        status,
        body: Buffer.concat(chunks).toString("utf8"),
        contentType: String(response.headers["content-type"] || "").toLowerCase()
      }));
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("Source request timed out.")));
    req.on("error", reject);
    req.end();
  });
}
function allowedContentType(sourceType, contentType) {
  const type = contentType.split(";")[0].trim();
  const allowed = {
    api: ["application/json", "application/ld+json", "text/json", "text/plain"],
    rss: ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml"],
    ical: ["text/calendar", "application/ics", "text/plain"],
    website: ["text/html", "application/xhtml+xml"],
    directory: ["text/html", "application/xhtml+xml"],
  };
  return (allowed[sourceType] || []).includes(type);
}
async function fetchSource(source) {
  let current = urlOf(source.base_url);
  const config = source.config || {};
  const extraHeaders = {};
  const allowedCredentialNames = new Set(["TICKETMASTER_API_KEY", "EVENTBRITE_PRIVATE_TOKEN", "PREDICTHQ_API_KEY", "SONGKICK_API_KEY"]);
  if (config.auth_header_env || config.auth_query_env) {
    const credentialName = String(config.auth_header_env || config.auth_query_env);
    if (!allowedCredentialNames.has(credentialName)) throw new Error("This source references an unsupported API credential name.");
  }
  if (config.auth_header_env) {
    const secret = process.env[String(config.auth_header_env)];
    if (!secret) throw new Error("Missing API credential: add the " + config.auth_header_env + " environment variable in Vercel, then redeploy.");
    const headerName = config.auth_header_name === "X-API-Key" ? "X-API-Key" : "Authorization";
    const prefix = config.auth_header_prefix === "Bearer" ? "Bearer " : "";
    extraHeaders[headerName] = prefix + secret;
  }
  if (config.auth_query_env) {
    const secret = process.env[String(config.auth_query_env)];
    if (!secret) throw new Error("Missing API credential: add the " + config.auth_query_env + " environment variable in Vercel, then redeploy.");
    const u = new URL(current);
    u.searchParams.set(String(config.auth_query_param || "apikey"), secret);
    current = u.toString();
  }
  if (!current) throw new Error("Source URL must be HTTP or HTTPS.");
  for (let i = 0; i <= 3; i++) {
    const resolved = await resolvePublicAddress(current);
    const response = await requestPinned(current, resolved, extraHeaders);
    if ([301,302,303,307,308].includes(response.status)) {
      if (!response.location || i === 3) throw new Error("Source redirected too many times or omitted its redirect target.");
      const previous = new URL(current);
      current = urlOf(response.location, current);
      if ((config.auth_header_env || config.auth_query_env) && current && new URL(current).origin !== previous.origin) {
        throw new Error("Authenticated event API redirected to another host. Cross-host redirects are blocked to protect API credentials.");
      }
      if (!current) throw new Error("Source returned an unsafe redirect URL.");
      continue;
    }
    if (response.status === 429) throw new Error("The event provider is rate limiting requests (HTTP 429). It temporarily refused automated access. No events were imported from this source; try again later or use another provider.");
    if (response.status === 403) throw new Error("The event provider denied automated access (HTTP 403). Use an official API or an approved feed for this provider.");
    if (response.status < 200 || response.status >= 300) throw new Error("Source returned HTTP " + response.status + ".");
    if (!allowedContentType(source.source_type, response.contentType)) throw new Error("Source returned an unsupported content type: " + (response.contentType || "missing") + ".");
    return { body: response.body, contentType: response.contentType, finalUrl: current };
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
module.exports = { collectFromSource, parseJsonApi, parseRssAtom, parseIcal, parseJsonLd, normalise, blockedIp, allowedContentType };
