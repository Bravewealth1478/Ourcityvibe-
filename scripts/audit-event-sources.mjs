const sources = [
  {name:"Tix Africa",region:"Nigeria",home:"https://tix.africa/"},
  {name:"Nairabox",region:"Nigeria",home:"https://nairabox.com/"},
  {name:"Afritickets",region:"Nigeria",home:"https://afritickets.com/"},
  {name:"Eventhive",region:"Nigeria",home:"https://eventhive.ng/"},
  {name:"Bandsintown",region:"International",home:"https://www.bandsintown.com/"},
  {name:"Songkick",region:"International",home:"https://www.songkick.com/",testPages:["https://www.songkick.com/concerts/43501895-ricky-montgomery-at-van-buren","https://www.songkick.com/concerts/43510731-clutch-at-van-buren"]}
];
const timeout=12000, hint=/event|concert|festival|show|happening|experience|listing|discover/i;
async function get(url){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{signal:c.signal,redirect:"follow",headers:{"user-agent":"OurCityVibeSourceAudit/1.0"}});return{status:r.status,url:r.url,type:r.headers.get("content-type")||"",body:await r.text()}}finally{clearTimeout(t)}}
function inspect(html){
 const blocks=[...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
 const types={};let eventCount=0;
 const walk=x=>{if(!x)return;if(Array.isArray(x)){x.forEach(walk);return}if(typeof x!=="object")return;for(const t of [].concat(x["@type"]||[])){const k=String(t);types[k]=(types[k]||0)+1;if(/event/i.test(k))eventCount++}for(const [k,v] of Object.entries(x))if(k!=="@context"&&k!=="@type")walk(v)};
 for(const b of blocks){try{walk(JSON.parse(b[1].trim()))}catch{}}
 const links=[...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>({href:m[1],label:m[2].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()})).filter(x=>/^https?:|^\//.test(x.href)&&hint.test(x.href+" "+x.label));
 const feeds=[...html.matchAll(/<link\b[^>]*rel=["'][^"']*alternate[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]).slice(0,5);
 return{jsonldBlocks:blocks.length,schemaEventCount:eventCount,schemaTypes:types,eventLinks:links.slice(0,8),alternateFeeds:feeds}
}
for(const s of sources){try{const p=await get(s.home),out={name:s.name,region:s.region,homepage:p.url,status:p.status,contentType:p.type,...inspect(p.body)};const urls=[...(s.testPages||[]),...out.eventLinks.filter(x=>/concerts?\/|events?\//i.test(x.href)).slice(0,3).map(x=>new URL(x.href,p.url).href)];out.checkedEventPages=[];for(const url of [...new Set(urls)].slice(0,3)){try{const q=await get(url);out.checkedEventPages.push({url:q.url,status:q.status,contentType:q.type,...inspect(q.body)})}catch(e){out.checkedEventPages.push({url,error:String(e).slice(0,160)})}}console.log(JSON.stringify(out))}catch(e){console.log(JSON.stringify({name:s.name,region:s.region,homepage:s.home,error:String(e).slice(0,200)}))}}
