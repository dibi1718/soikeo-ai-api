// SOI FULL AI + AiScore MASTER V8.1 — API-Football Research Backend + safe diagnostics
// Node.js >=18, package.json: {"type":"module","scripts":{"start":"node server.js"},
// "dependencies":{"express":"^4.18.2","cors":"^2.8.5","dotenv":"^16.4.5"}}
// Never place API keys in GitHub. Set APISPORTS_KEY (or API_FOOTBALL_KEY) on Render.
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
dotenv.config();

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'120kb'}));
const allowed=(process.env.CORS_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
app.use(cors({origin:(origin,cb)=>cb(null,!allowed.length||!origin||allowed.includes(origin))}));
const PORT=Number(process.env.PORT)||3000;
const BASE='https://v3.football.api-sports.io';
const KEY=process.env.APISPORTS_KEY||process.env.API_SPORTS_KEY||process.env.API_FOOTBALL_KEY||'';
const TAVILY=process.env.TAVILY_API_KEY||'';
const ADMIN=process.env.APP_ACCESS_TOKEN||'';
const DATA_DIR=process.env.DATA_DIR||path.join(path.dirname(fileURLToPath(import.meta.url)),'data');
const DATA_FILE=path.join(DATA_DIR,'snapshots_v8.json');
const CACHE=new Map();
const pending=new Map();
const MAX_DAY=Math.max(5,Math.min(1000,Number(process.env.API_DAILY_BUDGET||85)));
let day=new Date().toISOString().slice(0,10),calls=0,upstreamRemaining=null;
let snapshots=[];
try{snapshots=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));if(!Array.isArray(snapshots))snapshots=[];}catch{snapshots=[];}
const clean=(x,n=130)=>String(x??'').replace(/\s+/g,' ').trim().slice(0,n);
const norm=x=>clean(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/\b(fc|sc|cf|afc)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
const n=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso=x=>{const d=new Date(x);return Number.isFinite(d.getTime())?d.toISOString():null};
const round=(x,k=4)=>Number.isFinite(x)?Number(x.toFixed(k)):null;
function persist(){try{fs.mkdirSync(DATA_DIR,{recursive:true});const tmp=DATA_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(snapshots.slice(-500)),{mode:0o600});fs.renameSync(tmp,DATA_FILE);return true;}catch(e){console.warn('Snapshots not persistent:',e.message);return false;}}
function token(req,res,next){if(ADMIN&&req.get('x-app-token')!==ADMIN)return res.status(401).json({error:'APP_ACCESS_TOKEN required'});next();}
const perIP=new Map();
function throttle(req,res,next){const ip=req.ip||'anon',now=Date.now(),old=perIP.get(ip)||[];const hits=old.filter(t=>now-t<60000);if(hits.length>=12)return res.status(429).json({error:'Quá nhiều yêu cầu, thử sau một phút.'});hits.push(now);perIP.set(ip,hits);next();}
function cacheGet(k,ttl){const x=CACHE.get(k);return x&&Date.now()-x.t<ttl?x.data:null;}
async function api(endpoint,params={},ttl=3600000){
 if(!KEY)throw Error('NO APISPORTS_KEY');
 const u=new URL(BASE+endpoint);for(const [k,v] of Object.entries(params))if(v!==null&&v!==undefined&&v!=='')u.searchParams.set(k,String(v));
 const ck=u.pathname+u.search,found=cacheGet(ck,ttl);if(found)return found;
 if(pending.has(ck))return pending.get(ck);
 const promise=(async()=>{
  const today=new Date().toISOString().slice(0,10);if(today!==day){day=today;calls=0;}
  if(calls>=MAX_DAY||upstreamRemaining===0)throw Error('API quota budget exhausted');
  calls++;
  const ctr=new AbortController();const timer=setTimeout(()=>ctr.abort(),9500);
  try{
   const res=await fetch(u,{headers:{'x-apisports-key':KEY},signal:ctr.signal});
   const remain=n(res.headers.get('x-ratelimit-requests-remaining'));if(remain!==null)upstreamRemaining=remain;
   if(!res.ok)throw Error('API-Football HTTP '+res.status);
   const json=await res.json();
   if(json.errors&&(Array.isArray(json.errors)?json.errors.length:Object.keys(json.errors).length))throw Error('API-Football: '+JSON.stringify(json.errors).slice(0,220));
   if(!Array.isArray(json.response))throw Error('API response missing array');
   CACHE.set(ck,{t:Date.now(),data:json});if(CACHE.size>600)CACHE.delete(CACHE.keys().next().value);
   return json;
  }finally{clearTimeout(timer);}
 })();pending.set(ck,promise);try{return await promise;}finally{pending.delete(ck);}
}
const rows=(x)=>Array.isArray(x?.response)?x.response:[];
function similar(a,b){const A=norm(a),B=norm(b);if(!A||!B)return false;if(A===B)return true;
 const aliases={'man utd':'manchester united','man city':'manchester city','psg':'paris saint germain','inter milan':'inter','bayern':'bayern munich','spurs':'tottenham','hoang anh gia lai':'hagl','hagl':'hagl'};
 const normAlias=v=>aliases[v]||v;return normAlias(A)===normAlias(B);
}
function leagueOK(requested,actual){if(!requested)return true;const a=norm(requested),b=norm(actual);const common={'epl':'premier league','ngoai hang anh':'premier league','la liga':'primera division','j league':'j1 league','c1':'uefa champions league'};
 if(a===b)return true;if((common[a]||a)===(common[b]||b))return true;
 return a.length>=5&&b.length>=5&&(a.includes(b)||b.includes(a));}
