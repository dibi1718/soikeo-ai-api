// server.js - Soi Kèo AI Research API V4 Expert Auto Search
// Node.js 18+
// Cài: npm install express cors dotenv
// Chạy local: node server.js
// Endpoint: /api/research
//
// ENV cần có:
// TAVILY_API_KEY = key để tự tìm bài nhận định / siêu máy tính
// API_FOOTBALL_KEY = tùy chọn, lấy injuries/lineups từ API-Football

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;

function clean(s = "") {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function lower(s = "") {
  return clean(s).toLowerCase();
}

function clamp(x, a, b) {
  const n = Number(x);
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function containsAny(text, words) {
  const t = lower(text);
  return words.some(w => t.includes(lower(w)));
}

function uniqByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const u = clean(it.url || "");
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(it);
  }
  return out;
}

function normalizeTeamName(s = "") {
  return lower(s)
    .replace(/\bfc\b/g, "")
    .replace(/\bafc\b/g, "")
    .replace(/\bcf\b/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamTokens(name = "") {
  return normalizeTeamName(name).split(" ").filter(x => x.length >= 3);
}

function textHasTeam(text, team) {
  const t = lower(text);
  const full = normalizeTeamName(team);
  if (full && t.includes(full)) return true;
  const toks = teamTokens(team);
  return toks.some(tok => t.includes(tok));
}

function detectScore(text = "") {
  const t = clean(text);
  const patterns = [
    /(?:prediction|score|scoreline|tỷ số|ti so|dự đoán|du doan)[^\d]{0,30}(\d{1,2})\s*[-:]\s*(\d{1,2})/i,
    /(\d{1,2})\s*[-:]\s*(\d{1,2})/
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      const h = Number(m[1]);
      const a = Number(m[2]);
      if (Number.isFinite(h) && Number.isFinite(a) && h <= 9 && a <= 9) {
        return `${h}-${a}`;
      }
    }
  }
  return "";
}

function scoreToLean(score) {
  if (!score) return "neutral";
  const [h, a] = score.split("-").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return "neutral";
  if (h > a) return "home";
  if (a > h) return "away";
  return "draw";
}

function detectOU(text = "") {
  const t = lower(text);

  let over = 0;
  let under = 0;

  const overWords = [
    "over", "over 1.5", "over 2.5", "over 3.5",
    "tài", "tai", "nổ tài", "no tai", "nhiều bàn", "nhieu ban",
    "high scoring", "goals expected", "open game", "attacking game"
  ];

  const underWords = [
    "under", "under 1.5", "under 2.5", "under 3.5",
    "xỉu", "xiu", "ít bàn", "it ban",
    "low scoring", "tight game", "cautious", "defensive", "low block"
  ];

  for (const w of overWords) if (t.includes(lower(w))) over += 1;
  for (const w of underWords) if (t.includes(lower(w))) under += 1;

  if (over >= under + 1) return "over";
  if (under >= over + 1) return "under";
  return "neutral";
}

function detectWinner(text = "", home = "", away = "") {
  const t = lower(text);
  const homeNorm = normalizeTeamName(home);
  const awayNorm = normalizeTeamName(away);

  let hs = 0;
  let as = 0;
  let ds = 0;

  const score = detectScore(text);
  const scoreLean = scoreToLean(score);
  if (scoreLean === "home") hs += 2;
  if (scoreLean === "away") as += 2;
  if (scoreLean === "draw") ds += 2;

  const homeWinPhrases = [
    `${homeNorm} win`, `${homeNorm} to win`, `${homeNorm} victory`,
    `${homeNorm} thắng`, `${homeNorm} thang`,
    `win for ${homeNorm}`, `victory for ${homeNorm}`
  ];

  const awayWinPhrases = [
    `${awayNorm} win`, `${awayNorm} to win`, `${awayNorm} victory`,
    `${awayNorm} thắng`, `${awayNorm} thang`,
    `win for ${awayNorm}`, `victory for ${awayNorm}`
  ];

  for (const p of homeWinPhrases) if (p.trim() && t.includes(p)) hs += 3;
  for (const p of awayWinPhrases) if (p.trim() && t.includes(p)) as += 3;

  if (containsAny(t, ["draw", "hòa", "hoa", "stalemate"])) ds += 2;

  if (textHasTeam(t, home) && containsAny(t, ["favorite", "favourite", "được đánh giá cao", "duoc danh gia cao"])) hs += 1;
  if (textHasTeam(t, away) && containsAny(t, ["favorite", "favourite", "được đánh giá cao", "duoc danh gia cao"])) as += 1;

  if (hs > as && hs > ds) return "home";
  if (as > hs && as > ds) return "away";
  if (ds > hs && ds > as) return "draw";
  return "neutral";
}

function detectHdc(text = "", home = "", away = "") {
  const winner = detectWinner(text, home, away);
  const t = lower(text);

  let homeHdc = 0;
  let awayHdc = 0;

  if (winner === "home") homeHdc += 1.5;
  if (winner === "away") awayHdc += 1.5;
  if (winner === "draw") {
    homeHdc += 0.5;
    awayHdc += 0.5;
  }

  if (containsAny(t, ["handicap home", "home handicap", "chủ nhà", "chu nha", "cửa trên", "cua tren"])) homeHdc += 1;
  if (containsAny(t, ["handicap away", "away handicap", "đội khách", "doi khach", "cửa dưới", "cua duoi"])) awayHdc += 1;

  if (containsAny(t, ["cover the spread", "cover handicap"])) {
    if (textHasTeam(t, home)) homeHdc += 1;
    if (textHasTeam(t, away)) awayHdc += 1;
  }

  if (homeHdc >= awayHdc + 1) return "homeHdc";
  if (awayHdc >= homeHdc + 1) return "awayHdc";
  return "neutral";
}

function sourceConfidence(text = "", title = "") {
  let c = 0.45;
  const t = lower(`${title} ${text}`);

  if (containsAny(t, ["prediction", "preview", "nhận định", "nhan dinh", "soi kèo", "soi keo"])) c += 0.08;
  if (containsAny(t, ["supercomputer", "siêu máy tính", "sieu may tinh", "probability", "xác suất", "xac suat"])) c += 0.10;
  if (detectScore(t)) c += 0.06;
  if (detectOU(t) !== "neutral") c += 0.05;
  if (containsAny(t, ["injury", "lineup", "đội hình", "doi hinh", "chấn thương", "chan thuong"])) c += 0.04;

  return clamp(c, 0.35, 0.82);
}

function parseExpertSource({ title = "", url = "", text = "", type = "auto" }, home, away) {
  const blob = clean(`${title}. ${text}`);
  const winnerLean = detectWinner(blob, home, away);
  const hdcLean = detectHdc(blob, home, away);
  const ouLean = detectOU(blob);
  const score = detectScore(blob);
  const confidence = sourceConfidence(blob, title);

  let note = [];
  if (winnerLean !== "neutral") note.push(`Winner lean: ${winnerLean}`);
  if (hdcLean !== "neutral") note.push(`HDC lean: ${hdcLean}`);
  if (ouLean !== "neutral") note.push(`OU lean: ${ouLean}`);
  if (score) note.push(`Score: ${score}`);

  return {
    title: clean(title) || url,
    url,
    type,
    winnerLean,
    hdcLean,
    ouLean,
    score,
    confidence,
    note: note.join(" · ") || "Nguồn có liên quan nhưng không rút được hướng rõ.",
    snippet: blob.slice(0, 600)
  };
}

function majorityLean(items, field) {
  const score = {};
  for (const s of items) {
    const v = s[field] || "neutral";
    if (v === "neutral") continue;
    score[v] = (score[v] || 0) + clamp(s.confidence || 0.5, 0.1, 1);
  }

  const entries = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return { lean: "neutral", confidence: 0, score };

  const total = entries.reduce((a, b) => a + b[1], 0);
  const top = entries[0];

  return {
    lean: top[0],
    confidence: total > 0 ? clamp(top[1] / total, 0, 1) : 0,
    score
  };
}

function commonScores(items) {
  const map = {};
  for (const s of items) {
    if (!s.score) continue;
    map[s.score] = (map[s.score] || 0) + clamp(s.confidence || 0.5, 0.1, 1);
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(x => x[0]);
}

function buildConsensus(items, home, away) {
  const valid = (items || []).filter(x => x && x.url);
  const winner = majorityLean(valid, "winnerLean");
  const hdc = majorityLean(valid, "hdcLean");
  const ou = majorityLean(valid, "ouLean");
  const scores = commonScores(valid);

  const sourceCount = valid.length;
  const clearFields = [winner, hdc, ou].filter(x => x.lean !== "neutral" && x.confidence >= 0.52).length;
  const confidence = sourceCount
    ? clamp((winner.confidence + hdc.confidence + ou.confidence) / 3 + Math.min(sourceCount, 8) * 0.025 + clearFields * 0.04, 0, 0.88)
    : 0;

  const summaryParts = [];
  if (winner.lean !== "neutral") summaryParts.push(`đa số nguồn nghiêng ${winner.lean === "home" ? home : winner.lean === "away" ? away : "hòa"}`);
  if (hdc.lean !== "neutral") summaryParts.push(`HDC nghiêng ${hdc.lean === "homeHdc" ? home : away}`);
  if (ou.lean !== "neutral") summaryParts.push(`T/X nghiêng ${ou.lean === "over" ? "Tài" : "Xỉu"}`);
  if (scores.length) summaryParts.push(`tỷ số hay gặp: ${scores.join(", ")}`);

  return {
    status: sourceCount ? "ok" : "no_sources",
    sourceCount,
    winnerLean: winner.lean,
    hdcLean: hdc.lean,
    ouLean: ou.lean,
    confidence,
    commonScores: scores,
    summary: summaryParts.length
      ? `Expert consensus: ${summaryParts.join("; ")}.`
      : "Expert consensus chưa có hướng rõ.",
    votes: {
      winner: winner.score,
      hdc: hdc.score,
      ou: ou.score
    },
    sources: valid
  };
}

function scoreContextFromText(text) {
  let tempo = 0;
  let homeIssues = 0;
  let awayIssues = 0;

  if (containsAny(text, ["defensive", "low block", "cautious", "low scoring", "under", "tight game", "phòng ngự", "thận trọng", "ít bàn", "xỉu"])) tempo -= 1;
  if (containsAny(text, ["attacking", "open game", "high scoring", "over", "pressing", "tấn công", "cởi mở", "nhiều bàn", "tài"])) tempo += 1;

  if (containsAny(text, ["home injury", "home injuries", "home suspended"])) homeIssues += 0.5;
  if (containsAny(text, ["away injury", "away injuries", "away suspended"])) awayIssues += 0.5;

  if (containsAny(text, ["injury", "injured", "suspended", "doubtful", "chấn thương", "treo giò", "vắng mặt"])) {
    homeIssues += 0.25;
    awayIssues += 0.25;
  }

  return {
    tempo: clamp(tempo, -2, 2),
    homeIssues: clamp(homeIssues, 0, 2),
    awayIssues: clamp(awayIssues, 0, 2)
  };
}

async function tavilySearch(query, maxResults = 6) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { answer: "", results: [], error: "Thiếu TAVILY_API_KEY" };

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "advanced",
      include_answer: true,
      max_results: maxResults,
      topic: "general"
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily lỗi ${res.status}: ${text.slice(0, 180)}`);
  }

  const data = await res.json();
  return {
    answer: data.answer || "",
    results: (data.results || []).map(r => ({
      title: r.title || r.url,
      url: r.url,
      snippet: r.content || "",
      score: r.score || 0
    }))
  };
}

async function fetchPageText(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);

    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 SoiKeoAIResearchBot/1.0",
        "accept": "text/html,application/xhtml+xml,text/plain,*/*"
      },
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    return clean(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
    ).slice(0, 9000);
  } catch {
    return "";
  }
}

async function autoExpertSearch(home, away, league, date) {
  const queries = [
    `${home} vs ${away} ${league} ${date} prediction preview betting tips correct score over under handicap`,
    `${home} vs ${away} nhận định soi kèo dự đoán tỷ số tài xỉu handicap`,
    `${home} vs ${away} supercomputer prediction probability score`
  ];

  const packs = await Promise.allSettled(queries.map(q => tavilySearch(q, 6)));

  const results = [];
  let answers = [];

  for (const p of packs) {
    if (p.status !== "fulfilled") continue;
    if (p.value.answer) answers.push(p.value.answer);
    results.push(...(p.value.results || []));
  }

  const deduped = uniqByUrl(results)
    .filter(r => {
      const blob = `${r.title} ${r.snippet} ${r.url}`;
      return textHasTeam(blob, home) && textHasTeam(blob, away);
    })
    .slice(0, 8);

  const pageTexts = await Promise.all(deduped.slice(0, 6).map(r => fetchPageText(r.url)));

  const sources = deduped.map((r, i) => {
    const text = pageTexts[i] || r.snippet || "";
    const type = containsAny(`${r.title} ${r.url}`, ["supercomputer", "probability", "computer", "machine", "sieu", "siêu"])
      ? "supercomputer"
      : "expert";

    return parseExpertSource({
      title: r.title,
      url: r.url,
      text,
      type
    }, home, away);
  });

  const answerSource = answers.length
    ? parseExpertSource({
        title: "Tavily tổng hợp nhanh",
        url: "tavily://answer",
        text: answers.join(" "),
        type: "summary"
      }, home, away)
    : null;

  const allSources = answerSource ? [answerSource, ...sources] : sources;
  const consensus = buildConsensus(allSources, home, away);

  return {
    ...consensus,
    rawAnswer: answers.join(" ").slice(0, 1200)
  };
}

async function parseManualLinks(links, type, home, away) {
  const urls = (links || [])
    .map(clean)
    .filter(Boolean)
    .slice(0, 10);

  const texts = await Promise.all(urls.map(u => fetchPageText(u)));

  return urls.map((url, i) => parseExpertSource({
    title: url,
    url,
    text: texts[i] || "",
    type
  }, home, away));
}

async function apiFootball(path) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return null;

  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { "x-apisports-key": key }
  });

  if (!res.ok) return null;
  return res.json();
}

async function findTeamId(name) {
  const data = await apiFootball(`/teams?search=${encodeURIComponent(name)}`);
  const row = data?.response?.[0];
  return row?.team?.id || null;
}

async function findFixture(home, away) {
  const homeId = await findTeamId(home);
  if (!homeId) return null;

  const data = await apiFootball(`/fixtures?team=${homeId}&next=15`);
  const rows = data?.response || [];
  const awayLower = lower(away);

  return rows.find(f => {
    const h = lower(f?.teams?.home?.name);
    const a = lower(f?.teams?.away?.name);
    return h.includes(awayLower) || a.includes(awayLower) || awayLower.includes(h) || awayLower.includes(a);
  }) || rows[0] || null;
}

async function footballStructured(home, away) {
  if (!process.env.API_FOOTBALL_KEY) return null;

  try {
    const fixture = await findFixture(home, away);
    if (!fixture?.fixture?.id) return null;

    const fixtureId = fixture.fixture.id;
    const [injuries, lineups] = await Promise.all([
      apiFootball(`/injuries?fixture=${fixtureId}`),
      apiFootball(`/fixtures/lineups?fixture=${fixtureId}`)
    ]);

    const injRows = injuries?.response || [];
    const lineRows = lineups?.response || [];
    const homeName = fixture?.teams?.home?.name || home;
    const awayName = fixture?.teams?.away?.name || away;

    const homeInj = injRows
      .filter(x => lower(x?.team?.name).includes(lower(homeName)) || lower(homeName).includes(lower(x?.team?.name)))
      .map(x => `${x?.player?.name || "Cầu thủ"}: ${x?.player?.reason || "vắng/đau"}`)
      .slice(0, 6);

    const awayInj = injRows
      .filter(x => lower(x?.team?.name).includes(lower(awayName)) || lower(awayName).includes(lower(x?.team?.name)))
      .map(x => `${x?.player?.name || "Cầu thủ"}: ${x?.player?.reason || "vắng/đau"}`)
      .slice(0, 6);

    const homeLine = lineRows.find(x => lower(x?.team?.name).includes(lower(homeName)));
    const awayLine = lineRows.find(x => lower(x?.team?.name).includes(lower(awayName)));

    return {
      fixtureId,
      homeName,
      awayName,
      homeInjuries: homeInj,
      awayInjuries: awayInj,
      homeFormation: homeLine?.formation || "",
      awayFormation: awayLine?.formation || "",
      homeXI: (homeLine?.startXI || []).map(x => x?.player?.name).filter(Boolean).slice(0, 11),
      awayXI: (awayLine?.startXI || []).map(x => x?.player?.name).filter(Boolean).slice(0, 11)
    };
  } catch {
    return null;
  }
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Soi Kèo AI Research API V4 Expert Auto Search",
    endpoint: "/api/research",
    tavily: Boolean(process.env.TAVILY_API_KEY),
    apiFootball: Boolean(process.env.API_FOOTBALL_KEY)
  });
});

app.post("/api/research", async (req, res) => {
  try {
    const home = clean(req.body.home || "");
    const away = clean(req.body.away || "");
    const league = clean(req.body.league || "");
    const date = clean(req.body.date || "");

    if (!home || !away) {
      return res.status(400).json({ error: "Thiếu home/away" });
    }

    const expertLinks = Array.isArray(req.body.expertLinks) ? req.body.expertLinks : [];
    const superComputerLinks = Array.isArray(req.body.superComputerLinks) ? req.body.superComputerLinks : [];
    const autoExpertEnabled = req.body.autoExpertSearch !== false;

    const teamNewsQuery = `${home} vs ${away} ${league} ${date} predicted lineups injuries suspensions team news preview tactical style`;

    const jobs = [
      tavilySearch(teamNewsQuery, 6),
      footballStructured(home, away)
    ];

    if (autoExpertEnabled) {
      jobs.push(autoExpertSearch(home, away, league, date));
    } else {
      jobs.push(Promise.resolve({
        status: "off",
        sourceCount: 0,
        winnerLean: "neutral",
        hdcLean: "neutral",
        ouLean: "neutral",
        confidence: 0,
        commonScores: [],
        summary: "Tự tìm chuyên gia đang tắt.",
        sources: []
      }));
    }

    jobs.push(parseManualLinks(expertLinks, "expert_manual", home, away));
    jobs.push(parseManualLinks(superComputerLinks, "supercomputer_manual", home, away));

    const [webInfo, structured, autoConsensus, manualExpertSources, manualSuperSources] = await Promise.all(jobs);

    const manualSources = [...manualExpertSources, ...manualSuperSources];
    const combinedConsensus = manualSources.length
      ? buildConsensus([...(autoConsensus.sources || []), ...manualSources], home, away)
      : autoConsensus;

    const sourceText = [
      webInfo.answer,
      ...(webInfo.results || []).map(r => `${r.title}. ${r.snippet}`),
      combinedConsensus.summary,
      ...(combinedConsensus.sources || []).map(s => `${s.title}. ${s.snippet}`)
    ].join(" ");
    const webFallback = webLineupFallback(home, away, sourceText, combinedConsensus);

    const auto = scoreContextFromText(sourceText);

    function webLineupFallback(home, away, sourceText, consensus) {
  const blob = clean([
    sourceText || "",
    consensus?.rawAnswer || "",
    consensus?.summary || "",
    ...(consensus?.sources || []).map(s => `${s.title || ""}. ${s.snippet || ""}`)
  ].join(" "));

  const text = blob.slice(0, 16000);

  function findForTeam(team) {
    const teamNorm = normalizeTeamName(team);
    const teamRaw = clean(team);

    const patterns = [
      new RegExp(`${teamRaw}[^.]{0,120}(predicted lineup|expected lineup|starting xi|probable lineup|lineup|đội hình dự kiến|doi hinh du kien|đội hình ra sân|doi hinh ra san)[^.]{0,900}`, "i"),
      new RegExp(`(predicted lineup|expected lineup|starting xi|probable lineup|lineup|đội hình dự kiến|doi hinh du kien|đội hình ra sân|doi hinh ra san)[^.]{0,180}${teamRaw}[^.]{0,900}`, "i"),
      new RegExp(`${teamNorm}[^.]{0,120}(predicted lineup|expected lineup|starting xi|probable lineup|lineup)[^.]{0,900}`, "i")
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[0]) {
        return clean(m[0]).slice(0, 800);
      }
    }

    const teamIdx = lower(text).indexOf(lower(teamRaw));
    if (teamIdx >= 0) {
      const chunk = text.slice(Math.max(0, teamIdx - 300), teamIdx + 1000);
      if (containsAny(chunk, [
        "predicted lineup", "expected lineup", "starting xi", "probable lineup",
        "đội hình", "doi hinh", "lineup", "xi"
      ])) {
        return clean(chunk).slice(0, 800);
      }
    }

    return "";
  }

  function findInjury(team) {
    const teamRaw = clean(team);

    const patterns = [
      new RegExp(`${teamRaw}[^.]{0,160}(injury|injuries|suspended|suspension|doubtful|chấn thương|chan thuong|treo giò|treo gio|vắng mặt|vang mat)[^.]{0,900}`, "i"),
      new RegExp(`(injury|injuries|suspended|suspension|doubtful|chấn thương|chan thuong|treo giò|treo gio|vắng mặt|vang mat)[^.]{0,180}${teamRaw}[^.]{0,900}`, "i")
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[0]) {
        return clean(m[0]).slice(0, 800);
      }
    }

    return "";
  }

  return {
    lineupHomeWeb: findForTeam(home),
    lineupAwayWeb: findForTeam(away),
    injuriesHomeWeb: findInjury(home),
    injuriesAwayWeb: findInjury(away)
  };
}
    let injuriesHome = webFallback.injuriesHomeWeb
  ? `Dự kiến từ web: ${webFallback.injuriesHomeWeb}`
  : "Chưa có dữ liệu chấn thương rõ ràng từ API/web.";

let injuriesAway = webFallback.injuriesAwayWeb
  ? `Dự kiến từ web: ${webFallback.injuriesAwayWeb}`
  : "Chưa có dữ liệu chấn thương rõ ràng từ API/web.";

let lineupHome = webFallback.lineupHomeWeb
  ? `Dự kiến từ web: ${webFallback.lineupHomeWeb}`
  : "Chưa có đội hình chính thức/dự kiến rõ ràng từ API/web.";

let lineupAway = webFallback.lineupAwayWeb
  ? `Dự kiến từ web: ${webFallback.lineupAwayWeb}`
  : "Chưa có đội hình chính thức/dự kiến rõ ràng từ API/web.";

    if (structured) {
      if (structured.homeInjuries?.length) injuriesHome = structured.homeInjuries.join("; ");
      if (structured.awayInjuries?.length) injuriesAway = structured.awayInjuries.join("; ");
      if (structured.homeXI?.length) lineupHome = `${structured.homeFormation || "Sơ đồ chưa rõ"}: ${structured.homeXI.join(", ")}`;
      else if (structured.homeFormation) lineupHome = `Sơ đồ: ${structured.homeFormation}`;
      if (structured.awayXI?.length) lineupAway = `${structured.awayFormation || "Sơ đồ chưa rõ"}: ${structured.awayXI.join(", ")}`;
      else if (structured.awayFormation) lineupAway = `Sơ đồ: ${structured.awayFormation}`;
    }

    const summary = [
      webInfo.answer || `Đã tìm nhanh team news cho ${home} vs ${away}.`,
      combinedConsensus.summary || ""
    ].filter(Boolean).join(" ");

    const flags = {
      lowBlock: combinedConsensus.ouLean === "under" || containsAny(sourceText, ["low block", "defensive", "tight game", "xỉu", "ít bàn"]),
      earlyGoalRisk: combinedConsensus.ouLean === "over" || containsAny(sourceText, ["open game", "attacking", "high scoring", "tài", "nhiều bàn"]),
      rotation: containsAny(sourceText, ["rotation", "rotate", "xoay tua", "rest players", "giữ chân"]),
      homeMotivation: containsAny(sourceText, [`${home} need win`, `${home} must win`, "home motivation", "đội nhà cần thắng"]),
      awayMotivation: containsAny(sourceText, [`${away} need win`, `${away} must win`, "away motivation", "đội khách cần thắng"])
    };

    res.json({
      summary,
      homeAdvantage: 1,
      tempo: auto.tempo,
      homeIssues: auto.homeIssues,
      awayIssues: auto.awayIssues,
      injuriesHome,
      injuriesAway,
      lineupHome,
      lineupAway,
      styleHome: "Tổng hợp từ team news + odds/line trong app.",
      styleAway: "Tổng hợp từ team news + odds/line trong app.",
      flags,
      expertConsensus: {
        ...combinedConsensus,
        manualSourceCount: manualSources.length,
        autoExpertEnabled
      },
      sources: [
        ...(webInfo.results || []),
        ...((combinedConsensus.sources || []).filter(s => s.url && !String(s.url).startsWith("tavily://")))
      ].slice(0, 12)
    });
  } catch (err) {
    res.status(500).json({ error: "Research API failed", message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Soi Kèo AI Research API V4 chạy tại http://localhost:${PORT}`);
});
