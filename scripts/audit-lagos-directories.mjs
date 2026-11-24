const urls=[
["AllEvents Lagos","https://allevents.in/lagos/all"],
["AllEvents Nigeria","https://allevents.in/nigeria"],
["Eventbrite Lagos","https://www.eventbrite.com/d/nigeria--lagos/events/"],
["Eventbrite Nigeria","https://www.eventbrite.com/d/nigeria/events/"],
["Nairabox events","https://nairabox.com/events"],
["Tix Africa events","https://tix.africa/events"]
];
const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);
function inspect(h){const blocks=[...h.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];let count=0,types={};const walk=x=>{if(!x)return;if(Array.isArray(x))return x.forEach(walk);if(typeof x!=="object")return;for(const t of [].concat(x["@type"]||[])){types[t]=(types[t]||0)+1;if(/event/i.test(t))count++}for(const [k,v] of Object.entries(x))if(k!=="@context"&&k!=="@type")walk(v)};for(const b of blocks){try{walk(JSON.parse(b[1]))}catch{}}const paths=[...new Set([...h.matchAll(/href=["']([^"'#]+)["']/gi)].map(m=>m[1]).filter(x=>/\/events?\/|\/e\//i.test(x)))].slice(0,8);return{jsonldBlocks:blocks.length,eventCount:count,schemaTypes:types,eventPaths:paths}}
try{for(const [name,url] of urls){try{const r=await fetch(url,{signal:c.signal,redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; OurCityVibeSourceAudit/1.0)"}});const h=await r.text();const title=(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"";console.log(JSON.stringify({name,requested:url,status:r.status,url:r.url,contentType:r.headers.get("content-type"),title:title.replace(/\s+/g," ").trim(),...inspect(h)}))}catch(e){console.log(JSON.stringify({name,url,error:String(e).slice(0,180)}))}}}finally{clearTimeout(timer)}