function getInput(body){
 const home=clean(body.home),away=clean(body.away),league=clean(body.league);
 const kickoff=body.kickoff?iso(body.kickoff):body.kickoffVN?iso(body.kickoffVN+':00+07:00'):null;
 const date=kickoff?new Date(new Date(kickoff).getTime()+7*3600000).toISOString().slice(0,10):clean(body.date,10);
 if(!home||!away||home===away||!league||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Nhập home, away, league, ngày hoặc giờ đá VN.');
 const mode=String(body.mode||'FT').toUpperCase();const phase=String(body.phase||'PRE').toUpperCase().replace('T10','T-10');
 if(!['FT','H2','LIVE'].includes(mode)||!['PRE','T-10'].includes(phase))throw Error('Sai mode/phase');
 return {home,away,league,kickoff,date,phase,mode};
}
async function resolveFixture(x){
 // One date-scoped request; reject ambiguity, never use an unrelated fixture as fallback.
 const raw=await api('/fixtures',{date:x.date,timezone:'Asia/Ho_Chi_Minh'},1800000);
 const list=rows(raw).filter(f=>similar(f.teams?.home?.name,x.home)&&similar(f.teams?.away?.name,x.away)&&leagueOK(x.league,f.league?.name));
 const ranked=list.map(f=>({f,diff:x.kickoff?Math.abs(new Date(f.fixture.date)-new Date(x.kickoff))/60000:0})).sort((a,b)=>a.diff-b.diff);
 if(!ranked.length)throw Error('NO VERIFIED FIXTURE: không tìm thấy đúng cặp đội, giải, ngày.');
 if(x.kickoff&&ranked[0].diff>120)throw Error('KICKOFF MISMATCH: giờ nhập khác giờ API trên 120 phút.');
 if(ranked.length>1&&(!x.kickoff||ranked[1].diff===ranked[0].diff))throw Error('AMBIGUOUS FIXTURE: nhiều trận trùng, xác minh giờ đá.');
 return ranked[0].f;
}
function shortGame(f){return {fixtureId:f.fixture?.id,date:f.fixture?.date,league:f.league?.name,home:f.teams?.home?.name,away:f.teams?.away?.name,homeId:f.teams?.home?.id,awayId:f.teams?.away?.id,scoreHome:n(f.goals?.home),scoreAway:n(f.goals?.away),status:f.fixture?.status?.short};}
function pastOnly(games,kickoff){return games.filter(f=>iso(f.fixture?.date)&&new Date(f.fixture.date)<new Date(kickoff)&&['FT','AET','PEN'].includes(f.fixture?.status?.short)&&n(f.goals?.home)!==null&&n(f.goals?.away)!==null).sort((a,b)=>new Date(b.fixture.date)-new Date(a.fixture.date));}
async function optional(label,fn,warnings){try{return await fn();}catch(e){warnings.push(label+': '+e.message);return null;}}
function splitQuarter(line){if(n(line)===null||Math.abs(line*4-Math.round(line*4))>1e-7)throw Error('INVALID ASIAN LINE');return Number.isInteger(line*2)?[line]:[Math.floor(line*2)/2,Math.ceil(line*2)/2];}
function settle(kind,side,line,h,a){const dif=kind==='HDC'?(side==='HOME'?h-a:a-h):h+a;return splitQuarter(line).reduce((s,l,_,arr)=>{const d=kind==='HDC'?dif+l:side==='OVER'?dif-l:l-dif;return s+(d>0?1:d<0?-1:0)/arr.length;},0);}
function profit(f,dec){return f>=0?f*(dec-1):f;}
function pmf(l){const a=[Math.exp(-l)];for(let i=1;i<=23;i++)a[i]=a[i-1]*l/i;const sum=a.reduce((x,y)=>x+y,0);return a.map(v=>v/sum);}
function distribution(lh,la){const h=pmf(lh),a=pmf(la),out=[];for(let i=0;i<h.length;i++)for(let j=0;j<a.length;j++)out.push({h:i,a:j,p:h[i]*a[j]});return out;}
function goalAverages(items,teamId){let scored=0,conceded=0,count=0;
 for(const f of items){const isHome=f.teams.home.id===teamId;const isAway=f.teams.away.id===teamId;if(!isHome&&!isAway)continue;
 scored+=isHome?f.goals.home:f.goals.away;conceded+=isHome?f.goals.away:f.goals.home;count++;}
 return count?{scored:scored/count,conceded:conceded/count,n:count}:null;
}
function buildModel(homeGames,awayGames,hid,aid){const h=goalAverages(homeGames,hid),a=goalAverages(awayGames,aid);
 if(!h||!a||h.n<5||a.n<5)return null;
 // Transparent goals-for/against proxy, NOT observed xG, not a calibrated fair-price model.
 const lh=Math.min(6,Math.max(.12,.53*h.scored+.47*a.conceded));
 const la=Math.min(6,Math.max(.12,.53*a.scored+.47*h.conceded));
 return {lambdaHome:round(lh),lambdaAway:round(la),method:'recent-goals Poisson proxy, NOT xG',sampleHome:h.n,sampleAway:a.n,verified:false,sourceUrl:null,forecastType:'EXPLORATORY_ONLY'};
}
function unpackBet(b){return norm(b?.name||'');}
function parseOdds(apiData,fixtureId,stage){
 const now=new Date().toISOString(),out=[];
 const push=(kind,book,bookId,line,a,b,c,update)=>{
  if(kind!=='1X2'&&(line===null||Math.abs(line*4-Math.round(line*4))>1e-6||Math.abs(line)>12))return;
  if(![a,b].every(v=>n(v)>1.001)||kind==='1X2'&&!(n(c)>1.001))return;
  const rec={market:kind,kind,book,feedId:'APISPORTS:'+bookId,bookmakerId:bookId,line,
   homePrice:kind==='HDC'||kind==='1X2'?Number(a):undefined,awayPrice:kind==='HDC'||kind==='1X2'?Number(b):undefined,
   overPrice:kind==='TX'?Number(a):undefined,underPrice:kind==='TX'?Number(b):undefined,
   drawPrice:kind==='1X2'?Number(c):undefined,
   a:Number(a),b:Number(b),c:kind==='1X2'?Number(c):null,
   observedAt:now,updatedAt:iso(update),timestampKind:'API_FETCH_TIME',
   stage,format:'DEC',verified:true,scope:'FT',
   sourceUrl:`https://www.api-football.com/documentation-v3#tag/Odds`};
  out.push(rec);
 };
 for(const row of rows(apiData)){
  if(Number(row.fixture?.id)!==Number(fixtureId))continue;
  for(const bk of row.bookmakers||[]){const name=clean(bk.name),bid=bk.id;
   if(!name||!bid)continue;
   for(const b of bk.bets||[]){const label=unpackBet(b);const vals=b.values||[];
    if(/match winner|1x2|fulltime result|full time result/.test(label)){
     const get=keys=>{const v=vals.find(v=>keys.includes(norm(v.value)));return n(v?.odd)};
     const h=get(['home','1']),d=get(['draw','x']),a=get(['away','2']);
     if(h&&d&&a)push('1X2',name,bid,null,h,a,d,row.update);
    }
    if(/over under|goals over|total goals/.test(label)){
     const lines=new Map();for(const v of vals){const m=String(v.value).trim().match(/^(Over|Under)\s*(\d+(?:\.\d+)?)$/i);
      if(!m)continue;const line=Number(m[2]);if(!lines.has(line))lines.set(line,{});lines.get(line)[m[1].toLowerCase()]=n(v.odd);}
     for(const [line,p] of lines)if(p.over&&p.under)push('TX',name,bid,line,p.over,p.under,null,row.update);
    }
    if(/asian handicap|asian hand|handicap/.test(label)&&!/half|first/.test(label)){
     const lines=new Map();for(const v of vals){const text=String(v.value||'').trim();
      const m=text.match(/^(Home|Away|1|2)\s*\(?([+-]?\d+(?:\.\d+)?)\)?$/i);
      if(!m)continue;const home=/^(Home|1)$/i.test(m[1]);const effective=Number(m[2]);const hline=home?effective:-effective;
      if(!lines.has(hline))lines.set(hline,{});lines.get(hline)[home?'home':'away']=n(v.odd);
     }
     for(const [line,p] of lines)if(p.home&&p.away)push('HDC',name,bid,line,p.home,p.away,null,row.update);
    }
   }
  }
 }
 return out;
}
function latestByBookLine(recs){const map=new Map();for(const r of recs){const key=r.bookmakerId+'|'+r.market+'|'+r.line;map.set(key,r);}return [...map.values()];}
function quantLadder(model,odds){if(!model)return [];
 const d=distribution(model.lambdaHome,model.lambdaAway),out=[];
 for(const q of latestByBookLine(odds)){
  if(!['HDC','TX'].includes(q.market))continue;
  for(const side of q.market==='HDC'?['HOME','AWAY']:['OVER','UNDER']){
   const dec=q.market==='HDC'?(side==='HOME'?q.homePrice:q.awayPrice):(side==='OVER'?q.overPrice:q.underPrice);
   const line=q.market==='HDC'&&side==='AWAY'?-q.line:q.line;
   let ev=0;const cases={'1':0,'0.5':0,'0':0,'-0.5':0,'-1':0};
   for(const g of d){const f=settle(q.market,side,line,g.h,g.a);ev+=g.p*profit(f,dec);cases[String(f)]+=g.p;}
   out.push({kind:q.market,market:q.market,side,line,dec,hk:round(dec-1,3),book:q.book,feedId:q.feedId,
    at:q.observedAt,sourceUrl:q.sourceUrl,ev:round(ev),cases:Object.fromEntries(Object.entries(cases).map(([k,v])=>[k,round(v)]))});
  }
 }
 return out.sort((a,b)=>b.ev-a.ev);
}
function noVig(odds){const q=odds.find(o=>o.market==='1X2');if(!q)return null;
 const a=[q.homePrice,q.drawPrice,q.awayPrice].map(x=>1/x),sum=a.reduce((x,y)=>x+y,0);
 return {book:q.book,home:round(a[0]/sum),draw:round(a[1]/sum),away:round(a[2]/sum),note:'1X2 market-implied no-vig, not independent model probability'};
}
async function searchExperts(x,warnings){if(!TAVILY)return [];
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),11000);
 try{
  const q=`${x.home} vs ${x.away} ${x.league} ${x.date} preview injury prediction Sports Mole Forebet Opta`;
  const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'content-type':'application/json'},signal:ctrl.signal,
   body:JSON.stringify({api_key:TAVILY,query:q,search_depth:'basic',max_results:6})});
  if(!r.ok)throw Error('Tavily HTTP '+r.status);const data=await r.json();
  return (data.results||[]).filter(z=>/^https:\/\//.test(z.url||'')).map(z=>({title:clean(z.title,220),url:z.url,summary:clean(z.content,700),status:'SEARCH_SNIPPET_NOT_VERIFIED',verified:false}));
 }catch(e){warnings.push('EXPERT SEARCH: '+e.message);return [];}finally{clearTimeout(timer);}
}
const phaseCacheTTL=p=>p==='T-10'?55000:720000;
async function research(x){
 const warnings=[],fixture=await resolveFixture(x),f=shortGame(fixture),ko=fixture.fixture.date;
 if(Date.now()>=Date.parse(ko))throw Error('PRE/T-10 đã đóng khi trận bắt đầu; dùng hậu kiểm với dữ liệu snapshot cũ.');
 if(x.phase==='T-10'&&(new Date(ko).getTime()-Date.now()>12*60000||new Date(ko)<=new Date()))
   throw Error('T-10 chỉ chạy trong 12 phút trước giờ đá, trước kickoff.');
 const ids=[f.homeId,f.awayId];if(!ids.every(Boolean))throw Error('NO TEAM IDs');
 const endpoints=[
  ['h2h',()=>api('/fixtures/headtohead',{h2h:ids.join('-'),last:10},3600000)],
  ['recentHome',()=>api('/fixtures',{team:ids[0],last:20,status:'FT'},3600000)],
  ['recentAway',()=>api('/fixtures',{team:ids[1],last:20,status:'FT'},3600000)],
  ['lineups',()=>api('/fixtures/lineups',{fixture:f.fixtureId},x.phase==='T-10'?55000:900000)],
  ['injuries',()=>api('/injuries',{fixture:f.fixtureId},900000)],
  ['odds',()=>api('/odds',{fixture:f.fixtureId,page:1},phaseCacheTTL(x.phase))],
  ['predictions',()=>api('/predictions',{fixture:f.fixtureId},3600000)]
 ];
 const collected={};
 // Sequential to avoid a burst of requests on the free plan.
 for(const [key,fn] of endpoints)collected[key]=await optional(key,fn,warnings);
 const homeGames=pastOnly(rows(collected.recentHome),ko).slice(0,10);
 const awayGames=pastOnly(rows(collected.recentAway),ko).slice(0,10);
 const h2h=pastOnly(rows(collected.h2h),ko).slice(0,10);
 const lineups=rows(collected.lineups);
 const homeXI=lineups.find(a=>Number(a.team?.id)===ids[0]);
 const awayXI=lineups.find(a=>Number(a.team?.id)===ids[1]);
 const lineupObject={status:homeXI?.startXI?.length===11&&awayXI?.startXI?.length===11?'OFFICIAL':'NO DATA',
  verified:!!(homeXI?.startXI?.length===11&&awayXI?.startXI?.length===11),
  sourceUrl:'https://www.api-football.com/documentation-v3#tag/Lineups',
  home:{formation:homeXI?.formation||null,starting:(homeXI?.startXI||[]).map(v=>v.player?.name),bench:(homeXI?.substitutes||[]).map(v=>v.player?.name)},
  away:{formation:awayXI?.formation||null,starting:(awayXI?.startXI||[]).map(v=>v.player?.name),bench:(awayXI?.substitutes||[]).map(v=>v.player?.name)}};
 const inj=rows(collected.injuries).map(v=>({team:v.team?.name,player:v.player?.name,reason:v.player?.reason||v.player?.type}));
 const market=collected.odds?parseOdds(collected.odds,f.fixtureId,x.phase):[];
 const model=buildModel(homeGames,awayGames,...ids);
 const ladder=quantLadder(model,market),top=ladder.find(c=>c.ev>0.02)||null;
 const experts=await searchExperts(x,warnings);
 const prediction=rows(collected.predictions)[0]||null;
 if(!market.length)warnings.push('NO VERIFIED PRICE (no supported odds lines found).');
 if(!market.some(v=>v.market==='1X2'))warnings.push('NO 1X2 MARKET');
 if(!market.some(v=>v.market==='HDC'))warnings.push('NO HDC MARKET');
 if(!market.some(v=>v.market==='TX'))warnings.push('NO TOTAL MARKET');
 if(!model)warnings.push('NO QUANT MODEL: fewer than five completed games per team.');
 if(!lineupObject.verified)warnings.push('OFFICIAL XI: NO DATA');
 warnings.push('NO AISCORE DIRECT FEED: API-Sports data only; AiScore site has not been accessed.');
 warnings.push('NO MASTER RUBRIC SCORE: 85-GATE → PASS.');
 const match={home:f.home,away:f.away,kickoffISO:ko,league:f.league,fixtureId:f.fixtureId,
  verified:true,sourceUrl:'https://www.api-football.com/documentation-v3#tag/Fixtures'};
 const marketNotes=[];
 const old=snapshots.filter(s=>s.match?.fixtureId===f.fixtureId&&s.mode===x.mode&&s.phase!==x.phase).at(-1);
 if(old){for(const q of market){const earlier=(old.odds||[]).filter(v=>v.market===q.market&&v.bookmakerId===q.bookmakerId);
  for(const p of earlier){if(q.line===p.line&&q.market!=='1X2')marketNotes.push(`${q.book} ${q.market} SAME LINE ${q.line}: ${p.a} → ${q.a}`);
   else if(q.market!=='1X2'&&q.line!==p.line)marketNotes.push(`${q.book} ${q.market} LINE MOVE ${p.line} → ${q.line}; do not compare juice across lines`);
  }} }
 const result={
  apiVersion:'V8 MASTER Data Pipeline',phase:x.phase,mode:x.mode,match,fixture:match,summary:'Đã thu thập các mục API-Football hiện có; mã nghiên cứu không phải mã CHỐT khi thiếu rubric và các kiểm chứng.',
  injuriesHome:inj.filter(v=>similar(v.team,f.home)).map(v=>v.player+': '+v.reason).join('; ')||'NO DATA',
  injuriesAway:inj.filter(v=>similar(v.team,f.away)).map(v=>v.player+': '+v.reason).join('; ')||'NO DATA',
  lineupHome:lineupObject.home.starting.length?lineupObject.home.starting.join(', '):'NO DATA',
  lineupAway:lineupObject.away.starting.length?lineupObject.away.starting.join(', '):'NO DATA',
  lineup:lineupObject,
  aiscore:{status:'NOT CONNECTED',h2h:[],recentHome:[],recentAway:[],historicalOdds:[],note:'Not AiScore; see recentApiSports'},
  recentApiSports:{h2h:h2h.map(shortGame),home:homeGames.map(shortGame),away:awayGames.map(shortGame)},
  historicalOdds:{status:'NO ODDS ARCHIVE',note:'Needs scheduled persistent snapshots; API-Football /odds retains only short history'},
  odds:market,markets:{'1X2':market.filter(v=>v.market==='1X2'),HDC:market.filter(v=>v.market==='HDC'),TX:market.filter(v=>v.market==='TX')},
  marketPath:{snapshotsAvailable:!!old,notes:marketNotes,opening:old?.phase==='OPEN'?old.odds:null},
  deVig1X2:noVig(market),model,quant:{method:model?.method||'NO MODEL',candidates:ladder.slice(0,50)},
  researchCode:top?`${top.kind==='HDC'?(top.side==='HOME'?f.home:f.away)+' '+(top.line>=0?'+':'')+top.line+' HDC FT90':(top.side==='OVER'?'Tài ':'Xỉu ')+top.line+' FT90'}`:'NO VERIFIED CODE',
  entry:top?{book:top.book,line:top.line,hk:top.hk,decimal:top.dec,observedAt:top.at,sourceUrl:top.sourceUrl}:null,
  prediction:prediction?{winner:prediction.predictions?.winner,goals:prediction.predictions?.goals,percent:prediction.predictions?.percent,source:'API-Football predictions; independent of expert consensus'}:null,
  experts,expertConsensus:{status:experts.length?'SEARCH_ONLY':'NO VERIFIED SOURCES',sourceCount:0,confidence:0,summary:'Không suy ra HDC/TX từ snippet',sources:experts},
  superComputerConsensus:{status:prediction?'API_PREDICTION_REFERENCE':'NO MODEL',sourceCount:0,confidence:0,summary:'Không giả vờ chạy siêu máy tính độc lập'},
  contextImpact:{status:'NOT SCORED',sourceCount:0,score:{homeHdc:0,awayHdc:0,over:0,under:0}},
  marketImpact:{status:'NOT SCORED',sourceCount:0,score:{homeHdc:0,awayHdc:0,over:0,under:0}},
  masterScore:null,status:'PASS',final:'PASS — NO VERIFIED SCORE',warnings,
  sourceQuality:{fixture:true,odds:market.length>0,officialXI:lineupObject.verified,aiScore:false,expertForecastsVerified:false,masterRubric:false},
  quota:{usedToday:calls,budget:MAX_DAY,remainingReported:upstreamRemaining},
  capturedAt:new Date().toISOString()
 };
 const snap={id:Date.now().toString(36)+Math.random().toString(36).slice(2,8),match,mode:x.mode,phase:x.phase,at:result.capturedAt,odds:market,decision:'PASS',code:result.researchCode,masterScore:null};
 snapshots.push(snap);snapshots=snapshots.slice(-500);if(!persist())warnings.push('STORAGE EPHEMERAL: configure a persistent DATA_DIR.');
 return result;
}
app.get('/',(_,res)=>res.json({ok:true,service:'SOI FULL AI MASTER V8',endpoint:'/api/research',app:'/app',apiFootballConfigured:!!KEY,tavilyConfigured:!!TAVILY,remainingReported:upstreamRemaining,note:'No verified MASTER score without full rubric; PASS'}));
// V8.1: Chẩn đoán riêng API-Football. KHÔNG trả API KEY, email, dữ liệu tài khoản.
app.get('/api/diagnostic-football',token,throttle,async(req,res)=>{
 if(!KEY)return res.status(503).json({diagnostic:'CONFIG_MISSING',keyConfigured:false,action:'Thêm APISPORTS_KEY trong Render Environment.'});
 const ctr=new AbortController();const timer=setTimeout(()=>ctr.abort(),12000);
 try{
  const isFixtures=req.query.check==='fixtures';
  const vnDate=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  const checkPath=isFixtures?'/fixtures?date='+vnDate+'&timezone=Asia%2FHo_Chi_Minh':'/status';
  const upstream=await fetch(BASE+checkPath,{
   method:'GET',headers:{'x-apisports-key':KEY,'accept':'application/json'},
   cache:'no-store',redirect:'manual',signal:ctr.signal
  });
  const contentType=upstream.headers.get('content-type')||'';
  let body='';try{body=await upstream.text();}catch{}
  let parsed=null;try{parsed=JSON.parse(body);}catch{}
  const issues=parsed?.errors;
  const safeErrors=Array.isArray(issues)?issues.slice(0,5).map(x=>clean(x,150)):
   (issues&&typeof issues==='object'?Object.fromEntries(Object.entries(issues).slice(0,5).map(([k,v])=>[clean(k,50),clean(v,150)])):null);
  const result={diagnostic:'API_FOOTBALL_STATUS',checkedEndpoint:checkPath,keyConfigured:true,
   upstreamStatus:upstream.status,upstreamOK:upstream.ok,
   responseType:/json/i.test(contentType)?'JSON':/html/i.test(contentType)?'HTML':'OTHER',
   serverHeader:clean(upstream.headers.get('server')||'NO DATA',60),
   cfRay:clean(upstream.headers.get('cf-ray')||'NO DATA',60),
   apiErrors:safeErrors,apiResponsePresent:!!parsed?.response,
   remaining:upstream.headers.get('x-ratelimit-requests-remaining')||'NO DATA',
   diagnosis:upstream.ok?'Kết nối API-Football từ Render hoạt động.':
    (upstream.status===403&&/html/i.test(contentType)?'HTTP 403 HTML: có thể bị chặn tại lớp bảo vệ trước API; cần gửi mã CF Ray cho hỗ trợ nhà cung cấp.':
    upstream.status===403?'HTTP 403 JSON/OTHER: xem apiErrors để tìm nguyên nhân chính xác.':
    'Yêu cầu bị từ chối; xem HTTP status và apiErrors.')};
  console.log('[API_FOOTBALL_DIAGNOSTIC]',JSON.stringify(result));
  res.json(result);
 }catch(e){const result={diagnostic:'NETWORK_ERROR',keyConfigured:true,error:clean(e.message,160)};
  console.warn('[API_FOOTBALL_DIAGNOSTIC]',JSON.stringify(result));res.status(502).json(result);
 }finally{clearTimeout(timer);}
});
app.get('/health',(_,res)=>res.json({ok:true,version:'8.1-diagnostic',keyConfigured:!!KEY,callsToday:calls,remainingReported:upstreamRemaining}));
app.post('/api/research',token,throttle,async(req,res)=>{try{
 const x=getInput(req.body||{});
 if(x.mode!=='FT')return res.status(422).json({error:'H2/LIVE requires separate markets and models; not auto-scored in V8.'});
 const result=await research(x);res.json(result);
 }catch(e){res.status(/NO VERIFIED FIXTURE|KICKOFF MISMATCH|AMBIGUOUS/.test(e.message)?404:/quota|APISPORTS_KEY/.test(e.message)?503:400).json({status:'PASS',masterScore:null,error:e.message});}});
