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