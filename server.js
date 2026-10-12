// SOI FULL AI + AiScore MASTER V9 — Full V6 workflow + V8.2 API — AIscore-name friendly fixture resolver + Free-plan history + safe diagnostics
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
const SECONDARY_ODDS_KEY=process.env.THE_ODDS_API_KEY||'';
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
// Giữ nguyên tên người dùng gõ (kể cả tên AiScore). Chuẩn hóa chỉ để so khớp.
const norm=x=>clean(x,200).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d')
 .toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const ALIASES={
 'man utd':'manchester united','manchester utd':'manchester united','man united':'manchester united','man city':'manchester city',
 'psg':'paris saint germain','paris sg':'paris saint germain',
 'inter milan':'inter','internazionale':'inter','internazionale milano':'inter',
 'bayern':'bayern munich','bayern munchen':'bayern munich',
 'spurs':'tottenham','tottenham hotspur':'tottenham',
 'hagl':'hoang anh gia lai','al qadisiya':'al qadsiah','al qadsia':'al qadsiah',
 'al qadisiyah':'al qadsiah','pakhtakor tashkent':'pakhtakor'
};
function teamKey(x){
 let t=norm(x).replace(/\b(football club|futbol club|soccer club)\b/g,' ').trim();
 t=t.replace(/\s+(?:a|b|f|s|c)\s+c$/,'').trim(); // B.C / F.C / A.C / S.C
 // Chỉ bỏ hậu tố CLB, KHÔNG bỏ U23, Women, B, II hay đội trẻ.
 for(let i=0;i<3;i++){
  const after=t.replace(/\s+(?:fc|cf|sc|ac|bc|afc|scc|fk|sk|club)$/,'').trim();
  if(after===t)break;t=after;
 }
 return ALIASES[t]||t;
}
function levenshtein(a,b){
 if(a===b)return 0;const prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  let diag=prev[0];prev[0]=i;
  for(let j=1;j<=b.length;j++){
   const old=prev[j];prev[j]=Math.min(prev[j]+1,prev[j-1]+1,diag+(a[i-1]===b[j-1]?0:1));diag=old;
  }
 }return prev[b.length];
}
function teamSimilarity(a,b){
 const A=teamKey(a),B=teamKey(b);
 if(!A||!B)return 0;if(A===B)return 1;
 // Ngăn ghép đội chính với U21/U23, Women, đội B/II/Primavera.
 const flag=x=>new Set(x.split(' ').filter(t=>/^(?:u\d+|women|woman|ladies|fem|femenino|feminino|primavera|reserves?|ii|iii|b|2)$/.test(t)));
 const fa=flag(A),fb=flag(B);
 if([...fa].some(t=>!fb.has(t))||[...fb].some(t=>!fa.has(t)))return 0;
 const ta=A.split(' '),tb=B.split(' ');
 const common=ta.filter(t=>tb.includes(t)).length;
 const dice=2*common/(ta.length+tb.length);
 const char=1-levenshtein(A,B)/Math.max(A.length,B.length);
 // Tên ngắn hợp lệ khi là cả một token (ví dụ Pakhtakor / Pakhtakor Tashkent).
 if((ta.length===1||tb.length===1)&&common===1&&Math.min(A.length,B.length)>=5)return .90;
 return Math.max(char*.9,dice*.9,0);
}

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
function similar(a,b){return teamSimilarity(a,b)>=.82;}

function leagueOK(requested,actual){
 if(!requested)return true;
 const aliases={
  'epl':'premier league','ngoai hang anh':'premier league','english premier league':'premier league',
  'italy serie a':'serie a','italian serie a':'serie a',
  'la liga':'primera division','laliga':'primera division','j league':'j1 league',
  'afc giai vo dich champions elite':'afc champions league elite',
  'afc champions elite':'afc champions league elite',
  'afc champions league':'afc champions league elite'
 };
 const a=aliases[norm(requested)]||norm(requested),b=aliases[norm(actual)]||norm(actual);
 if(a===b)return true;
 if(a.length>=6&&b.length>=6&&(a.includes(b)||b.includes(a)))return true;
 return 1-levenshtein(a,b)/Math.max(a.length,b.length)>=.87;
}

