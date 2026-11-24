const targets = [
  ["AllEvents Lagos", "https://allevents.in/lagos/all"],
  ["AllEvents robots", "https://allevents.in/robots.txt"],
  ["AllEvents sitemap", "https://allevents.in/sitemap.xml"],
  ["AllEvents terms", "https://allevents.in/terms"],
  ["AllEvents privacy", "https://allevents.in/privacy"],
];
const headers = { "user-agent": "Mozilla/5.0 (compatible; OurCityVibeSourceAudit/1.0; +https://ourcityvibe.vercel.app)" };
function inspect(html) {
  const scripts = [...html.matchAll(/<script([^>]*)>([\\s\\S]*?)<\\/script>/gi)];
  const jsonld = scripts.filter(m => /application\\/ld\\+json/i.test(m[1]));
  const types = {};
  let eventCount = 0;
  const walk = value => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== "object") return;
    for (const type of [].concat(value["@type"] || [])) {
      types[type] = (types[type] || 0) + 1;
      if (/event/i.test(type)) eventCount++;
    }
    for (const [key, child] of Object.entries(value)) if (key !== "@context" && key !== "@type") walk(child);
  };
  for (const block of jsonld) { try { walk(JSON.parse(block[2])); } catch {} }
  const links = [...html.matchAll(/<a\\b[^>]*href=["']([^"'#]+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi)]
    .map(m => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim().slice(0, 100) }))
    .filter(x => /event|concert|festival|party|show|conference|workshop|exhibition|comedy/i.test(x.href + " " + x.text))
    .slice(0, 30);
  const alternates = [...html.matchAll(/<link\\b[^>]*rel=["']alternate["'][^>]*>/gi)].map(m => m[0].slice(0, 400)).slice(0, 12);
  const embeddedHints = [...new Set([...html.matchAll(/(?:https?:\\/\\/[^"'\\s<>]+|["'](?:[^"'\\s<>]*(?:event|calendar|feed|api)[^"'\\s<>]*)["'])/gi)].map(m => m[0].slice(0, 220)))].slice(0, 20);
  return { jsonldBlocks: jsonld.length, eventCount, schemaTypes: types, eventLinks: links, alternateLinks: alternates, embeddedHints };
}
for (const [name, url] of targets) {
  try {
    const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(18000) });
    const body = await response.text();
    const result = { name, requestedUrl: url, finalUrl: response.url, status: response.status, contentType: response.headers.get("content-type") };
    if (name.includes("robots")) result.robotsRelevantLines = body.split(/\\r?\\n/).filter(line => /user-agent|disallow|allow|sitemap/i.test(line)).slice(0, 80);
    else if (name.includes("sitemap")) result.sitemapSample = body.slice(0, 5000);
    else if (name.includes("terms") || name.includes("privacy")) result.policyText = body.replace(/<script[\\s\\S]*?<\\/script>/gi, " ").replace(/<style[\\s\\S]*?<\\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim().slice(0, 1800);
    else {
      result.title = (body.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i) || [])[1]?.replace(/\\s+/g, " ").trim() || "";
      Object.assign(result, inspect(body));
    }
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({ name, url, error: String(error).slice(0, 220) }));
  }
}