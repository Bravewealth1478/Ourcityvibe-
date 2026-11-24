const urls=[
"https://www.songkick.com/search?query=Lagos",
"https://www.songkick.com/metro-areas/nearby?location=Lagos",
"https://www.songkick.com/metro-areas/lagos",
"https://www.songkick.com/metro-areas/lagos-nigeria",
"https://www.songkick.com/metro-areas/32584-nigeria-lagos",
"https://www.songkick.com/metro-areas/305-nigeria-lagos"
];
const c=new AbortController(),timer=setTimeout(()=>c.abort(),12000);
try{for(const url of urls){try{const r=await fetch(url,{signal:c.signal,redirect:"follow",headers:{"user-agent":"Mozilla/5.0"}});const h=await r.text();const title=(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"";const canon=(h.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)||[])[1]||"";const ld=[...h.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];let ev=0;for(const m of ld){try{const d=JSON.parse(m[1]);const w=x=>{if(!x)return;if(Array.isArray(x))return x.forEach(w);if(typeof x!=="object")return;if([].concat(x["@type"]||[]).some(t=>/event/i.test(t)))ev++;Object.values(x).forEach(w)};w(d)}catch{}}console.log(JSON.stringify({requested:url,status:r.status,url:r.url,title:title.replace(/\s+/g," ").trim(),canonical:canon,jsonld:ld.length,eventCount:ev,lagosMentions:(h.match(/Lagos/gi)||[]).length,concertPaths:[...new Set([...h.matchAll(/href=["']([^"']*\/concerts\/[^"']+)/gi)].map(x=>x[1]))].slice(0,4)}))}catch(e){console.log(JSON.stringify({requested:url,error:String(e).slice(0,150)}))}}}finally{clearTimeout(timer)}
