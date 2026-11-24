const sources = [
  ["Tix Africa","https://tix.africa/","Nigeria"],
  ["Nairabox","https://nairabox.com/","Nigeria"],
  ["Afritickets","https://afritickets.com/","Nigeria"],
  ["Eventhive","https://eventhive.ng/","Nigeria"],
  ["Bandsintown","https://www.bandsintown.com/","International"],
  ["Songkick","https://www.songkick.com/","International"]
];
const eventHint = /event|concert|festival|show|happening|experience|listing|discover/i;
const timeout = 12000;
async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "OurCityVibeSourceAudit/1.0 (+https://ourcityvibe.vercel.app)" } });
    const body = await res.text();
    return { status: res.status, url: res.url, type: res.headers.get("content-type") || "", body };
  } finally { clearTimeout(timer); }
}
function inspect(html) {
  const jsonld = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let eventCount = 0;
  for (const m of jsonld) {
    try {
      const data = JSON.parse(m[1].trim());
      const walk = x => {
        if (!x) return;
        if (Array.isArray(x)) return x.forEach(walk);
        if (typeof x !== "object") return;
        const types = [].concat(x["@type"] || []);
        if (types.some(t => String(t).toLowerCase() === "event")) eventCount++;
        if (x["@graph"]) walk(x["@graph"]);
        if (x.itemListElement) walk(x.itemListElement);
      };
      walk(data);
    } catch {}
  }
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ href: m[1], label: m[2].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim() }))
    .filter(x => eventHint.test(x.href) || eventHint.test(x.label))
    .slice(0, 5);
  const feeds = [...html.matchAll(/<link\b[^>]*rel=["'][^"']*alternate[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]).slice(0,5);
  return { jsonldBlocks: jsonld.length, schemaEventCount: eventCount, eventLinks: links, alternateFeeds: feeds };
}
for (const [name, home, region] of sources) {
  try {
    const page = await get(home);
    const result = { name, region, homepage: page.url, status: page.status, contentType: page.type, ...inspect(page.body) };
    const candidates = result.eventLinks.slice(0,2);
    result.checkedEventPages = [];
    for (const link of candidates) {
      try {
        const url = new URL(link.href, page.url).href;
        const p = await get(url);
        result.checkedEventPages.push({ url: p.url, status: p.status, contentType: p.type, ...inspect(p.body) });
      } catch (e) { result.checkedEventPages.push({ url: link.href, error: String(e).slice(0,180) }); }
    }
    console.log(JSON.stringify(result));
  } catch (e) {
    console.log(JSON.stringify({ name, region, homepage: home, error: String(e).slice(0,220) }));
  }
}