app.get('/api/history',token,(req,res)=>res.json(snapshots.filter(s=>!req.query.fixtureId||Number(req.query.fixtureId)===s.match.fixtureId).slice(-120)));
app.get('/app',(_,res)=>res.type('html').send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SOI FULL AI MASTER V8</title><style>body{background:#081520;color:#eff9ff;font:15px system-ui;margin:0;padding:16px}main{max-width:680px;margin:auto}article{background:#142a3d;padding:16px;border:1px solid #346078;border-radius:13px;margin:10px 0}input,button{display:block;width:100%;box-sizing:border-box;margin:6px 0 12px;padding:13px;background:#0a1c29;border:1px solid #55768a;border-radius:8px;color:white}button{background:#208878;font-weight:bold}pre{white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#aac5d4}</style></head><body><main><h2>⚽ SOI FULL AI + AiScore MASTER V8</h2><article><form id="f"><label>Đội nhà<input name="home" required></label><label>Đội khách<input name="away" required></label><label>Giải đấu<input name="league" required></label><label>Giờ Việt Nam<input name="kickoffVN" type="datetime-local" required></label><label>Mã truy cập (nếu bạn cấu hình APP_ACCESS_TOKEN)<input name="token" type="password" autocomplete="off"></label><button>SOI FULL AI PRE</button><button type="button" id="t10">KIỂM T-10</button></form></article><article><pre id="out">Nhập bốn thông tin và bấm SOI.</pre><details><summary>Chi tiết / nguồn và cảnh báo</summary><pre id="detail"></pre></details></article><p class="muted">Không có API/odds/rubric thật → PASS. Không cung cấp xác suất thắng giả.</p></main><script>const f=document.querySelector('#f'),o=document.querySelector('#out'),d=document.querySelector('#detail');async function go(phase){const raw=new FormData(f),v=Object.fromEntries(raw.entries());const tok=v.token;delete v.token;v.phase=phase;try{o.textContent='Đang tìm đúng trận, API-Football, H2H, đội hình, odds và nghiên cứu...';const r=await fetch('/api/research',{method:'POST',headers:{'content-type':'application/json',...(tok?{'x-app-token':tok}:{})},body:JSON.stringify(v)});const x=await r.json();if(!r.ok)throw Error(x.error||r.status);o.textContent='⚽ '+x.match.home+' – '+x.match.away+'\\nKickoff: '+x.match.kickoffISO+'\\nMÃ NGHIÊN CỨU: '+x.researchCode+'\\nGiá: '+(x.entry?x.entry.book+' | HK '+x.entry.hk+' | decimal '+x.entry.decimal:'NO VERIFIED PRICE')+'\\nMASTER: NO VERIFIED SCORE\\nFINAL: PASS\\n'+x.warnings.slice(0,4).join('\\n');d.textContent=JSON.stringify(x,null,2);}catch(e){o.textContent='PASS — '+e.message;}}f.onsubmit=e=>{e.preventDefault();go('PRE')};document.querySelector('#t10').onclick=()=>go('T-10');<\/script></body></html>`));
app.listen(PORT,()=>console.log('SOI FULL AI V8 ready on port '+PORT));
