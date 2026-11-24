const urls = [
  ["AllEvents Lagos", "https://allevents.in/lagos/all"],
  ["AllEvents Lagos concerts", "https://allevents.in/lagos/concerts"],
  ["AllEvents privacy", "https://allevents.in/privacy"],
];
const headers = { "user-agent": "Mozilla/5.0 (compatible; OurCityVibeSourceAudit/1.0; +https://ourcityvibe.vercel.app)" };
function parsePage(html) {
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => /application\/ld\+json/i.test(m[1]));
  const types = {};
  let eventCount = 0;
  const walk = v => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v !== "object") return;
    for (const t of [].concat(v["@type"] || [])) { types[t] = (types[t] || 0) + 1; if (/event/i.test(t)) eventCount++; }
    for (const [k, x] of Object.entries(v)) if (k !== "@context" && k !== "@type") walk(x);
  };
  for (const s of scripts) { try { walk(JSON.parse(s[2])); } catch {} }
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => {
    const href = (m[1].match(/href=["']([^"']+)["']/i) || [])[1] || "";
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    return { href, text: text.slice(0, 130), cls: (m[1].match(/class=["']([^"']+)["']/i) || [])[1] || "" };
  }).filter(x => x.href);
  const sameSite = anchors.filter(x => /^(https?:\/\/allevents\.in)?\/(?!manage|app|pages|profile|login|signup|privacy|events$)[a-z0-9-]+\/[a-z0-9-]+/i.test(x.href));
  const alternates = [...html.matchAll(/<link\b[^>]*rel=["']alternate["'][^>]*>/gi)].map(m => m[0].slice(0, 350));
  return { jsonldBlocks: scripts.length, eventCount, schemaTypes: types, likelyDetailLinks: sameSite.slice(0, 60), alternates };
}
for (const [name, url] of urls) {
  try {
    const r = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(18000) });
    const html = await r.text();
    const out = { name, requestedUrl: url, finalUrl: r.url, status: r.status, contentType: r.headers.get("content-type") };
    if (name.includes("privacy")) {
      const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({ href: (m[1].match(/href=["']([^"']+)["']/i)||[])[1]||"", text:m[2].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim() })).filter(x => /terms|service|condition/i.test(x.text+" "+x.href));
      out.termsLinks = anchors.slice(0, 20);
    } else {
      out.title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]?.replace(/\s+/g," ").trim()||"";
      Object.assign(out, parsePage(html));
    }
    console.log(JSON.stringify(out));
  } catch(e) { console.log(JSON.stringify({name,url,error:String(e)})); }
}

const followups = [
  ["AllEvents Lagos concerts RSS", "https://allevents.in/rss3.php?city=lagos&category=concerts"],
  ["AllEvents sample Lagos event", "https://allevents.in/lagos/davido-in-lagos/3300030972128955"],
  ["AllEvents Terms of Service", "https://allevents.in/conditions"],
];
for (const [name, url] of followups) {
  try {
    const r = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(18000) });
    const body = await r.text();
    const out = { name, requestedUrl: url, finalUrl: r.url, status: r.status, contentType: r.headers.get("content-type"), bytes: Buffer.byteLength(body) };
    if (name.includes("RSS")) {
      const items = [...body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m => {
        const block = m[1];
        const field = tag => {
          const re = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i");
          return (block.match(re) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").trim() || "";
        };
        return { title: field("title"), link: field("link"), pubDate: field("pubDate"), descriptionSample: field("description").slice(0, 260) };
      });
      out.itemCount = items.length;
      out.sampleItems = items.slice(0, 8);
      out.hasEventStartDateField = /startDate|eventDate|dtstart/i.test(body);
      out.rssRoot = (body.match(/<rss[^>]*>/i) || body.match(/<feed[^>]*>/i) || [])[0] || "";
    } else {
      out.title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/\s+/g, " ").trim() || "";
      Object.assign(out, parsePage(body));
      const termsText = body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      out.termsTextSample = termsText.slice(0, 1800);\n      out.termsRelevantClauses = [...termsText.matchAll(/.{0,220}(?:automated|robot|scrap|crawl|harvest|copy|reproduce|commercial|data mining|third.party|content|intellectual property).{0,320}/gi)].slice(0, 18).map(m => m[0]);
    }
    console.log(JSON.stringify(out));
  } catch (e) { console.log(JSON.stringify({ name, url, error: String(e) })); }
}