function getInput(body){
 const home=clean(body.home),away=clean(body.away),league=clean(body.league);
 const kickoff=body.kickoff?iso(body.kickoff):body.kickoffVN?iso(body.kickoffVN+':00+07:00'):null;
 const date=kickoff?new Date(new Date(kickoff).getTime()+7*3600000).toISOString().slice(0,10):clean(body.date,10);
 if(!home||!away||home===away||!league||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Nhập home, away, league, ngày hoặc giờ đá VN.');
 const mode=String(body.mode||'FT').toUpperCase();const phase=String(body.phase||'PRE').toUpperCase().replace('T10','T-10');
 if(!['FT','H2','LIVE'].includes(mode)||!['PRE','T-10'].includes(phase))throw Error('Sai mode/phase');
 return {home,away,league,kickoff,date,phase,mode,fixtureId:Number.isInteger(Number(body.fixtureId))&&Number(body.fixtureId)>0?Number(body.fixtureId):null};
}
function suggested(f){return {
 fixtureId:f.fixture?.id,home:f.teams?.home?.name,away:f.teams?.away?.name,
 league:f.league?.name,kickoffISO:f.fixture?.date
};}
async function resolveFixture(x){
 // Lấy danh sách theo ngày VN rồi so khớp cả hai đội + giải + thời điểm.
 // Nếu người dùng CHỌN gợi ý, ID chính thức vẫn kiểm lại giải và giờ.
 if(x.fixtureId){
  const found=rows(await api('/fixtures',{id:x.fixtureId},1800000))[0];
  if(!found||!leagueOK(x.league,found.league?.name)||
   !similar(x.home,found.teams?.home?.name)||!similar(x.away,found.teams?.away?.name)||
   (x.kickoff&&Math.abs(Date.parse(found.fixture?.date)-Date.parse(x.kickoff))>120*60000))
   throw Error('FIXTURE ID không khớp giải/giờ, không tự ghép trận.');
  return found;
 }
 const raw=await api('/fixtures',{date:x.date,timezone:'Asia/Ho_Chi_Minh'},1800000);
 const sameLeague=rows(raw).filter(f=>leagueOK(x.league,f.league?.name));
 const pool=sameLeague.map(f=>{
  const homeScore=teamSimilarity(x.home,f.teams?.home?.name);
  const awayScore=teamSimilarity(x.away,f.teams?.away?.name);
  const minutes=x.kickoff?Math.abs(Date.parse(f.fixture?.date)-Date.parse(x.kickoff))/60000:0;
  return {f,homeScore,awayScore,minutes,
   confidence:(homeScore+awayScore)/2-Math.min(minutes,300)/2400};
 }).sort((a,b)=>b.confidence-a.confidence);
 const fits=pool.filter(c=>c.homeScore>=.82&&c.awayScore>=.82&&c.minutes<=90);
 if(!fits.length){
  const err=new Error('NO VERIFIED FIXTURE: không tìm được trận khớp an toàn. Bạn vẫn có thể dùng tên trên AiScore.');
  err.suggestions=pool.filter(c=>c.minutes<=120&&c.homeScore>=.45&&c.awayScore>=.45)
   .slice(0,4).map(c=>suggested(c.f));
  throw err;
 }
 if(fits.length>1&&fits[0].confidence-fits[1].confidence<.065){
  const err=new Error('AMBIGUOUS FIXTURE: có nhiều trận giống nhau. Chọn trận đúng từ gợi ý.');
  err.suggestions=fits.slice(0,5).map(c=>suggested(c.f));throw err;
 }
 return fits[0].f;
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
// Public web research: search only with user's Tavily key, no unauthorized scraping.
// A source hit is an unverified reference until both teams and fixture context match.
const RESEARCH_DOMAINS={
 aiscore:['aiscore.com'],
 experts:['sportsmole.co.uk','forebet.com','theanalyst.com','dimers.com','sportsgambler.com','betimate.com','bongdanet247.com'],
 alternatives:['espn.com','bbc.com','skysports.com','sofascore.com','flashscore.com']
};
function hostname(url){try{return new URL(url).hostname.replace(/^www\./,'').toLowerCase()}catch{return ''}}
function safePublicPage(v,x,channel){
 const url=String(v.url||'');if(!/^https:\/\//i.test(url))return null;
 const domain=hostname(url),text=clean([v.title,v.content].join(' '),2400);
 const a=teamKey(x.home),b=teamKey(x.away),t=teamKey(text);
 // Contains tokens from both teams; title/snippet match isn't sufficient for odds/XI verification.
 const relevant=(t.includes(a)&&t.includes(b))||
  (norm(text).includes(norm(x.home))&&norm(text).includes(norm(x.away)));
 const dated=text.includes(x.date)||text.includes(x.date.slice(0,4));
 const group=RESEARCH_DOMAINS[channel]||[];
 return {title:clean(v.title,200),url,domain,channel,summary:clean(v.content,600),
  fixtureNamesMatched:relevant,yearMentioned:dated,
  providerFamily:domain,reviewedAt:new Date().toISOString(),
  status:relevant&&dated?'CANDIDATE_MATCH_NOT_FACT_VERIFIED':'UNVERIFIED_SEARCH_HIT',
  verified:false,officialXI:false,oddsVerified:false,forecastVerified:false,
  recognizedSource:group.some(d=>domain===d||domain.endsWith('.'+d))};
}
async function searchExperts(x,warnings){
 if(!TAVILY){warnings.push('NO TAVILY_API_KEY: không thể tự tìm AiScore/public expert pages từ backend.');return [];}
 const specs=[
  {channel:'aiscore',query:`site:aiscore.com ${x.home} ${x.away} ${x.date} match lineups odds H2H`},
  {channel:'experts',query:`${x.home} vs ${x.away} ${x.league} ${x.date} preview prediction Sports Mole Forebet Opta`},
  {channel:'alternatives',query:`${x.home} ${x.away} ${x.league} ${x.date} team news confirmed lineup form injuries`}];
 const out=(await Promise.all(specs.map(async spec=>{
  const ctr=new AbortController(),timer=setTimeout(()=>ctr.abort(),8500);
  try{
   const response=await fetch('https://api.tavily.com/search',{
    method:'POST',headers:{'content-type':'application/json'},signal:ctr.signal,
    body:JSON.stringify({api_key:TAVILY,query:spec.query,search_depth:'basic',max_results:5})});
   if(!response.ok)throw Error('Tavily HTTP '+response.status);
   const raw=await response.json();
   return (raw.results||[]).map(item=>safePublicPage(item,x,spec.channel)).filter(Boolean);
  }catch(e){warnings.push('WEB RESEARCH '+spec.channel+': '+clean(e.message));return []}
  finally{clearTimeout(timer)}
 }))).flat();
 const unique=new Map();for(const e of out){if(!unique.has(e.url))unique.set(e.url,e);}
 const sorted=[...unique.values()].sort((a,b)=>
  Number(b.fixtureNamesMatched)-Number(a.fixtureNamesMatched)||Number(b.yearMentioned)-Number(a.yearMentioned));
 if(!sorted.some(x=>x.channel==='aiscore'&&x.fixtureNamesMatched))
  warnings.push('AiScore public page not verified; no scraping or fabricated AiScore stats.');
 return sorted.slice(0,15);
}

// Historical market archive: only snapshots actually observed by this service.
// Render Free local files are ephemeral. Use external durable storage for long-term archive.
function archiveForTeams(teamIds,limit=18){
 const result=[],seen=new Set();
 for(const snap of snapshots.slice().reverse()){
  const match=snap.match||{};
  if(!teamIds.includes(match.homeId)&&!teamIds.includes(match.awayId))continue;
  if(!Array.isArray(snap.odds)||!snap.odds.length)continue;
  const key=match.fixtureId+'|'+snap.phase+'|'+snap.at;
  if(seen.has(key))continue;seen.add(key);
  result.push({fixtureId:match.fixtureId,home:match.home,away:match.away,
   phase:snap.phase,observedAt:snap.at,bookmakers:[...new Set(snap.odds.map(q=>q.book))],
   odds:snap.odds.slice(0,80),evidence:'OWN_FETCH_SNAPSHOT_NOT_VERIFIED_OPEN_CLOSE'});
  if(result.length>=limit)break;
 }
 return result;
}

// Bayesian posterior and score-level stress: explicitly exploratory, never MASTER score.
function makePRNG(seed){let s=seed>>>0;return ()=>{s=(s+0x6D2B79F5)|0;
 let t=Math.imul(s^(s>>>15),1|s);t^=t+Math.imul(t^(t>>>7),61|t);
 return ((t^(t>>>14))>>>0)/4294967296;}}
function sampleNormal(rng){return Math.sqrt(-2*Math.log(Math.max(1e-12,rng())))*Math.cos(2*Math.PI*rng());}
function sampleGamma(shape,rng){
 if(shape<1)return sampleGamma(shape+1,rng)*Math.pow(Math.max(1e-12,rng()),1/shape);
 const d=shape-1/3,c=1/Math.sqrt(9*d);
 for(let i=0;i<80;i++){const z=sampleNormal(rng),v=Math.pow(1+c*z,3);
  if(v<=0)continue;const u=rng();if(u<1-.0331*z*z*z*z||Math.log(Math.max(1e-12,u))<.5*z*z+d*(1-v+Math.log(v)))return d*v;}
 return shape;
}
function samplePoisson(l,rng){const bound=Math.exp(-Math.min(18,Math.max(0,l)));
 let k=0,p=1;do{k++;p*=Math.max(1e-12,rng())}while(p>bound&&k<40);return k-1;}
function advancedQuant(homeGames,awayGames,homeId,awayId,fixtureId,odds){
 const h=goalAverages(homeGames,homeId),a=goalAverages(awayGames,awayId);
 if(!h||!a||h.n<5||a.n<5)return {status:'NO MODEL: fewer than five games per team',verified:false};
 const pooled=(h.scored+h.conceded+a.scored+a.conceded)/4;
 const k=4; // declared empirical-Bayes prior equivalent games, NOT learned optimal parameter
 const muH=(h.n*(.53*h.scored+.47*a.conceded)+k*pooled)/(h.n+k);
 const muA=(a.n*(.53*a.scored+.47*h.conceded)+k*pooled)/(a.n+k);
 const shapeH=k*pooled+h.n*(.53*h.scored+.47*a.conceded);
 const shapeA=k*pooled+a.n*(.53*a.scored+.47*h.conceded);
 const betaH=k+h.n,betaA=k+a.n;
 let seed=Number(fixtureId)||1;const rng=makePRNG(seed);
 const N=4000,scores=new Map();
 for(let i=0;i<N;i++){
  const lH=sampleGamma(Math.max(.01,shapeH),rng)/betaH;
  const lA=sampleGamma(Math.max(.01,shapeA),rng)/betaA;
  const hs=samplePoisson(lH,rng),as=samplePoisson(lA,rng);
  const key=hs+':'+as;scores.set(key,(scores.get(key)||0)+1);
 }
 const simulated=[...scores].map(([score,count])=>({home:+score.split(':')[0],away:+score.split(':')[1],p:count/N}));
 const prob=fn=>round(simulated.reduce((s,v)=>s+(fn(v)?v.p:0),0));
 const diagnostics={homeWin:prob(v=>v.home>v.away),draw:prob(v=>v.home===v.away),
  awayWin:prob(v=>v.home<v.away),dogScores:prob(v=>v.away>=1),
  blowout3:prob(v=>Math.abs(v.home-v.away)>=3),
  favoriteThreePlus:prob(v=>v.home>=3),totalFourPlus:prob(v=>v.home+v.away>=4),
  lowEvent01:prob(v=>v.home+v.away<=1),
  scoreClusters:simulated.slice().sort((a,b)=>b.p-a.p).slice(0,6)};
 const cases=[];
 for(const q of odds.filter(o=>['HDC','TX'].includes(o.market))){
  for(const side of q.market==='HDC'?['HOME','AWAY']:['OVER','UNDER']){
   const line=q.market==='HDC'&&side==='AWAY'?-q.line:q.line;
   const price=q.market==='HDC'?(side==='HOME'?q.homePrice:q.awayPrice):(side==='OVER'?q.overPrice:q.underPrice);
   if(!(price>1))continue;
   let ev=0;for(const r of simulated)ev+=r.p*profit(settle(q.market,side,line,r.home,r.away),price);
   cases.push({market:q.market,side,line,book:q.book,decimal:price,scenarioEV:round(ev)});
  }
 }
 return {status:'EXPLORATORY NOT CALIBRATED',verified:false,
  methods:['Empirical-Bayes shrinkage (declared prior strength 4 games)',
   'Gamma-Poisson posterior predictive Monte Carlo, seeded 4,000 draws',
   'Score-cluster stress and blowout tail'],
  dixonColes:'NOT FITTED: insufficient comparable scoreline data for calibrated rho',
  lambda:{home:round(muH),away:round(muA)},assumptions:{priorGames:k,priorMean:round(pooled),seed,N,
   inputs:'Historical scorelines via API-Football, NOT xG; opponent quality not calibrated'},
  diagnostics,scenarioEdges:cases.sort((a,b)=>b.scenarioEV-a.scenarioEV).slice(0,12),
  gate:'NOT EVIDENCE FOR MASTER SCORE >=85'};
}
const phaseCacheTTL=p=>p==='T-10'?55000:720000;
// Optional independent odds provider (The Odds API v4). Not the same as TheOddsAPI.
// NFL/NBA free tiers do not imply soccer coverage; validate plan errors without fabricating lines.
function oddsSportKey(league){
 const l=norm(league);
 if(/serie a|italian serie a/.test(l))return 'soccer_italy_serie_a';
 if(/premier league|ngoai hang anh|\bepl\b/.test(l))return 'soccer_epl';
 if(/la liga|primera division/.test(l))return 'soccer_spain_la_liga';
 if(/bundesliga/.test(l))return 'soccer_germany_bundesliga';
 if(/ligue 1|ligue one/.test(l))return 'soccer_france_ligue_one';
 if(/champions league|c1|ucl/.test(l))return 'soccer_uefa_champs_league';
 return null;
}
async function fetchSecondaryOdds(x,fixture,warnings){
 if(!SECONDARY_ODDS_KEY)return [];
 const sport=oddsSportKey(x.league);
 if(!sport){warnings.push('THE_ODDS_API: no supported sport key for this league');return []}
 const u=new URL('https://api.the-odds-api.com/v4/sports/'+sport+'/odds');
 for(const [k,v] of Object.entries({apiKey:SECONDARY_ODDS_KEY,regions:'eu',markets:'h2h,spreads,totals',oddsFormat:'decimal'}))
  u.searchParams.set(k,v);
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);
 try{
  const r=await fetch(u,{signal:ctrl.signal});
  if(!r.ok){warnings.push('THE_ODDS_API: HTTP '+r.status+' — check coverage, subscription, quota');return []}
  const events=await r.json();if(!Array.isArray(events))return [];
  const f=events.find(t=>teamSimilarity(t.home_team,fixture.home)>=.82&&
   teamSimilarity(t.away_team,fixture.away)>=.82&&
   Math.abs(Date.parse(t.commence_time)-Date.parse(fixture.date))<=120*60000);
  if(!f)return [];
  const now=new Date().toISOString(),out=[];
  const push=(book,key,market,line,home,away,draw,updated)=>{
   if(!(home>1.001&&away>1.001)||market==='1X2'&&!(draw>1.001))return;
   out.push({market,kind:market,book,bookmakerId:'ODDS_V4:'+key,feedId:'ODDS_V4:'+key,line,
    homePrice:market==='TX'?undefined:home,awayPrice:market==='TX'?undefined:away,
    overPrice:market==='TX'?home:undefined,underPrice:market==='TX'?away:undefined,
    drawPrice:market==='1X2'?draw:undefined,
    a:home,b:away,c:market==='1X2'?draw:null,observedAt:now,updatedAt:iso(updated),
    timestampKind:'PROVIDER_MARKET_LAST_UPDATE',format:'DEC',stage:x.phase,scope:'FT',
    verified:true,sourceUrl:'https://the-odds-api.com/liveapi/guides/v4/'});
  };
  for(const bk of f.bookmakers||[]){const book=bk.title||bk.key,key=bk.key||book;
   for(const m of bk.markets||[]){const v=m.outcomes||[];
    if(m.key==='h2h'){
     const h=v.find(o=>teamSimilarity(o.name,f.home_team)>=.82),a=v.find(o=>teamSimilarity(o.name,f.away_team)>=.82);
     const d=v.find(o=>/^(draw|tie)$/i.test(o.name));
     if(h&&a&&d)push(book,key,'1X2',null,n(h.price),n(a.price),n(d.price),m.last_update||bk.last_update);
    }
    if(m.key==='spreads'){
     const h=v.find(o=>teamSimilarity(o.name,f.home_team)>=.82),a=v.find(o=>teamSimilarity(o.name,f.away_team)>=.82);
     if(h&&a&&n(h.point)!==null&&Math.abs(n(h.point)+n(a.point))<1e-6)
      push(book,key,'HDC',n(h.point),n(h.price),n(a.price),null,m.last_update||bk.last_update);
    }
    if(m.key==='totals'){
     const h=v.find(o=>/^over$/i.test(o.name)),a=v.find(o=>/^under$/i.test(o.name));
     if(h&&a&&n(h.point)!==null&&n(h.point)===n(a.point))
      push(book,key,'TX',n(h.point),n(h.price),n(a.price),null,m.last_update||bk.last_update);
    }
   }
  }
  return out;
 }catch(e){warnings.push('THE_ODDS_API: '+clean(e.message,150));return []}
 finally{clearTimeout(timer)}
}
function crossBookAudit(quotes){
 const observations=[],markets=['1X2','HDC','TX'];
 for(const kind of markets){
  const groups=new Map();
  for(const q of quotes.filter(q=>q.market===kind)){
   const k=kind==='1X2'?'1X2':String(q.line);
   if(!groups.has(k))groups.set(k,new Map());
   const books=groups.get(k),identity=norm(q.book);
   const t=Date.parse(q.updatedAt||q.observedAt);
   const old=books.get(identity);if(!old||t>Date.parse(old.updatedAt||old.observedAt))books.set(identity,q);
  }
  for(const [line,uniqueBooks] of groups){
   const values=[...uniqueBooks.values()];
   const feeds=new Set(values.map(q=>q.feedId.split(':')[0]));
   if(values.length<2)continue;
   const nums=values.map(q=>q.a);
   observations.push({market:kind,line,distinctBookNames:values.length,providerFamilies:[...feeds],
    spread:round(Math.max(...nums)-Math.min(...nums),3),
    note:'Same-line price spread, not evidence of independent bookmakers or betting edge'});
  }
 }
 return {observations,warning:'Never count duplicate book quotes delivered by 2 aggregators as independent consensus.'};
}
async function research(x){
 const warnings=[],fixture=await resolveFixture(x),f=shortGame(fixture),ko=fixture.fixture.date;
 if(Date.now()>=Date.parse(ko))throw Error('PRE/T-10 đã đóng khi trận bắt đầu; dùng hậu kiểm với dữ liệu snapshot cũ.');
 if(x.phase==='T-10'&&(new Date(ko).getTime()-Date.now()>12*60000||new Date(ko)<=new Date()))
   throw Error('T-10 chỉ chạy trong 12 phút trước giờ đá, trước kickoff.');
 const ids=[f.homeId,f.awayId];if(!ids.every(Boolean))throw Error('NO TEAM IDs');
 const to=new Date(Date.parse(ko)-86400000).toISOString().slice(0,10);
 const from=new Date(Date.parse(ko)-210*86400000).toISOString().slice(0,10);
 const endpoints=[
  // Free plan không dùng `last`: lấy khoảng ngày rồi lấy 10 trận gần nhất trong JS.
  ['h2h',()=>api('/fixtures/headtohead',{h2h:ids.join('-'),from,to},3600000)],
  ['recentHome',()=>api('/fixtures',{team:ids[0],from,to,status:'FT'},3600000)],
  ['recentAway',()=>api('/fixtures',{team:ids[1],from,to,status:'FT'},3600000)],
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
 let h2h=pastOnly(rows(collected.h2h),ko).slice(0,10);
 if(!h2h.length){
  const both=[...homeGames,...awayGames];const seen=new Set();
  h2h=both.filter(g=>[g.teams?.home?.id,g.teams?.away?.id].includes(ids[0])&&
   [g.teams?.home?.id,g.teams?.away?.id].includes(ids[1]))
    .filter(g=>{const id=g.fixture?.id;if(seen.has(id))return false;seen.add(id);return true;})
    .sort((a,b)=>Date.parse(b.fixture.date)-Date.parse(a.fixture.date)).slice(0,10);
  if(h2h.length)warnings.push('H2H derived from recent fixture lists, not full historical sample.');
 }
 const lineups=rows(collected.lineups);
 const homeXI=lineups.find(a=>Number(a.team?.id)===ids[0]);
 const awayXI=lineups.find(a=>Number(a.team?.id)===ids[1]);
 const lineupObject={status:homeXI?.startXI?.length===11&&awayXI?.startXI?.length===11?'OFFICIAL':'NO DATA',
  verified:!!(homeXI?.startXI?.length===11&&awayXI?.startXI?.length===11),
  sourceUrl:'https://www.api-football.com/documentation-v3#tag/Lineups',
  home:{formation:homeXI?.formation||null,starting:(homeXI?.startXI||[]).map(v=>v.player?.name),bench:(homeXI?.substitutes||[]).map(v=>v.player?.name)},
  away:{formation:awayXI?.formation||null,starting:(awayXI?.startXI||[]).map(v=>v.player?.name),bench:(awayXI?.substitutes||[]).map(v=>v.player?.name)}};
 const inj=rows(collected.injuries).map(v=>({team:v.team?.name,player:v.player?.name,reason:v.player?.reason||v.player?.type}));
 const primaryMarket=collected.odds?parseOdds(collected.odds,f.fixtureId,x.phase):[];
 const secondaryMarket=await fetchSecondaryOdds(x,f,warnings);
 const market=[...primaryMarket,...secondaryMarket];
 const crossBook=crossBookAudit(market);
 const model=buildModel(homeGames,awayGames,...ids);
 const ladder=quantLadder(model,market),top=ladder.find(c=>c.ev>0.02)||null;
 const experts=await searchExperts(x,warnings);
 const advanced=advancedQuant(homeGames,awayGames,...ids,f.fixtureId,market);
 const observedArchive=archiveForTeams(ids);
 const prediction=rows(collected.predictions)[0]||null;
 if(!market.length)warnings.push('NO VERIFIED PRICE (no supported odds lines found).');
 if(!market.some(v=>v.market==='1X2'))warnings.push('NO 1X2 MARKET');
 if(!market.some(v=>v.market==='HDC'))warnings.push('NO HDC MARKET');
 if(!market.some(v=>v.market==='TX'))warnings.push('NO TOTAL MARKET');
 if(!model)warnings.push('NO QUANT MODEL: fewer than five completed games per team.');
 if(!lineupObject.verified)warnings.push('OFFICIAL XI: NO DATA hoặc endpoint bị giới hạn quyền; không suy đoán đội hình.');
 warnings.push('NO AISCORE DIRECT FEED: optional indexed public AiScore search is NOT the same as verified AiScore match data.');
 warnings.push('NO MASTER RUBRIC SCORE: 85-GATE → PASS.');
 if(!TAVILY)warnings.push('Website worldwide scan requires optional TAVILY_API_KEY (server-side).');
 const match={home:f.home,away:f.away,kickoffISO:ko,league:f.league,fixtureId:f.fixtureId,
  verified:true,sourceUrl:'https://www.api-football.com/documentation-v3#tag/Fixtures'};
 const marketNotes=[];
 const old=snapshots.filter(s=>s.match?.fixtureId===f.fixtureId&&s.mode===x.mode&&s.phase!==x.phase).at(-1);
 if(old){for(const q of market){const earlier=(old.odds||[]).filter(v=>v.market===q.market&&v.bookmakerId===q.bookmakerId);
  for(const p of earlier){if(q.line===p.line&&q.market!=='1X2')marketNotes.push(`${q.book} ${q.market} SAME LINE ${q.line}: ${p.a} → ${q.a}`);
   else if(q.market!=='1X2'&&q.line!==p.line)marketNotes.push(`${q.book} ${q.market} LINE MOVE ${p.line} → ${q.line}; do not compare juice across lines`);
  }} }
 const result={
  apiVersion:'V9.5 WORLD RESEARCH + QUANT DATA PIPELINE',inputNames:{home:x.home,away:x.away,league:x.league},phase:x.phase,mode:x.mode,match,fixture:match,summary:'Đã thu thập các mục API-Football hiện có; mã nghiên cứu không phải mã CHỐT khi thiếu rubric và các kiểm chứng.',
  injuriesHome:inj.filter(v=>similar(v.team,f.home)).map(v=>v.player+': '+v.reason).join('; ')||'NO DATA',
  injuriesAway:inj.filter(v=>similar(v.team,f.away)).map(v=>v.player+': '+v.reason).join('; ')||'NO DATA',
  lineupHome:lineupObject.home.starting.length?lineupObject.home.starting.join(', '):'NO DATA',
  lineupAway:lineupObject.away.starting.length?lineupObject.away.starting.join(', '):'NO DATA',
  lineup:lineupObject,
  aiscore:{status:'NOT CONNECTED',h2h:[],recentHome:[],recentAway:[],historicalOdds:[],note:'Not AiScore; see recentApiSports'},
  recentApiSports:{h2h:h2h.map(shortGame),home:homeGames.map(shortGame),away:awayGames.map(shortGame)},
  historicalOdds:{status:observedArchive.length?'PARTIAL OWN SNAPSHOTS':'NO ODDS ARCHIVE',
   entries:observedArchive,source:'Snapshots explicitly observed by this app; NOT AiScore history, OPEN/CLOSE unverified',
   persistent:false,note:'Render Free local disk is ephemeral. Back up/export and configure durable DB for long term.'},
  odds:market,markets:{'1X2':market.filter(v=>v.market==='1X2'),HDC:market.filter(v=>v.market==='HDC'),TX:market.filter(v=>v.market==='TX')},
  marketAudit:crossBook,marketPath:{snapshotsAvailable:!!old,notes:marketNotes,opening:old?.phase==='OPEN'?old.odds:null},
  deVig1X2:noVig(market),model,quant:{method:model?.method||'NO MODEL',candidates:ladder.slice(0,50),advanced},
  researchCode:top?`${top.kind==='HDC'?(top.side==='HOME'?f.home:f.away)+' '+(top.line>=0?'+':'')+top.line+' HDC FT90':(top.side==='OVER'?'Tài ':'Xỉu ')+top.line+' FT90'}`:'NO VERIFIED CODE',
  entry:top?{book:top.book,line:top.line,hk:top.hk,decimal:top.dec,observedAt:top.at,sourceUrl:top.sourceUrl}:null,
  prediction:prediction?{winner:prediction.predictions?.winner,goals:prediction.predictions?.goals,percent:prediction.predictions?.percent,source:'API-Football predictions; independent of expert consensus'}:null,
  experts,aiscorePublicReferences:experts.filter(e=>e.channel==='aiscore'),
  expertConsensus:{status:experts.length?'SEARCH_REFERENCES_ONLY':'NO VERIFIED SOURCES',sourceCount:0,confidence:0,
  sourceFamilies:[...new Set(experts.filter(e=>e.channel==='experts').map(e=>e.providerFamily))],
  summary:'Không suy ra HDC/TX hay xác suất từ snippet; không đếm nguồn chung một feed',sources:experts},
  superComputerConsensus:{status:prediction?'API_PREDICTION_REFERENCE':'NO MODEL',sourceCount:0,confidence:0,summary:'Không giả vờ chạy siêu máy tính độc lập'},
  contextImpact:{status:'NOT SCORED',sourceCount:0,score:{homeHdc:0,awayHdc:0,over:0,under:0}},
  marketImpact:{status:'NOT SCORED',sourceCount:0,score:{homeHdc:0,awayHdc:0,over:0,under:0}},
  masterScore:null,status:'PASS',final:'PASS — NO VERIFIED SCORE',warnings,
  sourceQuality:{fixture:true,publicAiScoreCandidates:experts.some(e=>e.channel==='aiscore'&&e.fixtureNamesMatched),
   ownArchivedOddsCount:observedArchive.length,odds:market.length>0,officialXI:lineupObject.verified,availability:!!collected.injuries,aiScore:false,expertForecastsVerified:false,marketPathVerified:false,quantCalibrated:false,failureVerified:false,exactEntryVerified:false,masterRubric:false},
  quota:{usedToday:calls,budget:MAX_DAY,remainingReported:upstreamRemaining},
  capturedAt:new Date().toISOString()
 };
 const snap={id:Date.now().toString(36)+Math.random().toString(36).slice(2,8),match:{...match,homeId:f.homeId,awayId:f.awayId},mode:x.mode,phase:x.phase,at:result.capturedAt,odds:market,decision:'PASS',code:result.researchCode,masterScore:null};
 snapshots.push(snap);snapshots=snapshots.slice(-500);if(!persist())warnings.push('STORAGE EPHEMERAL: configure a persistent DATA_DIR.');
 return result;
}
app.get('/',(_,res)=>res.json({ok:true,service:'SOI FULL AI MASTER V9.5',endpoint:'/api/research',app:'/app',apiFootballConfigured:!!KEY,tavilyConfigured:!!TAVILY,secondaryOddsConfigured:!!SECONDARY_ODDS_KEY,remainingReported:upstreamRemaining,note:'No verified MASTER score without full rubric; PASS'}));
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
app.get('/health',(_,res)=>res.json({ok:true,version:'9.5-evidence-and-bayesian-api',keyConfigured:!!KEY,secondaryOddsConfigured:!!SECONDARY_ODDS_KEY,callsToday:calls,remainingReported:upstreamRemaining}));
app.post('/api/research',token,throttle,async(req,res)=>{try{
 const x=getInput(req.body||{});
 if(x.mode!=='FT')return res.status(422).json({error:'H2/LIVE requires separate markets and models; not auto-scored in V8.'});
 const result=await research(x);res.json(result);
 }catch(e){res.status(/NO VERIFIED FIXTURE|KICKOFF MISMATCH|AMBIGUOUS/.test(e.message)?404:/quota|APISPORTS_KEY/.test(e.message)?503:400).json({status:'PASS',masterScore:null,error:e.message,suggestions:e.suggestions||[]});}});
app.get('/api/history',token,(req,res)=>res.json(snapshots.filter(s=>!req.query.fixtureId||Number(req.query.fixtureId)===s.match.fixtureId).slice(-120)));
// Post-match official 90-minute score; never pretend a completed-game score is PRE information.
app.get('/api/official-result',token,throttle,async(req,res)=>{
 const id=Number(req.query.fixtureId);
 if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:'fixtureId required'});
 try{
  const f=rows(await api('/fixtures',{id},120000))[0];
  const st=f?.fixture?.status?.short;
  if(!f||!['FT','AET','PEN'].includes(st))return res.status(409).json({
   error:'No official completed fixture yet',fixtureId:id,status:st||'NO DATA'});
  // goals counts may include extra-time for AET/PEN. Cannot claim FT90 in those cases.
  if(st!=='FT')return res.status(409).json({error:'FT90 score not verified for overtime/penalties; enter regulation score with evidence',status:st});
  res.json({fixtureId:id,official:true,scope:'FT90',status:st,
   home:f.teams?.home?.name,away:f.teams?.away?.name,
   ft:[n(f.goals?.home),n(f.goals?.away)],
   ht:[n(f.score?.halftime?.home),n(f.score?.halftime?.away)],
   source:'API-Football /fixtures',checkedAt:new Date().toISOString()});
 }catch(e){res.status(502).json({error:clean(e.message,180)})}
});

// SOI FULL AI MASTER V9.5: Full V6-style app served from the same Render service.
const FRONTEND_V9=String.raw`<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>SOI FULL AI + AiScore MASTER V9.5</title>
<style>
:root{color-scheme:dark;--bg:#071018;--card:#122332;--line:#315068;--ink:#ebf5fc;--muted:#a5baca;--a:#70c6ff;--green:#56e6af;--yellow:#ffd37b;--red:#ff8998}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 12% 0,#173855,#071018 50%);color:var(--ink);font:14px/1.55 system-ui,-apple-system,sans-serif}main{max-width:1140px;margin:auto;padding:14px 13px 60px}.hero,.panel{background:linear-gradient(140deg,#142638,#0c1926);border:1px solid var(--line);border-radius:16px;padding:16px;margin:12px 0}h1{font-size:22px;margin:0 0 5px}h2{font-size:17px;margin:0 0 10px}h3{font-size:14px;margin:14px 0 6px}p{margin:7px 0}.muted,small{color:var(--muted)}label{display:block;color:#bed4e4;font-size:12px;font-weight:650;margin:6px 0 4px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.wide{grid-column:1/-1}input,select,textarea{background:#081724;border:1px solid #46677e;border-radius:9px;color:#fff;font:inherit;padding:11px;width:100%;min-width:0}textarea{min-height:86px}button{background:#214359;color:#fff;border:1px solid #57758d;border-radius:10px;padding:11px 14px;font:inherit;font-weight:700;cursor:pointer}button.primary{background:#39b997;color:#04241c;border-color:#39b997}button:disabled{opacity:.5;cursor:wait}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.actions>*{flex:1;min-width:110px}.pill{border:1px solid #42647e;border-radius:18px;padding:3px 9px;font-size:11px;background:#152d3b}.strip{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.note{border-left:3px solid var(--yellow);padding:10px 12px;background:#30291b;border-radius:9px;font-size:12px}.result{padding:14px;border:1px solid #427e87;border-radius:12px;background:#0b2630;white-space:pre-wrap;overflow-wrap:anywhere;font-weight:650}.sub{font-size:12px;color:var(--muted)}.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:600px;font-size:12px}th,td{padding:9px;border-bottom:1px solid #315068;vertical-align:top;text-align:left}th{color:#cce7fb}.group{padding:10px 0;border-bottom:1px solid #315068}details{margin-top:12px}summary{cursor:pointer;color:var(--a);font-weight:750;padding:8px 0}.layer{border-bottom:1px solid #29475a;padding:8px 0;display:flex;justify-content:space-between;gap:12px}.tabs{display:flex;flex-wrap:wrap;gap:6px}.tabs button{flex:1}.tabs .on{background:#267c74;border-color:#58d8bc}.hidden{display:none!important}a{color:#8dccff}pre{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#071521;padding:12px;border-radius:9px}.green{color:var(--green)}.warn{color:var(--yellow)}.red{color:var(--red)}footer{font-size:11px;color:var(--muted)}@media(max-width:640px){.grid{grid-template-columns:1fr}.hero,.panel{padding:12px}h1{font-size:20px}}
</style></head><body><main>
<div class="hero"><h1>⚽ SOI FULL AI + AiScore MASTER V9.5</h1><p class="muted">Giao diện V6 + API-Football V8.2 · PRE → T-10 · 1X2 ↔ HDC ↔ Tài/Xỉu · Asian settlement · 85-GATE</p><div class="strip"><span class="pill">FT90</span><span class="pill">H2/LIVE TÁCH BIỆT</span><span class="pill">EXACT ENTRY</span><span class="pill">NO CHASE</span><span class="pill">NO FAKE SCORE</span></div></div>
<section class="panel"><h2>1. Thông tin trận — chỉ 4 ô</h2><form id="matchForm"><div class="grid"><div><label>Đội nhà (tên theo AiScore)</label><input name="home" placeholder="Atalanta B.C" autocomplete="off" required></div><div><label>Đội khách</label><input name="away" placeholder="Venezia FC" autocomplete="off" required></div><div><label>Giải đấu</label><input name="league" placeholder="Serie A" required></div><div><label>Ngày và giờ Việt Nam</label><input name="kickoffVN" type="datetime-local" required></div></div><div class="actions"><button type="submit" id="preBtn" class="primary">🔎 SOI FULL AI PRE</button><button type="button" id="t10Btn">🔄 KIỂM TOÁN T-10</button></div></form><div id="status" class="note">Sẵn sàng. Chưa lấy dữ liệu.</div><div id="suggestions"></div><p class="sub">App tự lấy những dữ liệu API-FOOTBALL có quyền truy cập. Tên đội được chuẩn hóa và đối chiếu đúng giải/giờ. Thiếu nguồn, odds hoặc rubric MASTER → PASS.</p></section>
<div class="tabs"><button class="on" data-tab="board">MÃ NGHIÊN CỨU</button><button data-tab="evidence">KIỂM CHỨNG</button><button data-tab="history">LỊCH SỬ & HẬU KIỂM</button><button data-tab="extra">H2/LIVE & API</button></div>
<section id="board" class="panel"><h2>2. Kết quả PRE / T-10</h2><div id="verdict" class="result">Chưa phân tích trận nào.</div><div id="snapshots" class="sub"></div><details open><summary>LINE LADDER / Poisson / phân phối thắng thua</summary><div id="quant">Chưa có dữ liệu.</div></details></section>
<section id="evidence" class="panel hidden"><h2>3. Kiểm chứng MASTER 0–114</h2><div class="note">114 mục là tiêu chuẩn kiểm toán, không có bảng trọng số gốc được khóa. Phần nào chưa có nguồn độc lập sẽ ghi NO DATA; điểm API-Football hay dự báo Poisson không phải MASTER SCORE.</div><div id="audit"></div><h3>AiScore, H2H và trận gần đây của hai đội</h3><div id="recent"></div><h3>Đội hình và vắng mặt</h3><div id="lineup"></div><h3>1X2 / HDC / Tài Xỉu — thị trường thật nếu được cấp quyền</h3><div id="market"></div><h3>WORLD EXPERT / dự báo bên ngoài</h3><div id="experts"></div><h3>Nguồn nghiên cứu hỗ trợ</h3><div id="links"></div><details><summary>JSON dữ liệu API đã nhận (không bao gồm khóa)</summary><pre id="raw"></pre></details></section>
<section id="history" class="panel hidden"><h2>4. PRE/T-10 & HẬU KIỂM XƯƠNG MÁU</h2><div id="histlist"></div><h3>Chấm theo kết quả thực tế (sau trận)</h3><div class="grid"><div class="wide"><label>Phiếu phân tích</label><select id="ticket"><option value="">Chọn phiếu</option></select></div><div><label>HT đội nhà</label><input id="hh" type="number" min="0" step="1"></div><div><label>HT đội khách</label><input id="ha" type="number" min="0" step="1"></div><div><label>FT đội nhà</label><input id="fh" type="number" min="0" step="1"></div><div><label>FT đội khách</label><input id="fa" type="number" min="0" step="1"></div><div class="wide"><label>Bài học quy trình / failure path, không outcome-fit</label><textarea id="lesson"></textarea></div></div><div class="actions"><button id="settle">CHẤM HẬU KIỂM</button><button id="export">SAO LƯU JSON</button><button id="import">KHÔI PHỤC JSON</button></div><input id="file" type="file" accept=".json,application/json" class="hidden"><div id="settleresult" class="result">PASS = vốn thực bằng 0; chỉ kiểm định mã nghiên cứu giả định nếu có.</div><p id="stats" class="sub"></p></section>
<section id="extra" class="panel hidden"><h2>5. H2 / LIVE & Kết nối</h2><div class="note">H2/LIVE không được tái sử dụng mô hình FT. Backend hiện chưa có phân phối bàn và odds đúng phạm vi thanh toán cho H2/LIVE, nên giữ PASS. Không giả lập một mã H2/LIVE bằng kèo FT.</div><div class="actions"><button id="h2">KIỂM TRA H2</button><button id="live">KIỂM TRA LIVE</button></div><label>Mã truy cập ứng dụng (chỉ khi bạn cấu hình APP_ACCESS_TOKEN ở Render)</label><input id="token" type="password" autocomplete="off" placeholder="Để trống nếu không cấu hình"><div class="actions"><button id="health">KIỂM TRA MÁY CHỦ</button><button id="diag">KIỂM TRA API-FOOTBALL</button><button id="tests">TEST KÈO CHÂU Á</button></div><pre id="extrares">Gọi dữ liệu từ chính máy chủ đang mở trang /app.</pre><p class="sub">T-10 tự chạy chỉ khi trang còn mở, giờ đá hợp lệ và API đủ quota. Render Free có thể ngủ, không thay thế hệ thống lịch chạy độc lập. Lịch sử trong thiết bị có thể mất nếu xóa dữ liệu trình duyệt: hãy sao lưu JSON thường xuyên.</p></section>
<footer>MASTER V9 — Công cụ phân tích nghiên cứu, không đảm bảo thắng cược. Không giả xG, giá kèo, đội hình, bài chuyên gia, xác suất/EV độc lập hoặc MASTER SCORE.</footer>
</main><script>
(function(){'use strict';
const $=id=>document.getElementById(id);const KEY='soi_full_ai_master_v9_browser';
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const pct=x=>Number.isFinite(x)?(x*100).toFixed(1)+'%':'NO DATA';
const vn=x=>x?new Date(x).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false}):'NO DATA';
let db={schema:9,tickets:[],settlements:[]};try{const d=JSON.parse(localStorage.getItem(KEY)||'null');if(d&&d.schema===9&&Array.isArray(d.tickets)&&Array.isArray(d.settlements))db=d;}catch{}
let current=null,autoTimer=null,busy=false,chosenId=null;
function save(){try{localStorage.setItem(KEY,JSON.stringify(db));return true}catch{$('status').textContent='Không lưu được: hãy xuất JSON trước.';return false}}
function tab(which){for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('on',b.dataset.tab===which);for(const id of ['board','evidence','history','extra'])$(id).classList.toggle('hidden',id!==which)}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
function form(){const o=Object.fromEntries(new FormData($('matchForm')).entries());for(const v of ['home','away','league','kickoffVN'])if(!o[v])throw Error('Nhập đủ 4 ô thông tin trận.');const dt=new Date(o.kickoffVN+':00+07:00');if(!Number.isFinite(dt.getTime()))throw Error('Giờ Việt Nam không hợp lệ.');if(o.home.toLowerCase()===o.away.toLowerCase())throw Error('Hai đội bị trùng.');o.kickoff=dt.toISOString();o.mode='FT';if(chosenId)o.fixtureId=chosenId;return o}
let savedIn=null;try{savedIn=localStorage.getItem(KEY+'_input')}catch{}if(savedIn){try{const d=JSON.parse(savedIn);for(const k of ['home','away','league','kickoffVN'])if(d[k])$('matchForm').elements[k].value=d[k]}catch{}}
$('matchForm').querySelectorAll('input').forEach(el=>el.oninput=()=>{chosenId=null;$('suggestions').replaceChildren()});
function header(){const t=$('token').value;return {'Content-Type':'application/json',...(t?{'x-app-token':t}:{})}}
function asian(kind,side,line,h,a){if(!Number.isFinite(line)||Math.abs(line*4-Math.round(line*4))>1e-8)throw Error('Asian line không hợp lệ');const legs=Number.isInteger(line*2)?[line]:[Math.floor(line*2)/2,Math.ceil(line*2)/2];return legs.reduce((s,l)=>{const z=kind==='HDC'?(side==='HOME'?h-a:a-h)+l:(side==='OVER'?h+a-l:l-h-a);return s+(z>0?1:z<0?-1:0)/legs.length},0)}
const gain=(f,d)=>f>=0?f*(d-1):f;
const outcome=f=>({'1':'THẮNG ĐỦ','0.5':'THẮNG NỬA','0':'HOÀN TIỀN','-0.5':'THUA NỬA','-1':'THUA ĐỦ'})[String(f)]||'NO RESULT';
function code(c,x){if(!c)return 'NO VERIFIED CODE';return c.kind==='HDC'?(c.side==='HOME'?x.match.home:x.match.away)+' '+(c.line>=0?'+':'')+c.line+' HDC FT90':(c.side==='OVER'?'Tài ':'Xỉu ')+c.line+' FT90'}
function link(url,title){return typeof url==='string'&&/^https:\/\/[^\s]+$/.test(url)?'<a href="'+e(url)+'" target="_blank" rel="noopener noreferrer">'+e(title)+'</a>':e(title)}
function htmlTable(head,rows){return '<div class="scroll"><table><tr>'+head.map(x=>'<th>'+e(x)+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+e(v)+'</td>').join('')+'</tr>').join('')+'</table></div>'}
function showSuggestions(list,phase){const p=$('suggestions');p.replaceChildren();if(!list?.length)return;const info=document.createElement('p');info.textContent='Có các trận gần khớp. Chỉ chạm chọn khi đúng cặp đội/giải/giờ:';p.append(info);for(const s of list){const b=document.createElement('button');b.type='button';b.textContent=[s.home+' – '+s.away,s.league,vn(s.kickoffISO)].join(' | ');b.onclick=()=>{chosenId=s.fixtureId;run(phase)};p.append(b)}}
function audits(x){const w=x.warnings||[],r=x.recentApiSports||{},odds=x.odds||[],q=x.quant?.candidates||[],xi=x.lineup||{},src=x.sourceQuality||{};const checks=[
['Đúng trận, giải và giờ Việt Nam',!!src.fixture],['AiScore H2H và odds lịch sử',x.aiscore?.status==='VERIFIED'],['10 trận gần nhất đội nhà',(r.home||[]).length>=5],['10 trận gần nhất đội khách',(r.away||[]).length>=5],['H2H thực tế',(r.h2h||[]).length>0],['Odds lịch sử H2H + cả hai đội',x.historicalOdds?.status==='VERIFIED'],['1X2 cùng HDC cùng TOTAL',['1X2','HDC','TX'].every(k=>odds.some(z=>z.market===k))],['Pinnacle thực tế',odds.some(z=>/pinnacle/i.test(z.book))],['OFFICIAL XI đội hình đủ 2 đội',!!src.officialXI],['Chấn thương / treo giò có kiểm chứng',!!src.availability],['Expert review độc lập',!!src.expertForecastsVerified],['Market path OPEN→T-10→CLOSE',!!src.marketPathVerified],['Quant thực nghiệm có calibration',!!src.quantCalibrated],['Failure-first, tail và robustness được xác minh',!!src.failureVerified],['Exact price có thời điểm nguồn xác minh',!!src.exactEntryVerified],['Rubric MASTER và FINAL ≥85.0',!!src.masterRubric&&typeof x.masterScore==='number'&&x.masterScore>=85]];
$('audit').innerHTML=checks.map(c=>'<div class="layer"><span>'+e(c[0])+'</span><strong class="'+(c[1]?'green':'warn')+'">'+(c[1]?'CÓ DỮ LIỆU':'NO DATA')+'</strong></div>').join('')+'<h3>Cảnh báo nguồn và quota</h3>'+w.map(z=>'<div class="group warn">'+e(z)+'</div>').join('')+'<p class="sub">Lượt API còn lại theo nguồn: '+e(x.quota?.remainingReported??'NO DATA')+'. Không đếm nhiều nhà cái trong cùng một API là nhiều nhà cung cấp độc lập.</p>';
let recRows=(type,list)=>'<h3>'+type+'</h3>'+htmlTable(['Ngày','Cặp đội','Tỷ số','Giải'],(list||[]).map(g=>[vn(g.date),g.home+' – '+g.away,(g.scoreHome??'?')+'-'+(g.scoreAway??'?'),g.league]));
$('recent').innerHTML=recRows('H2H — API-Football (không phải AiScore)',r.h2h)+recRows('Đội nhà',r.home)+recRows('Đội khách',r.away);
$('lineup').innerHTML='<p>Đội hình: <b>'+e(x.lineup?.status||'NO DATA')+'</b></p><details><summary>Đội nhà</summary>'+e((xi.home?.starting||[]).join(', ')||'NO DATA')+'</details><details><summary>Đội khách</summary>'+e((xi.away?.starting||[]).join(', ')||'NO DATA')+'</details><p class="sub">Vắng nhà: '+e(x.injuriesHome||'NO DATA')+'; vắng khách: '+e(x.injuriesAway||'NO DATA')+'</p>';
$('market').innerHTML=htmlTable(['Book','Thị trường','Line nhà/Tổng','Giá nhà/Tài','Giá khách/Xỉu','Timestamp'],odds.slice(0,100).map(k=>[k.book,k.market,k.line??'1X2',k.homePrice??k.overPrice??'–',k.awayPrice??k.underPrice??'–',vn(k.updatedAt||k.observedAt)]))+'<p class="sub">Không suy giá mở/đóng nếu chưa lưu snapshot thực. Dấu thời gian tải dữ liệu không chứng minh giá đã tồn tại tại OPEN/PRE/T-10.</p>'+(x.marketPath?.notes||[]).map(z=>'<div class="group">'+e(z)+'</div>').join('');
$('experts').innerHTML='<p>API-Football prediction: '+e(JSON.stringify(x.prediction||'NO DATA'))+'</p>'+((x.experts||[]).map(z=>'<div class="group">'+link(z.url,z.title||'Preview')+' — '+e(z.summary||'')+' <small>(đường dẫn/tóm tắt, chưa xác minh dự đoán)</small></div>').join('')||'NO VERIFIED EXPERT SOURCES');
const names=['AiScore','Sports Mole','Forebet','Opta Analyst','Dimers','SportsGambler','Bongdanet247','Pinnacle'];const hosts=['aiscore.com','sportsmole.co.uk','forebet.com','theanalyst.com','dimers.com','sportsgambler.com','bongdanet247.com','pinnacle.com'];const term=x.match.home+' '+x.match.away+' '+x.match.league+' '+x.match.kickoffISO.slice(0,10);$('links').innerHTML=names.map((name,i)=>'<div class="group">'+link('https://www.google.com/search?q='+encodeURIComponent('site:'+hosts[i]+' '+term),'↗ '+name)+'</div>').join('');
$('market').innerHTML+='<h3>Market cross-book (cùng line)</h3>'+((x.marketAudit?.observations||[]).map(o=>'<div class="group">'+e(o.market)+' · '+e(o.line)+' · '+e(o.distinctBookNames)+' book names · dispersion '+e(o.spread)+'</div>').join('')||'NO SAME-LINE CONSENSUS')+'<p class="sub">Nguồn tổng hợp trùng bookmaker không là bằng chứng độc lập.</p>';
 $('recent').innerHTML+='<h3>Odds lịch sử do chính app từng quan sát</h3>'+
  (x.historicalOdds?.entries?.length?e(x.historicalOdds.entries.length+' snapshot lưu được; chưa xác minh OPEN/CLOSE.'):'NO HISTORICAL ODDS ARCHIVE')+
  '<p class="sub">AiScore public search: '+e(x.aiscorePublicReferences?.length||0)+' liên kết tham khảo, không coi là đã truy cập dữ liệu AiScore trực tiếp.</p>';
 $('raw').textContent=JSON.stringify(x,null,2);
}
function render(x,phase){current=x;const best=x.quant?.candidates?.find(c=>c.ev>0.02)||null;const old=db.tickets.slice().reverse().find(t=>t.mode==='FT'&&t.phase==='PRE'&&t.fixtureId===x.match.fixtureId);const prev=phase==='T-10'?(old?code(old.candidate,old.result):'NO PRE SAVED'):'—';const newCode=code(best,x);
$('verdict').textContent='⚽ '+x.match.home+' – '+x.match.away+' | '+x.match.league+'\nKickoff: '+vn(x.match.kickoffISO)+' VN\n'+phase+' / FT90\nMÃ THAM KHẢO: '+newCode+'\nGiá: '+(best?best.book+' · HK '+best.hk+' · Decimal '+best.dec+' · '+vn(best.at):'NO VERIFIED PRICE')+'\nPRE → T-10: '+(phase==='T-10'?(prev===newCode?'GIỮ HƯỚNG THAM KHẢO':'REBUILD / THAY HOẶC LOẠI'):'Chờ T-10')+'\nMASTER: NO VERIFIED SCORE\nFINAL: PASS — CHƯA ĐỦ 85-GATE / NGUỒN';
$('snapshots').textContent='Dữ liệu được lấy lúc '+vn(x.capturedAt)+'. Phiếu PRE và T-10 được lưu riêng trong thiết bị. Mã tham khảo/EV từ proxy bàn thắng KHÔNG phải mã CHỐT.';
const model=x.model,qs=x.quant?.candidates||[],clusters=[];if(model){let sum=0;for(let i=0;i<=6;i++)for(let j=0;j<=6;j++){let a=Math.exp(-model.lambdaHome),b=Math.exp(-model.lambdaAway);for(let k=1;k<=i;k++)a*=model.lambdaHome/k;for(let k=1;k<=j;k++)b*=model.lambdaAway/k;clusters.push({s:i+'-'+j,p:a*b});sum+=a*b}clusters.sort((a,b)=>b.p-a.p)}
$('quant').innerHTML='<p>'+(model?'λ nhà '+e(model.lambdaHome)+' | λ khách '+e(model.lambdaAway)+' | '+e(model.method)+' | MẪU '+e(model.sampleHome)+' / '+e(model.sampleAway):'NO MODEL: mẫu trận gần đây không đủ')+'</p><p class="note">Poisson dùng bàn thắng lịch sử, không phải xG. EV là chẩn đoán giả định, không phải lợi thế dự báo đã kiểm định. Không dùng để vượt MASTER 85-GATE.</p><p>Score clusters: '+(clusters.slice(0,6).map(s=>e(s.s)+' ('+pct(s.p)+')').join(' · ')||'NO DATA')+'</p>'+htmlTable(['Market / side','Line','Decimal','Book','EV chẩn đoán','Thắng đủ/nửa/hoàn/thua nửa/đủ'],qs.slice(0,35).map(c=>[c.kind+' '+c.side,c.line,c.dec,c.book,pct(c.ev),[1,.5,0,-.5,-1].map(v=>pct(c.cases?.[String(v)])).join(' / ')]));
// Keep original V6-style tabs and append optional quantitative diagnostics.
 const adv=x.quant?.advanced;
 if(adv){const panel=document.createElement('details');panel.innerHTML='<summary>Bayesian + Monte Carlo + failure tails (tham khảo)</summary><pre></pre>';
 panel.querySelector('pre').textContent=JSON.stringify(adv,null,2);$('quant').append(panel);}
 audits(x);tab('board');
}
function store(x,phase){const best=x.quant?.candidates?.find(c=>c.ev>0.02)||null;const id=Date.now().toString(36)+Math.random().toString(36).slice(2,8);db.tickets.push({id,mode:'FT',phase,fixtureId:x.match.fixtureId,result:{match:x.match},at:x.capturedAt,code:code(best,x),candidate:best?JSON.parse(JSON.stringify(best)):null,decision:'PASS',masterScore:null});db.tickets=db.tickets.slice(-250);save();renderHist()}
function renderHist(){const prev=$('ticket').value;const arr=db.tickets.slice().reverse();$('histlist').innerHTML=arr.map(t=>'<div class="group"><b>'+e(t.result.match.home+' – '+t.result.match.away)+'</b> '+e(t.phase)+' · PASS<br><small>'+e(t.code)+' · '+e(vn(t.at))+(db.settlements.some(s=>s.ticketId===t.id)?' · ĐÃ HẬU KIỂM':'')+'</small></div>').join('')||'Chưa có phiếu.';$('ticket').innerHTML='<option value="">Chọn phiếu</option>'+arr.map(t=>'<option value="'+e(t.id)+'">'+e(t.result.match.home+' – '+t.result.match.away+' · '+t.phase+' · '+t.id)+'</option>').join('');if(arr.some(t=>t.id===prev))$('ticket').value=prev;$('stats').textContent='Phiếu '+db.tickets.length+' · đã hậu kiểm '+db.settlements.length+' · Vốn cược thật ghi nhận: 0 · ROI thật: N/A.'}
function doSettle(){const t=db.tickets.find(z=>z.id===$('ticket').value);if(!t)return alert('Chọn phiếu.');if(db.settlements.some(s=>s.ticketId===t.id))return alert('Phiếu đã chấm, không ghi đè.');if(Date.now()<Date.parse(t.result.match.kickoffISO))return alert('Chỉ hậu kiểm sau giờ đá.');const a=['hh','ha','fh','fa'].map(v=>num($(v).value));if(a.some(v=>!Number.isInteger(v)||v<0)||a[0]>a[2]||a[1]>a[3])return alert('Nhập tỷ số HT và FT hợp lệ.');const c=t.candidate;let f=null,p=null;if(c){f=asian(c.kind,c.side,c.line,a[2],a[3]);p=gain(f,c.dec)}db.settlements.push({ticketId:t.id,ht:a.slice(0,2),ft:a.slice(2),result:f===null?'NO RESEARCH CODE':outcome(f),hypotheticalPerOne:p,stakeReal:0,pnlReal:0,lesson:$('lesson').value.trim(),at:new Date().toISOString()});save();$('settleresult').textContent='HT '+a[0]+'-'+a[1]+' | FT '+a[2]+'-'+a[3]+'\n'+(f===null?'NO CODE':outcome(f))+'\nLãi/lỗ giả định trên 1 đơn vị: '+(p??'N/A')+'\nVốn thực: 0 | ROI thật: N/A\nHọc quy trình, không outcome-fit.';renderHist()}
async function run(phase,auto=false){if(busy)return;let v;try{v=form()}catch(err){if(!auto)alert(err.message);return}v.phase=phase;const diff=Date.parse(v.kickoff)-Date.now();if(diff<=0){$('status').textContent='Đã qua giờ bóng lăn: không giả dữ liệu PRE/T-10 sau trận.';return}if(phase==='T-10'&&diff>12*60000){$('status').textContent='Chưa đến cửa sổ T-10 (12 phút trước kickoff).';return}
try{localStorage.setItem(KEY+'_input',JSON.stringify(v))}catch{}busy=true;$('preBtn').disabled=$('t10Btn').disabled=true;$('status').textContent='Đang tìm đúng fixture và lấy dữ liệu API-Football ...';$('suggestions').replaceChildren();const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),45000);
try{const res=await fetch('/api/research',{method:'POST',headers:header(),body:JSON.stringify(v),signal:ctrl.signal});const x=await res.json();if(!res.ok){showSuggestions(x.suggestions,phase);throw Error(x.error||'HTTP '+res.status)}render(x,phase);store(x,phase);$('status').textContent='API trả dữ liệu đúng trận. MASTER '+x.final+'. Quota theo nhà cung cấp: '+(x.quota?.remainingReported??'NO DATA')+'.';if(phase==='PRE')armT10(v)}catch(err){$('verdict').textContent='⚽ '+v.home+' – '+v.away+'\n'+phase+' / FT90\nMASTER: NO VERIFIED SCORE\nFINAL: PASS\nLÝ DO: '+err.message;$('status').textContent='PASS an toàn — '+err.message;tab('board')}finally{clearTimeout(timer);busy=false;$('preBtn').disabled=$('t10Btn').disabled=false}}
function armT10(v){if(autoTimer)clearInterval(autoTimer);autoTimer=setInterval(()=>{let x;try{x=form()}catch{clearInterval(autoTimer);return}if(x.home!==v.home||x.away!==v.away||x.kickoff!==v.kickoff){clearInterval(autoTimer);return}const diff=Date.parse(v.kickoff)-Date.now();if(diff<=0){clearInterval(autoTimer);return}if(diff<=600000&&!busy){clearInterval(autoTimer);run('T-10',true)}},15000)}
$('matchForm').onsubmit=ev=>{ev.preventDefault();run('PRE')};$('t10Btn').onclick=()=>run('T-10');$('settle').onclick=doSettle;
 const officialBtn=document.createElement('button');officialBtn.id='autoOfficial';officialBtn.textContent='TỰ LẤY HT/FT CHÍNH THỨC';
 $('settle').insertAdjacentElement('beforebegin',officialBtn);
 officialBtn.onclick=async()=>{
  const t=db.tickets.find(z=>z.id===$('ticket').value);if(!t)return alert('Chọn phiếu trong lịch sử trước.');
  officialBtn.disabled=true;$('settleresult').textContent='Đang kiểm tra kết quả chính thức...';
  try{const r=await fetch('/api/official-result?fixtureId='+encodeURIComponent(t.fixtureId),{headers:header()});
   const x=await r.json();if(!r.ok)throw Error(x.error||'HTTP '+r.status);
   if(!Array.isArray(x.ht)||!Array.isArray(x.ft)||[...x.ht,...x.ft].some(v=>!Number.isInteger(v)))
    throw Error('API chưa có đủ HT/FT xác minh');
   ['hh','ha','fh','fa'].forEach((id,i)=>{$(id).value=[...x.ht,...x.ft][i]});
   $('settleresult').textContent='Đã lấy HT/FT từ '+x.source+'. Bấm CHẤM HẬU KIỂM để lưu, không tính thành cược thật.';
  }catch(e){$('settleresult').textContent='Chưa tự lấy được: '+e.message+' — có thể nhập HT/FT đã xác minh thủ công.'}
  finally{officialBtn.disabled=false}
 };
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='SOI_FULL_AI_MASTER_V9_BACKUP.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)};
$('import').onclick=()=>$('file').click();$('file').onchange=async ev=>{try{const d=JSON.parse(await ev.target.files[0].text());if(d.schema!==9||!Array.isArray(d.tickets)||!Array.isArray(d.settlements))throw Error('Không phải bản sao lưu V9');if(!confirm('Thay toàn bộ lịch sử V9 đang có?'))return;db=d;save();renderHist()}catch(err){alert(err.message)}finally{ev.target.value=''}};
$('h2').onclick=()=>$('extrares').textContent='H2: NO SEPARATE ODDS / NO H2 MODEL → PASS; KHÔNG dùng λ FT.';$('live').onclick=()=>$('extrares').textContent='LIVE: NO PERIOD-SPECIFIC MARKET / GAME-STATE MODEL → PASS.';
$('health').onclick=async()=>{try{$('extrares').textContent=JSON.stringify(await(await fetch('/health')).json(),null,2)}catch(err){$('extrares').textContent=err.message}};
$('diag').onclick=async()=>{try{$('extrares').textContent=JSON.stringify(await(await fetch('/api/diagnostic-football',{headers:header()})).json(),null,2)}catch(err){$('extrares').textContent=err.message}};
$('tests').onclick=()=>{const list=[['U2.75 có 3 bàn',asian('TX','UNDER',2.75,2,1),-.5],['U2 có 2 bàn',asian('TX','UNDER',2,1,1),0],['O2.75 có 3 bàn',asian('TX','OVER',2.75,2,1),.5],['HDC +1 thua 1',asian('HDC','HOME',1,0,1),0],['HDC -1.25 thắng 1',asian('HDC','HOME',-1.25,2,1),-.5],['HDC -0.75 thắng 1',asian('HDC','HOME',-.75,2,1),.5],['HDC +.25 hòa',asian('HDC','AWAY',.25,1,1),.5],['HDC +1.75 thua 2',asian('HDC','HOME',1.75,0,2),-.5],['U2.25 có 2 bàn',asian('TX','UNDER',2.25,1,1),.5],['HDC 0 hòa',asian('HDC','HOME',0,0,0),0]];$('extrares').textContent=list.map(v=>(v[1]===v[2]?'✅':'❌')+' '+v[0]+' = '+v[1]).join('\n')+'\n'+list.filter(v=>v[1]===v[2]).length+'/10 passed'};
renderHist();
})();
</script></body></html>
`;
app.get('/app',(_,res)=>res.type('html').send(FRONTEND_V9));

app.listen(PORT,()=>console.log('SOI FULL AI V9.5 ready on port '+PORT));
