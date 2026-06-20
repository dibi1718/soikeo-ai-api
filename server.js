// server.js - Soi Kèo AI Research API V4.2 Safe Expert Consensus
// Node.js 18+
// package.json cần có: express, cors, dotenv và "type": "module"

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "3mb" }));

const PORT = process.env.PORT || 3000;

/* =======================
   BASIC HELPERS
======================= */

function clean(s = "") {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function fold(s = "") {
  return clean(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function lower(s = "") {
  return clean(s).toLowerCase();
}

function clamp(x, a, b) {
  const n = Number(x);
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function containsAny(text = "", words = []) {
  const t = fold(text);
  return words.some(w => t.includes(fold(w)));
}

function escapeRegExp(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqByUrl(items = []) {
  const seen = new Set();
  const out = [];

  for (const it of items) {
    const u = clean(it.url || "");
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(it);
  }

  return out;
}

function domainOf(url = "") {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    if (String(url).startsWith("tavily://")) return "tavily";
    return "unknown";
  }
}

function pathOf(url = "") {
  try {
    return new URL(url).pathname || "";
  } catch {
    return "";
  }
}

function normalizeTeamName(s = "") {
  return fold(s)
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

function textHasTeam(text = "", team = "") {
  const t = normalizeTeamName(text);
  const full = normalizeTeamName(team);

  if (full && t.includes(full)) return true;

  const toks = teamTokens(team);
  return toks.some(tok => t.includes(tok));
}

function textHasBothTeams(text = "", home = "", away = "") {
  return textHasTeam(text, home) && textHasTeam(text, away);
}

/* =======================
   TRUSTED DOMAINS
======================= */

const DOMAIN_PROFILE = {
  "bongdaplus.vn": {
    type: "expert_main",
    priority: 1.22,
    label: "Bongdaplus"
  },
  "bongda24h.vn": {
    type: "expert_main",
    priority: 1.22,
    label: "Bongda24h"
  },
  "thethao247.vn": {
    type: "expert_main",
    priority: 1.18,
    label: "Thể Thao 247"
  },
  "kqbd.mobi": {
    type: "expert_secondary",
    priority: 1.0,
    label: "KQBD.mobi"
  },
  "bongdanet.online": {
    type: "expert_secondary",
    priority: 0.95,
    label: "Bongdanet"
  },
  "adidas-fifa.com": {
    type: "method_secondary",
    priority: 0.72,
    label: "Adidas-Fifa"
  }
};

function domainPriority(url = "") {
  const d = domainOf(url);
  return DOMAIN_PROFILE[d]?.priority || 0.65;
}

function isTrustedDomain(url = "") {
  return Boolean(DOMAIN_PROFILE[domainOf(url)]);
}

function isKnownCategoryUrl(url = "") {
  const p = fold(pathOf(url));
  const u = fold(url);

  return (
    u.includes("nhan-dinh-bong-da-tags") ||
    u.includes("nhan-dinh-bong-da-c344") ||
    u.includes("nhan-dinh-bong-da-c288") ||
    u.includes("/nhan-dinh-bong-da") && !/\d{4}|vs|\.html/.test(u) ||
    u.includes("/soi-keo-bong-da/") && !/\d{4}|vs|\.html/.test(u)
  );
}

function isSuperComputerUrl(url = "") {
  const u = fold(url);
  return (
    u.includes("du-doan-bong-da") ||
    u.includes("sieu-may-tinh") ||
    u.includes("supercomputer") ||
    u.includes("probability")
  );
}

/* =======================
   TEXT DETECTION
======================= */

function detectScore(text = "") {
  const t = clean(text);

  const patterns = [
    /(?:prediction|score|scoreline|correct score|tỷ số|ti so|dự đoán|du doan)[^\d]{0,45}(\d{1,2})\s*[-:]\s*(\d{1,2})/i,
    /(\d{1,2})\s*[-:]\s*(\d{1,2})/
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (!m) continue;

    const h = Number(m[1]);
    const a = Number(m[2]);

    if (Number.isFinite(h) && Number.isFinite(a) && h <= 9 && a <= 9) {
      return `${h}-${a}`;
    }
  }

  return "";
}

function scoreToLean(score = "") {
  if (!score) return "neutral";

  const [h, a] = score.split("-").map(Number);

  if (!Number.isFinite(h) || !Number.isFinite(a)) return "neutral";
  if (h > a) return "home";
  if (a > h) return "away";
  return "draw";
}

function hasProbabilityText(text = "") {
  const t = fold(text);
  return (
    /\b\d{1,3}\s*%/.test(t) &&
    containsAny(t, ["xác suất", "xac suat", "probability", "chance", "win probability", "tỷ lệ thắng", "ti le thang"])
  );
}

function detectOU(text = "") {
  const t = fold(text);

  let over = 0;
  let under = 0;

  const overWords = [
    "over", "over 1.5", "over 2.5", "over 3.5",
    "tai", "no tai", "nhieu ban",
    "high scoring", "goals expected", "open game", "attacking game",
    "both teams to score", "btts"
  ];

  const underWords = [
    "under", "under 1.5", "under 2.5", "under 3.5",
    "xiu", "it ban",
    "low scoring", "tight game", "cautious", "defensive", "low block"
  ];

  for (const w of overWords) if (t.includes(fold(w))) over += 1;
  for (const w of underWords) if (t.includes(fold(w))) under += 1;

  if (over >= under + 1) return "over";
  if (under >= over + 1) return "under";
  return "neutral";
}

function detectWinner(text = "", home = "", away = "") {
  const t = fold(text);
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
    `${homeNorm} win`,
    `${homeNorm} to win`,
    `${homeNorm} victory`,
    `${homeNorm} thang`,
    `win for ${homeNorm}`,
    `victory for ${homeNorm}`
  ];

  const awayWinPhrases = [
    `${awayNorm} win`,
    `${awayNorm} to win`,
    `${awayNorm} victory`,
    `${awayNorm} thang`,
    `win for ${awayNorm}`,
    `victory for ${awayNorm}`
  ];

  for (const p of homeWinPhrases) if (p.trim() && t.includes(p)) hs += 3;
  for (const p of awayWinPhrases) if (p.trim() && t.includes(p)) as += 3;

  if (containsAny(t, ["draw", "hoa", "stalemate"])) ds += 2;

  if (textHasTeam(t, home) && containsAny(t, ["favorite", "favourite", "duoc danh gia cao"])) hs += 1;
  if (textHasTeam(t, away) && containsAny(t, ["favorite", "favourite", "duoc danh gia cao"])) as += 1;

  if (hs > as && hs > ds) return "home";
  if (as > hs && as > ds) return "away";
  if (ds > hs && ds > as) return "draw";
  return "neutral";
}

function detectHdc(text = "", home = "", away = "") {
  const winner = detectWinner(text, home, away);
  const t = fold(text);

  let homeHdc = 0;
  let awayHdc = 0;

  if (winner === "home") homeHdc += 1.2;
  if (winner === "away") awayHdc += 1.2;

  if (winner === "draw") {
    homeHdc += 0.35;
    awayHdc += 0.35;
  }

  if (containsAny(t, ["handicap home", "home handicap", "chu nha", "cua tren"])) {
    homeHdc += 1;
  }

  if (containsAny(t, ["handicap away", "away handicap", "doi khach", "cua duoi"])) {
    awayHdc += 1;
  }

  if (containsAny(t, ["cover the spread", "cover handicap", "thang keo", "an keo"])) {
    if (textHasTeam(t, home)) homeHdc += 1;
    if (textHasTeam(t, away)) awayHdc += 1;
  }

  if (homeHdc >= awayHdc + 1) return "homeHdc";
  if (awayHdc >= homeHdc + 1) return "awayHdc";
  return "neutral";
}

function detectSourceType(url = "", text = "") {
  const blob = `${url} ${text}`;

  if (
    isSuperComputerUrl(url) ||
    containsAny(blob, [
      "supercomputer",
      "sieu may tinh",
      "probability",
      "xac suat",
      "machine learning",
      "monte carlo"
    ])
  ) {
    return "supercomputer";
  }

  return "expert";
}

/* =======================
   SOURCE QUALITY
======================= */

function qualitySource({ title = "", url = "", text = "", baseType = "auto" }, home = "", away = "") {
  const domain = domainOf(url);
  const path = pathOf(url);
  const titleBlob = `${title} ${url}`;
  const all = `${title}. ${url}. ${text}`;

  const titleBoth = textHasBothTeams(title, home, away);
  const urlBoth = textHasBothTeams(url, home, away);
  const textBoth = textHasBothTeams(all, home, away);
  const matchOk = textBoth;

  const isCategory = isKnownCategoryUrl(url) && !titleBoth && !urlBoth;
  const trusted = isTrustedDomain(url);
  const type = detectSourceType(url, all);

  const score = detectScore(all);
  const ou = detectOU(all);
  const hdc = detectHdc(all, home, away);
  const winner = detectWinner(all, home, away);
  const hasProb = hasProbabilityText(all);

  const hasHdcText = hdc !== "neutral";
  const hasOuText = ou !== "neutral";
  const hasWinnerText = winner !== "neutral";
  const hasScoreText = Boolean(score);

  let q = 0;
  const flags = [];

  if (matchOk) {
    q += 22;
    flags.push("đúng 2 đội");
  } else {
    flags.push("không xác minh đủ 2 đội");
  }

  if (titleBoth) {
    q += 25;
    flags.push("title đúng trận");
  }

  if (urlBoth) {
    q += 15;
    flags.push("url đúng trận");
  }

  if (trusted) {
    q += 10;
    flags.push(`domain ưu tiên: ${DOMAIN_PROFILE[domain]?.label || domain}`);
  }

  if (hasScoreText) {
    q += 12;
    flags.push("có tỷ số");
  }

  if (hasProb) {
    q += 14;
    flags.push("có xác suất");
  }

  if (hasOuText) {
    q += 10;
    flags.push("có T/X");
  }

  if (hasHdcText) {
    q += 10;
    flags.push("có HDC");
  }

  if (hasWinnerText) {
    q += 6;
    flags.push("có winner");
  }

  if (type === "supercomputer") {
    q += 6;
    flags.push("nguồn siêu máy tính");
  }

  if (isCategory) {
    q -= 28;
    flags.push("trang chuyên mục, giảm mạnh");
  }

  if (domain === "tavily") {
    q -= 20;
    flags.push("tóm tắt Tavily, không phải bài gốc");
  }

  if (!matchOk) q = Math.min(q, 20);

  const contentSignals = [hasScoreText, hasProb, hasOuText, hasHdcText, hasWinnerText].filter(Boolean).length;

  if (contentSignals === 0) {
    q = Math.min(q, 35);
    flags.push("không có tín hiệu kèo rõ");
  }

  q = clamp(q, 0, 100);

  let qualityLabel = "rejected";
  if (q >= 72) qualityLabel = "strong";
  else if (q >= 55) qualityLabel = "medium";
  else if (q >= 40) qualityLabel = "weak";

  const voteAllowed = matchOk && q >= 50 && !isCategory;

  const priority = domainPriority(url);
  const confidence = clamp(0.25 + q / 145, 0.25, 0.82);
  const voteWeight = voteAllowed ? confidence * (q / 100) * priority : 0;

  return {
    domain,
    path,
    trusted,
    type,
    matchOk,
    titleBoth,
    urlBoth,
    isCategory,
    quality: q,
    qualityLabel,
    voteAllowed,
    voteWeight,
    flags,
    score,
    hasProb,
    hasOuText,
    hasHdcText,
    hasWinnerText,
    contentSignals
  };
}

/* =======================
   PARSE EXPERT SOURCES
======================= */

function parseExpertSource({ title = "", url = "", text = "", type = "auto" }, home, away) {
  const blob = clean(`${title}. ${text}`);
  const q = qualitySource({ title, url, text: blob, baseType: type }, home, away);

  const winnerLean = detectWinner(blob, home, away);
  const hdcLean = q.voteAllowed ? detectHdc(blob, home, away) : "neutral";
  const ouLean = q.voteAllowed ? detectOU(blob) : "neutral";
  const score = q.voteAllowed ? detectScore(blob) : "";

  const note = [];
  if (winnerLean !== "neutral") note.push(`Winner lean: ${winnerLean}`);
  if (hdcLean !== "neutral") note.push(`HDC lean: ${hdcLean}`);
  if (ouLean !== "neutral") note.push(`OU lean: ${ouLean}`);
  if (score) note.push(`Score: ${score}`);

  return {
    title: clean(title) || url,
    url,
    domain: q.domain,
    type: q.type || type,
    quality: q.quality,
    qualityLabel: q.qualityLabel,
    voteAllowed: q.voteAllowed,
    voteWeight: q.voteWeight,
    qualityFlags: q.flags,
    matchOk: q.matchOk,
    isCategory: q.isCategory,
    winnerLean: q.voteAllowed ? winnerLean : "neutral",
    hdcLean,
    ouLean,
    score,
    hasProbability: q.hasProb,
    confidence: q.confidence,
    note: note.join(" · ") || "Nguồn có liên quan nhưng chưa đủ chuẩn để vote mạnh.",
    snippet: blob.slice(0, 800)
  };
}

function bestPerDomain(sources = []) {
  const map = new Map();

  for (const s of sources) {
    if (!s || !s.url) continue;

    const key = s.domain || domainOf(s.url);

    const old = map.get(key);

    const oldPower = old ? (old.voteWeight || 0) + (old.quality || 0) / 200 : -1;
    const newPower = (s.voteWeight || 0) + (s.quality || 0) / 200;

    if (!old || newPower > oldPower) {
      map.set(key, s);
    }
  }

  return [...map.values()];
}

function weightedLean(items = [], field = "") {
  const score = {};

  for (const s of items) {
    const v = s[field] || "neutral";
    if (v === "neutral") continue;

    const w = clamp(s.voteWeight || 0, 0, 2);
    if (w <= 0) continue;

    score[v] = (score[v] || 0) + w;
  }

  const entries = Object.entries(score).sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    return { lean: "neutral", agreement: 0, score };
  }

  const total = entries.reduce((a, b) => a + b[1], 0);
  const top = entries[0];

  return {
    lean: top[0],
    agreement: total > 0 ? clamp(top[1] / total, 0, 1) : 0,
    score
  };
}

function commonScores(items = []) {
  const map = {};

  for (const s of items) {
    if (!s.score) continue;
    const w = clamp(s.voteWeight || 0, 0.1, 2);
    map[s.score] = (map[s.score] || 0) + w;
  }

  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(x => x[0]);
}

function buildConsensus(items = [], home = "", away = "") {
  const all = items.filter(x => x && x.url);
  const domainBest = bestPerDomain(all);
  const voting = domainBest.filter(s => s.voteAllowed && s.voteWeight > 0);

  const winner = weightedLean(voting, "winnerLean");
  const hdc = weightedLean(voting, "hdcLean");
  const ou = weightedLean(voting, "ouLean");
  const scores = commonScores(voting);

  const strongCount = voting.filter(s => s.quality >= 72).length;
  const mediumCount = voting.filter(s => s.quality >= 55).length;
  const superCount = voting.filter(s => s.type === "supercomputer").length;

  const avgQuality = voting.length
    ? voting.reduce((a, b) => a + (b.quality || 0), 0) / voting.length
    : 0;

  const agreements = [winner, hdc, ou]
    .filter(x => x.lean !== "neutral")
    .map(x => x.agreement);

  const avgAgreement = agreements.length
    ? agreements.reduce((a, b) => a + b, 0) / agreements.length
    : 0;

  const hasRealKèo = voting.some(s => s.hdcLean !== "neutral" || s.ouLean !== "neutral");
  const hasScoreOrProb = voting.some(s => s.score || s.hasProbability);

  /*
    Đây là điểm quan trọng:
    App cũ dùng expertConsensus.confidence để cộng điểm.
    Bản V4.2 cố ý khóa confidence thấp hơn để không còn +14 bừa.
  */
  let appConfidence = 0;

  if (voting.length >= 5 && strongCount >= 3 && avgAgreement >= 0.70 && hasRealKèo) {
    appConfidence = 0.62;
  } else if (voting.length >= 3 && mediumCount >= 3 && avgAgreement >= 0.62 && hasRealKèo) {
    appConfidence = 0.48;
  } else if (voting.length >= 2 && avgAgreement >= 0.58) {
    appConfidence = 0.34;
  } else if (voting.length >= 1) {
    appConfidence = 0.22;
  }

  if (!hasRealKèo) appConfidence = Math.min(appConfidence, 0.28);
  if (!hasScoreOrProb && superCount > 0) appConfidence = Math.min(appConfidence, 0.42);
  if (avgQuality < 55) appConfidence = Math.min(appConfidence, 0.26);

  appConfidence = clamp(appConfidence, 0, 0.66);

  const summaryParts = [];

  if (voting.length) {
    summaryParts.push(`${voting.length} nguồn đủ chuẩn`);
  } else {
    summaryParts.push("chưa có nguồn đủ chuẩn");
  }

  if (winner.lean !== "neutral") {
    summaryParts.push(`winner nghiêng ${winner.lean === "home" ? home : winner.lean === "away" ? away : "hòa"}`);
  }

  if (hdc.lean !== "neutral") {
    summaryParts.push(`HDC nghiêng ${hdc.lean === "homeHdc" ? home : away}`);
  }

  if (ou.lean !== "neutral") {
    summaryParts.push(`T/X nghiêng ${ou.lean === "over" ? "Tài" : "Xỉu"}`);
  }

  if (scores.length) {
    summaryParts.push(`tỷ số hay gặp: ${scores.join(", ")}`);
  }

  const weakIgnored = all.filter(s => !s.voteAllowed).length;

  return {
    status: voting.length ? "ok" : "weak_or_no_sources",
    safeMode: true,
    sourceCount: voting.length,
    readSourceCount: all.length,
    weakIgnored,
    winnerLean: winner.lean,
    hdcLean: hdc.lean,
    ouLean: ou.lean,
    confidence: appConfidence,
    rawAgreement: avgAgreement,
    avgQuality,
    strongCount,
    mediumCount,
    superComputerSourceCount: superCount,
    commonScores: scores,
    summary: `Safe Expert Consensus: ${summaryParts.join("; ")}. ${weakIgnored ? `Đã bỏ qua ${weakIgnored} nguồn yếu/trang chuyên mục.` : ""}`.trim(),
    votes: {
      winner: winner.score,
      hdc: hdc.score,
      ou: ou.score
    },
    sources: all,
    votingSources: voting
  };
}

/* =======================
   TAVILY SEARCH
======================= */

async function tavilySearch(query, maxResults = 6) {
  const key = process.env.TAVILY_API_KEY;

  if (!key) {
    return { answer: "", results: [], error: "Thiếu TAVILY_API_KEY" };
  }

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
        .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#8211;/g, "-")
        .replace(/&#8217;/g, "'")
    ).slice(0, 14000);
  } catch {
    return "";
  }
}

/* =======================
   AUTO EXPERT SEARCH
======================= */

async function autoExpertSearch(home, away, league, date) {
  const expertSites = [
    "bongdaplus.vn",
    "bongda24h.vn",
    "thethao247.vn",
    "kqbd.mobi",
    "bongdanet.online",
    "adidas-fifa.com"
  ];

  const queries = [
    ...expertSites.map(site => `site:${site} ${home} ${away} nhận định soi kèo dự đoán tỷ số tài xỉu handicap`),
    `site:kqbd.mobi/du-doan-bong-da ${home} ${away} dự đoán bóng đá xác suất tỷ số`,
    `site:bongdanet.online/sieu-may-tinh-du-doan-bong-da ${home} ${away} siêu máy tính dự đoán bóng đá`,
    `${home} vs ${away} ${league} ${date} prediction preview betting tips correct score over under handicap`,
    `${home} vs ${away} nhận định soi kèo dự đoán tỷ số tài xỉu handicap`,
    `${home} vs ${away} supercomputer prediction probability score`
  ];

  const packs = await Promise.allSettled(
    queries.map(q => tavilySearch(q, 5))
  );

  const results = [];
  const answers = [];

  for (const p of packs) {
    if (p.status !== "fulfilled") continue;

    if (p.value.answer) answers.push(p.value.answer);
    results.push(...(p.value.results || []));
  }

  const deduped = uniqByUrl(results)
    .map(r => {
      const u = fold(r.url || "");
      const blob = `${r.title} ${r.snippet} ${r.url}`;
      let boost = 0;

      if (isTrustedDomain(r.url)) boost += 1.2;
      if (textHasBothTeams(blob, home, away)) boost += 1.5;
      if (isSuperComputerUrl(r.url)) boost += 0.7;
      if (containsAny(blob, ["soi kèo", "soi keo", "nhận định", "nhan dinh", "prediction", "preview"])) boost += 0.6;
      if (isKnownCategoryUrl(r.url)) boost -= 0.8;

      return { ...r, localBoost: boost, foldedUrl: u };
    })
    .sort((a, b) => (clamp(b.localBoost, -5, 99) + clamp(b.score, 0, 99)) - (clamp(a.localBoost, -5, 99) + clamp(a.score, 0, 99)))
    .slice(0, 14);

  const pageTexts = await Promise.all(
    deduped.slice(0, 10).map(r => fetchPageText(r.url))
  );

  const sources = deduped.map((r, i) => {
    const text = pageTexts[i] || r.snippet || "";

    return parseExpertSource({
      title: r.title,
      url: r.url,
      text,
      type: "auto"
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
    whitelist: expertSites,
    methodologySource: "Safe Expert Consensus V4.2",
    rawAnswer: answers.join(" ").slice(0, 1500)
  };
}

async function parseManualLinks(links = [], type, home, away) {
  const urls = links
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

/* =======================
   LINEUP WEB FALLBACK
======================= */

function looksLikeRealLineup(chunk = "") {
  const text = clean(chunk);

  if (!text || text.length < 80) return false;

  const lowerText = fold(text);

  const onlyHeading =
    text.length < 180 &&
    containsAny(lowerText, [
      "predicted lineup and team news",
      "lineups & injury news",
      "starting xis",
      "lineups widget",
      "team news"
    ]) &&
    !text.includes(",") &&
    !text.includes(";");

  if (onlyHeading) return false;

  const commaCount = (text.match(/,/g) || []).length;
  const semicolonCount = (text.match(/;/g) || []).length;

  const hasFormation = /\b[3-5]-[2-5]-[1-4]\b/.test(text);

  const hasPositionWords = containsAny(lowerText, [
    "gk", "goalkeeper", "defenders", "midfielders", "forwards",
    "df:", "mf:", "fw:",
    "thu mon", "hau ve", "tien ve", "tien dao"
  ]);

  const nameMatches = text.match(/\b[A-ZÀ-Ỵ][a-zà-ỹ'’-]{2,}\s+[A-ZÀ-Ỵ][a-zà-ỹ'’-]{2,}\b/g) || [];
  const nameCount = new Set(nameMatches).size;

  if (commaCount >= 5 && nameCount >= 4) return true;
  if (semicolonCount >= 4 && nameCount >= 4) return true;
  if (hasFormation && nameCount >= 5) return true;
  if (hasPositionWords && nameCount >= 5) return true;

  return false;
}

function cleanLineupChunk(chunk = "") {
  let text = clean(chunk);

  text = text
    .replace(/Predicted Lineups\s*&\s*Starting XIs/gi, "")
    .replace(/Lineups\s*&\s*Injury News/gi, "")
    .replace(/RotoWire Soccer Lineups Widget/gi, "")
    .replace(/###/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.slice(0, 900);
}

function webLineupFallback(home, away, sourceText, consensus) {
  const blob = clean([
    sourceText || "",
    consensus?.rawAnswer || "",
    consensus?.summary || "",
    ...(consensus?.sources || []).map(s => `${s.title || ""}. ${s.snippet || ""}`)
  ].join(" "));

  const text = blob.slice(0, 24000);

  function findLineupForTeam(team) {
    const teamRaw = clean(team);
    const teamEsc = escapeRegExp(teamRaw);

    const lineupWords = [
      "predicted lineup",
      "expected lineup",
      "starting xi",
      "starting xis",
      "probable lineup",
      "lineup",
      "đội hình dự kiến",
      "doi hinh du kien",
      "đội hình ra sân",
      "doi hinh ra san"
    ];

    const patterns = [
      new RegExp(`${teamEsc}[^.]{0,180}(${lineupWords.join("|")})[^.]{0,1400}`, "i"),
      new RegExp(`(${lineupWords.join("|")})[^.]{0,220}${teamEsc}[^.]{0,1400}`, "i"),
      new RegExp(`${teamEsc}[^\\n]{0,1600}`, "i")
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (!m || !m[0]) continue;

      const chunk = cleanLineupChunk(m[0]);

      if (looksLikeRealLineup(chunk)) {
        return chunk;
      }
    }

    const idx = fold(text).indexOf(fold(teamRaw));

    if (idx >= 0) {
      const chunk = cleanLineupChunk(text.slice(Math.max(0, idx - 400), idx + 1800));

      if (
        containsAny(chunk, [
          "predicted lineup",
          "expected lineup",
          "starting xi",
          "probable lineup",
          "đội hình",
          "doi hinh",
          "lineup",
          "gk",
          "df",
          "mf",
          "fw"
        ]) &&
        looksLikeRealLineup(chunk)
      ) {
        return chunk;
      }
    }

    return "";
  }

  function findInjuryForTeam(team) {
    const teamRaw = clean(team);
    const teamEsc = escapeRegExp(teamRaw);

    const injuryWords = [
      "injury",
      "injuries",
      "suspended",
      "suspension",
      "doubtful",
      "out injured",
      "chấn thương",
      "chan thuong",
      "treo giò",
      "treo gio",
      "vắng mặt",
      "vang mat"
    ];

    const patterns = [
      new RegExp(`${teamEsc}[^.]{0,220}(${injuryWords.join("|")})[^.]{0,1200}`, "i"),
      new RegExp(`(${injuryWords.join("|")})[^.]{0,260}${teamEsc}[^.]{0,1200}`, "i")
    ];

    for (const p of patterns) {
      const m = text.match(p);

      if (m && m[0]) {
        const chunk = cleanLineupChunk(m[0]);

        if (chunk.length > 120) {
          return chunk.slice(0, 900);
        }
      }
    }

    return "";
  }

  return {
    lineupHomeWeb: findLineupForTeam(home),
    lineupAwayWeb: findLineupForTeam(away),
    injuriesHomeWeb: findInjuryForTeam(home),
    injuriesAwayWeb: findInjuryForTeam(away)
  };
}

/* =======================
   API-FOOTBALL
======================= */

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
  const awayLower = fold(away);

  return rows.find(f => {
    const h = fold(f?.teams?.home?.name);
    const a = fold(f?.teams?.away?.name);

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
      .filter(x => fold(x?.team?.name).includes(fold(homeName)) || fold(homeName).includes(fold(x?.team?.name)))
      .map(x => `${x?.player?.name || "Cầu thủ"}: ${x?.player?.reason || "vắng/đau"}`)
      .slice(0, 6);

    const awayInj = injRows
      .filter(x => fold(x?.team?.name).includes(fold(awayName)) || fold(awayName).includes(fold(x?.team?.name)))
      .map(x => `${x?.player?.name || "Cầu thủ"}: ${x?.player?.reason || "vắng/đau"}`)
      .slice(0, 6);

    const homeLine = lineRows.find(x => fold(x?.team?.name).includes(fold(homeName)));
    const awayLine = lineRows.find(x => fold(x?.team?.name).includes(fold(awayName)));

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

/* =======================
   CONTEXT SCORING
======================= */

function scoreContextFromText(text = "") {
  let tempo = 0;
  let homeIssues = 0;
  let awayIssues = 0;

  if (containsAny(text, ["defensive", "low block", "cautious", "low scoring", "under", "tight game", "phòng ngự", "thận trọng", "ít bàn", "xỉu"])) {
    tempo -= 1;
  }

  if (containsAny(text, ["attacking", "open game", "high scoring", "over", "pressing", "tấn công", "cởi mở", "nhiều bàn", "tài"])) {
    tempo += 1;
  }

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

/* =======================
   ROUTES
======================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Soi Kèo AI Research API V4.2 Safe Expert Consensus",
    endpoint: "/api/research",
    tavily: Boolean(process.env.TAVILY_API_KEY),
    apiFootball: Boolean(process.env.API_FOOTBALL_KEY),
    safeExpertConsensus: true
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
        readSourceCount: 0,
        weakIgnored: 0,
        winnerLean: "neutral",
        hdcLean: "neutral",
        ouLean: "neutral",
        confidence: 0,
        commonScores: [],
        summary: "Tự tìm chuyên gia đang tắt.",
        sources: [],
        votingSources: []
      }));
    }

    jobs.push(parseManualLinks(expertLinks, "expert_manual", home, away));
    jobs.push(parseManualLinks(superComputerLinks, "supercomputer_manual", home, away));

    const [
      webInfo,
      structured,
      autoConsensus,
      manualExpertSources,
      manualSuperSources
    ] = await Promise.all(jobs);

    const manualSources = [
      ...(manualExpertSources || []),
      ...(manualSuperSources || [])
    ];

    const combinedConsensus = manualSources.length
      ? buildConsensus([...(autoConsensus.sources || []), ...manualSources], home, away)
      : autoConsensus;

    combinedConsensus.rawAnswer = autoConsensus.rawAnswer || "";
    combinedConsensus.whitelist = autoConsensus.whitelist || [];
    combinedConsensus.methodologySource = "Safe Expert Consensus V4.2";

    const sourceText = [
      webInfo.answer,
      ...(webInfo.results || []).map(r => `${r.title}. ${r.snippet}`),
      combinedConsensus.summary,
      ...(combinedConsensus.sources || []).map(s => `${s.title}. ${s.snippet}`)
    ].join(" ");

    const webFallback = webLineupFallback(home, away, sourceText, combinedConsensus);
    const auto = scoreContextFromText(sourceText);

    let injuriesHome = webFallback.injuriesHomeWeb
      ? `Dự kiến từ web: ${webFallback.injuriesHomeWeb}`
      : "Chưa có dữ liệu chấn thương rõ ràng từ API/web.";

    let injuriesAway = webFallback.injuriesAwayWeb
      ? `Dự kiến từ web: ${webFallback.injuriesAwayWeb}`
      : "Chưa có dữ liệu chấn thương rõ ràng từ API/web.";

    let lineupHome = webFallback.lineupHomeWeb
      ? `Dự kiến từ web: ${webFallback.lineupHomeWeb}`
      : "Chưa có đội hình chính thức/dự kiến đủ tên cầu thủ từ API/web.";

    let lineupAway = webFallback.lineupAwayWeb
      ? `Dự kiến từ web: ${webFallback.lineupAwayWeb}`
      : "Chưa có đội hình chính thức/dự kiến đủ tên cầu thủ từ API/web.";

    if (structured) {
      if (structured.homeInjuries?.length) {
        injuriesHome = structured.homeInjuries.join("; ");
      }

      if (structured.awayInjuries?.length) {
        injuriesAway = structured.awayInjuries.join("; ");
      }

      if (structured.homeXI?.length) {
        lineupHome = `${structured.homeFormation || "Sơ đồ chưa rõ"}: ${structured.homeXI.join(", ")}`;
      } else if (structured.homeFormation) {
        lineupHome = `Sơ đồ: ${structured.homeFormation}`;
      }

      if (structured.awayXI?.length) {
        lineupAway = `${structured.awayFormation || "Sơ đồ chưa rõ"}: ${structured.awayXI.join(", ")}`;
      } else if (structured.awayFormation) {
        lineupAway = `Sơ đồ: ${structured.awayFormation}`;
      }
    }

    const summary = [
      webInfo.answer || `Đã tìm nhanh team news cho ${home} vs ${away}.`,
      combinedConsensus.summary || ""
    ].filter(Boolean).join(" ");

    const flags = {
      lowBlock:
        combinedConsensus.ouLean === "under" ||
        containsAny(sourceText, ["low block", "defensive", "tight game", "xỉu", "ít bàn"]),

      earlyGoalRisk:
        combinedConsensus.ouLean === "over" ||
        containsAny(sourceText, ["open game", "attacking", "high scoring", "tài", "nhiều bàn"]),

      rotation:
        containsAny(sourceText, ["rotation", "rotate", "xoay tua", "rest players", "giữ chân"]),

      homeMotivation:
        containsAny(sourceText, [`${home} need win`, `${home} must win`, "home motivation", "đội nhà cần thắng"]),

      awayMotivation:
        containsAny(sourceText, [`${away} need win`, `${away} must win`, "away motivation", "đội khách cần thắng"])
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
        autoExpertEnabled,
        safeMode: true
      },
      sources: [
        ...(webInfo.results || []),
        ...((combinedConsensus.sources || []).filter(s => s.url && !String(s.url).startsWith("tavily://")))
      ].slice(0, 14)
    });
  } catch (err) {
    res.status(500).json({
      error: "Research API failed",
      message: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Soi Kèo AI Research API V4.2 chạy tại http://localhost:${PORT}`);
});
