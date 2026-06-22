// server.js - Soi Kèo AI Research API V4.4 Source Split Voting
// Node.js 18+
// package.json cần có:
// {
//   "type": "module",
//   "scripts": { "start": "node server.js" },
//   "dependencies": {
//     "express": "^4.18.2",
//     "cors": "^2.8.5",
//     "dotenv": "^16.4.5"
//   }
// }

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

const PORT = process.env.PORT || 3000;

/* =========================
   BASIC HELPERS
========================= */

function clean(s = "") {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function fold(s = "") {
  return clean(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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

function isUrl(s = "") {
  return /^https?:\/\//i.test(clean(s));
}

function domainOf(url = "") {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    if (String(url).startsWith("manual-title://")) return "manual-title";
    if (String(url).startsWith("tavily://")) return "tavily";
    return "unknown";
  }
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

function getTavilyKey() {
  return process.env.TAVILY_API_KEY || process.env.TAVILY_KEY || "";
}

function getFootballKey() {
  return (
    process.env.API_FOOTBALL_KEY ||
    process.env.APIFOOTBALL_KEY ||
    process.env.API_FOOTBALL_API_KEY ||
    process.env.API_SPORTS_KEY ||
    ""
  );
}

/* =========================
   TEAM ALIAS
========================= */

const TEAM_ALIAS_GROUPS = [
  ["netherlands", "holland", "ha lan", "hà lan", "loc da cam", "lốc da cam"],
  ["sweden", "thuy dien", "thụy điển", "thuỵ điển"],
  ["germany", "duc", "đức"],
  ["ivory coast", "cote d ivoire", "côte d’ivoire", "bo bien nga", "bờ biển ngà"],
  ["usa", "united states", "united states of america", "my", "mỹ", "hoa ky", "hoa kỳ"],
  ["paraguay", "paraguay"],
  ["australia", "uc", "úc"],
  ["turkey", "turkiye", "türkiye", "tho nhi ky", "thổ nhĩ kỳ"],
  ["brazil", "brasil", "braxin"],
  ["morocco", "ma roc", "ma rốc"],
  ["scotland", "to cach lan", "tô cách lan"],
  ["haiti", "haiti"],
  ["mexico", "me xi co", "mê xi cô"],
  ["south korea", "korea republic", "han quoc", "hàn quốc"],
  ["czechia", "czech republic", "sec", "séc"],
  ["south africa", "nam phi"],
  ["canada", "ca na da"],
  ["bosnia", "bosnia and herzegovina", "bosnia herzegovina"],
  ["qatar", "qatar"],
  ["switzerland", "thuy si", "thụy sĩ", "thuỵ sĩ"],
  ["japan", "nhat ban", "nhật bản"],
  ["tunisia", "tunisia"],
  ["ecuador", "ecuador"],
  ["curacao", "curaçao"],
  ["spain", "tay ban nha", "tây ban nha"],
  ["uruguay", "uruguay"],
  ["cape verde", "cape verde"],
  ["saudi arabia", "saudi", "arab saudi"],
  ["belgium", "bi", "bỉ"],
  ["iran", "iran"],
  ["new zealand", "tan tay lan", "tân tây lan"],
  ["egypt", "ai cap", "ai cập"],
  ["france", "phap", "pháp"],
  ["senegal", "senegal"],
  ["iraq", "iraq"],
  ["norway", "na uy"],
  ["argentina", "argentine", "ac hen ti na", "ác hen ti na"],
  ["austria", "ao", "áo"],
  ["jordan", "jordan"],
  ["algeria", "algeria"],
  ["portugal", "bo dao nha", "bồ đào nha"],
  ["uzbekistan", "uzbekistan"],
  ["colombia", "colombia"],
  ["dr congo", "congo", "congo dr"],
  ["england", "anh", "tam su", "tam sư"],
  ["ghana", "ghana"],
  ["panama", "panama"],
  ["croatia", "croatia"],
  ["poland", "ba lan"],
  ["northern ireland", "bac ireland", "bắc ireland"],
  ["vietnam", "viet nam", "việt nam"],
  ["thailand", "thai lan", "thái lan"],
  ["indonesia", "indonesia"],
  ["malaysia", "malaysia"],
  ["singapore", "singapore"]
];

function normalizeTeamName(s = "") {
  return fold(s)
    .replace(/\bfc\b/g, "")
    .replace(/\bafc\b/g, "")
    .replace(/\bcf\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasSetFor(name = "") {
  const n = normalizeTeamName(name);
  const set = new Set();

  if (n) set.add(n);

  n.split(" ").forEach(tok => {
    if (tok.length >= 3) set.add(tok);
  });

  for (const group of TEAM_ALIAS_GROUPS) {
    const folded = group.map(x => normalizeTeamName(x)).filter(Boolean);

    if (
      folded.includes(n) ||
      folded.some(x => x.length >= 3 && n.includes(x)) ||
      folded.some(x => x.length >= 3 && x.includes(n))
    ) {
      folded.forEach(x => {
        if (x.length >= 3) set.add(x);
      });
    }
  }

  return [...set].filter(x => x.length >= 3);
}

function textHasTeam(text = "", team = "") {
  const t = normalizeTeamName(text);
  const aliases = aliasSetFor(team);

  return aliases.some(a => t.includes(a));
}

function textHasBothTeams(text = "", home = "", away = "") {
  return textHasTeam(text, home) && textHasTeam(text, away);
}

function hasVsPattern(text = "") {
  const t = fold(text);

  return (
    /\bvs\b/.test(t) ||
    /\bv\b/.test(t) ||
    t.includes(" versus ") ||
    t.includes(" gặp ") ||
    t.includes(" gap ") ||
    t.includes(" đối đầu ") ||
    t.includes(" doi dau ")
  );
}

function opponentMismatchInTitle(title = "", home = "", away = "") {
  const t = clean(title);
  if (!hasVsPattern(t)) return false;

  const hasHome = textHasTeam(t, home);
  const hasAway = textHasTeam(t, away);

  if (hasHome && !hasAway) return true;
  if (hasAway && !hasHome) return true;

  return false;
}

/* =========================
   TRUSTED DOMAINS
========================= */

const DOMAIN_PROFILE = {
  "bongdaplus.vn": { label: "Bongdaplus", priority: 1.25 },
  "bongda24h.vn": { label: "Bongda24h", priority: 1.24 },
  "thethao247.vn": { label: "Thể Thao 247", priority: 1.18 },
  "kqbd.mobi": { label: "KQBD.mobi", priority: 1.1 },
  "bongdanet.online": { label: "Bongdanet", priority: 1.05 },
  "adidas-fifa.com": { label: "Adidas-Fifa", priority: 0.78 },
  "footballwhispers.com": { label: "Football Whispers", priority: 0.92 },
  "sportsmole.co.uk": { label: "Sports Mole", priority: 0.88 },
  "whoscored.com": { label: "WhoScored", priority: 0.95 },
  "rotowire.com": { label: "RotoWire", priority: 0.9 },
  "forebet.com": { label: "Forebet", priority: 0.85 },
  "predictz.com": { label: "PredictZ", priority: 0.82 }
};

const PREFERRED_DOMAINS = Object.keys(DOMAIN_PROFILE);

function isTrustedDomain(url = "") {
  return Boolean(DOMAIN_PROFILE[domainOf(url)]);
}

function domainPriority(url = "") {
  return DOMAIN_PROFILE[domainOf(url)]?.priority || 0.62;
}

function isKnownCategoryUrl(url = "") {
  const u = fold(url);

  return (
    u.includes("nhan-dinh-bong-da-tags") ||
    u.includes("nhan-dinh-bong-da-c344") ||
    u.includes("nhan-dinh-bong-da-c288") ||
    (u.includes("/nhan-dinh-bong-da") && !/\d{4}|vs|\.html/.test(u)) ||
    (u.includes("/soi-keo-bong-da") && !/\d{4}|vs|\.html/.test(u)) ||
    (u.includes("/du-doan-bong-da") && !/\d{4}|vs|\.html/.test(u)) ||
    (u.includes("/sieu-may-tinh-du-doan-bong-da") && !/\d{4}|vs|\.html/.test(u))
  );
}

function isSuperComputerSource(url = "", text = "") {
  const t = fold(`${url} ${text}`);

  return containsAny(t, [
    "supercomputer",
    "sieu may tinh",
    "siêu máy tính",
    "probability",
    "xác suất",
    "xac suat",
    "expected goals",
    "xg",
    "monte carlo",
    "machine learning",
    "predictz",
    "forebet"
  ]);
}

/* =========================
   DETECTION
========================= */

function detectScore(text = "") {
  const t = clean(text);

  const patterns = [
    /(?:prediction|score|scoreline|correct score|tỷ số|ti so|dự đoán|du doan|kết quả|ket qua)[^\d]{0,70}(\d{1,2})\s*[-:]\s*(\d{1,2})/i,
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

function detectOU(text = "") {
  const t = fold(text);

  let over = 0;
  let under = 0;

  if (containsAny(t, [
    "over", "tai", "tài", "mưa bàn thắng", "mua ban thang", "nhiều bàn", "nhieu ban",
    "high scoring", "goals expected", "open game", "attacking game", "both teams to score", "btts"
  ])) over += 1;

  if (containsAny(t, [
    "under", "xiu", "xỉu", "it ban", "ít bàn",
    "low scoring", "tight game", "cautious", "defensive", "low block"
  ])) under += 1;

  if (over > under) return "over";
  if (under > over) return "under";
  return "neutral";
}

function detectWinner(text = "", home = "", away = "") {
  const t = fold(text);

  let hs = 0;
  let as = 0;
  let ds = 0;

  const score = detectScore(text);
  const scoreLean = scoreToLean(score);

  if (scoreLean === "home") hs += 2;
  if (scoreLean === "away") as += 2;
  if (scoreLean === "draw") ds += 2;

  for (const h of aliasSetFor(home)) {
    if (
      t.includes(`${h} thang`) ||
      t.includes(`${h} thắng`) ||
      t.includes(`${h} win`) ||
      t.includes(`${h} to win`) ||
      t.includes(`${h} victory`)
    ) hs += 3;
  }

  for (const a of aliasSetFor(away)) {
    if (
      t.includes(`${a} thang`) ||
      t.includes(`${a} thắng`) ||
      t.includes(`${a} win`) ||
      t.includes(`${a} to win`) ||
      t.includes(`${a} victory`)
    ) as += 3;
  }

  if (containsAny(t, ["draw", "hòa", "hoa", "stalemate", "chia điểm", "chia diem"])) ds += 2;

  if (textHasTeam(t, home) && containsAny(t, ["favorite", "favourite", "được đánh giá cao", "duoc danh gia cao", "cửa trên", "cua tren"])) hs += 1;
  if (textHasTeam(t, away) && containsAny(t, ["favorite", "favourite", "được đánh giá cao", "duoc danh gia cao", "cửa trên", "cua tren"])) as += 1;

  if (hs > as && hs > ds) return "home";
  if (as > hs && as > ds) return "away";
  if (ds > hs && ds > as) return "draw";
  return "neutral";
}

function detectHdc(text = "", home = "", away = "") {
  const t = fold(text);
  const winner = detectWinner(text, home, away);

  let homeHdc = 0;
  let awayHdc = 0;

  if (winner === "home") homeHdc += 1.2;
  if (winner === "away") awayHdc += 1.2;
  if (winner === "draw") {
    homeHdc += 0.25;
    awayHdc += 0.25;
  }

  if (containsAny(t, ["cover the spread", "cover handicap", "thắng kèo", "thang keo", "ăn kèo", "an keo", "handicap"])) {
    if (textHasTeam(t, home)) homeHdc += 1;
    if (textHasTeam(t, away)) awayHdc += 1;
  }

  if (homeHdc >= awayHdc + 1) return "homeHdc";
  if (awayHdc >= homeHdc + 1) return "awayHdc";
  return "neutral";
}

/* =========================
   SOURCE QUALITY + CONSENSUS
========================= */

function qualitySource({ title = "", url = "", text = "", manualPriority = false, fromManualTitle = false }, home = "", away = "") {
  const all = `${title}. ${url}. ${text}`;

  const titleBoth = textHasBothTeams(title, home, away);
  const urlBoth = textHasBothTeams(url, home, away);
  const textBoth = textHasBothTeams(all, home, away);

  const matchOk = titleBoth || urlBoth || textBoth;
  const hardReject =
    opponentMismatchInTitle(title, home, away) ||
    opponentMismatchInTitle(url, home, away);

  const isCategory = isKnownCategoryUrl(url) && !titleBoth && !urlBoth;
  const trusted = isTrustedDomain(url);

  const score = detectScore(all);
  const ou = detectOU(all);
  const hdc = detectHdc(all, home, away);
  const winner = detectWinner(all, home, away);
  const hasProb = /\d{1,3}\s*%/.test(all) && containsAny(all, ["xác suất", "xac suat", "probability", "chance", "win probability"]);

  let q = 0;
  const flags = [];

  if (hardReject) {
    q = 0;
    flags.push("sai cặp trong title/url, loại vote");
  } else {
    if (matchOk) {
      q += 20;
      flags.push("đúng 2 đội");
    }

    if (titleBoth) {
      q += 28;
      flags.push("title đúng trận");
    }

    if (urlBoth) {
      q += 14;
      flags.push("url đúng trận");
    }

    if (trusted) {
      q += 10;
      flags.push("domain có độ tin cậy");
    }

    if (manualPriority) {
      q += 16;
      flags.push("nguồn thủ công ưu tiên");
    }

    if (fromManualTitle) {
      q += 6;
      flags.push("tìm từ tiêu đề bạn dán");
    }

    if (score) q += 12;
    if (hasProb) q += 14;
    if (ou !== "neutral") q += 10;
    if (hdc !== "neutral") q += 10;
    if (winner !== "neutral") q += 6;
    if (isSuperComputerSource(url, all)) q += 6;

    if (isCategory) {
      q -= 30;
      flags.push("trang chuyên mục, giảm mạnh");
    }

    if (!matchOk) q = Math.min(q, manualPriority ? 42 : 20);
  }

  q = clamp(q, 0, 100);

  const voteAllowed =
    !hardReject &&
    matchOk &&
    q >= 50 &&
    !isCategory;

  const priority = domainPriority(url) * (manualPriority ? 1.18 : 1);
  const confidence = clamp(0.22 + q / 145, 0.22, 0.84);
  const voteWeight = voteAllowed ? confidence * (q / 100) * priority : 0;

  let qualityLabel = "rejected";
  if (q >= 72) qualityLabel = "strong";
  else if (q >= 55) qualityLabel = "medium";
  else if (q >= 40) qualityLabel = "weak";

  return {
    domain: domainOf(url),
    matchOk,
    hardReject,
    isCategory,
    trusted,
    quality: q,
    qualityLabel,
    voteAllowed,
    voteWeight,
    confidence,
    flags,
    score,
    ou,
    hdc,
    winner,
    hasProb,
    displayEligible: !hardReject && (voteAllowed || q >= 40 || manualPriority)
  };
}

function parseExpertSource({ title = "", url = "", text = "", type = "auto", manualPriority = false, fromManualTitle = false }, home, away) {
  const blob = clean(`${title}. ${text}`);
  const q = qualitySource({ title, url, text: blob, manualPriority, fromManualTitle }, home, away);

  const winnerLean = q.voteAllowed ? detectWinner(blob, home, away) : "neutral";
  const hdcLean = q.voteAllowed ? detectHdc(blob, home, away) : "neutral";
  const ouLean = q.voteAllowed ? detectOU(blob) : "neutral";
  const score = q.voteAllowed ? detectScore(blob) : "";

  return {
    title: clean(title) || url,
    url,
    domain: q.domain,
    type: isSuperComputerSource(url, blob) ? "supercomputer" : type,
    manualPriority,
    fromManualTitle,
    quality: q.quality,
    qualityLabel: q.qualityLabel,
    voteAllowed: q.voteAllowed,
    voteWeight: q.voteWeight,
    displayEligible: q.displayEligible,
    hardReject: q.hardReject,
    qualityFlags: q.flags,
    matchOk: q.matchOk,
    isCategory: q.isCategory,
    winnerLean,
    hdcLean,
    ouLean,
    score,
    hasProbability: q.hasProb,
    confidence: q.confidence,
    note: `Winner ${winnerLean}; HDC ${hdcLean}; OU ${ouLean}; score ${score || "none"}`,
    snippet: blob.slice(0, 900)
  };
}

function bestPerDomain(sources = []) {
  const map = new Map();

  for (const s of sources) {
    if (!s || !s.url || s.hardReject) continue;

    const key = s.domain || domainOf(s.url);
    const old = map.get(key);

    const oldPower = old
      ? (old.voteWeight || 0) + (old.quality || 0) / 200 + (old.manualPriority ? 0.5 : 0)
      : -1;

    const newPower =
      (s.voteWeight || 0) + (s.quality || 0) / 200 + (s.manualPriority ? 0.5 : 0);

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
  const manualVoting = voting.filter(s => s.manualPriority).length;
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

  const hasRealKeo = voting.some(s => s.hdcLean !== "neutral" || s.ouLean !== "neutral");
  const hasScoreOrProb = voting.some(s => s.score || s.hasProbability);

  let appConfidence = 0;

  if (manualVoting >= 2 && voting.length >= 3 && strongCount >= 2 && avgAgreement >= 0.68 && hasRealKeo) {
    appConfidence = 0.66;
  } else if (voting.length >= 5 && strongCount >= 3 && avgAgreement >= 0.70 && hasRealKeo) {
    appConfidence = 0.62;
  } else if (voting.length >= 3 && mediumCount >= 3 && avgAgreement >= 0.62 && hasRealKeo) {
    appConfidence = 0.48;
  } else if (voting.length >= 2 && avgAgreement >= 0.58) {
    appConfidence = 0.34;
  } else if (voting.length >= 1) {
    appConfidence = 0.22;
  }

  if (!hasRealKeo) appConfidence = Math.min(appConfidence, 0.28);
  if (!hasScoreOrProb && superCount > 0) appConfidence = Math.min(appConfidence, 0.42);
  if (avgQuality < 55) appConfidence = Math.min(appConfidence, 0.26);

  appConfidence = clamp(appConfidence, 0, 0.68);

  const hardRejected = all.filter(s => s.hardReject).length;
  const weakIgnored = all.filter(s => !s.voteAllowed).length;

  const displaySources = [...all]
    .filter(s => s.displayEligible)
    .sort((a, b) => {
      const ap = (a.manualPriority ? 1000 : 0) + (a.voteAllowed ? 500 : 0) + (a.quality || 0);
      const bp = (b.manualPriority ? 1000 : 0) + (b.voteAllowed ? 500 : 0) + (b.quality || 0);
      return bp - ap;
    })
    .slice(0, 14);

  const summaryParts = [];

  if (voting.length) summaryParts.push(`${voting.length} nguồn đủ chuẩn`);
  else summaryParts.push("chưa có nguồn đủ chuẩn");

  if (manualVoting) summaryParts.push(`${manualVoting} nguồn thủ công được tính`);

  if (winner.lean !== "neutral") {
    summaryParts.push(`winner nghiêng ${winner.lean === "home" ? home : winner.lean === "away" ? away : "hòa"}`);
  }

  if (hdc.lean !== "neutral") {
    summaryParts.push(`HDC nghiêng ${hdc.lean === "homeHdc" ? home : away}`);
  }

  if (ou.lean !== "neutral") {
    summaryParts.push(`T/X nghiêng ${ou.lean === "over" ? "Tài" : "Xỉu"}`);
  }

  if (scores.length) summaryParts.push(`tỷ số hay gặp: ${scores.join(", ")}`);

  return {
    status: voting.length ? "ok" : "weak_or_no_sources",
    safeMode: true,
    sourcePriorityGate: true,
    sourceSplitVoting: true,
    sourceCount: voting.length,
    readSourceCount: all.length,
    displayedSourceCount: displaySources.length,
    manualVotingSourceCount: manualVoting,
    weakIgnored,
    hardRejected,
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
    summary: `Expert Gate V4.4: ${summaryParts.join("; ")}. ${hardRejected ? `Đã loại ${hardRejected} nguồn sai cặp.` : ""} ${weakIgnored ? `Bỏ qua ${weakIgnored} nguồn yếu/trang chuyên mục.` : ""}`.trim(),
    votes: {
      winner: winner.score,
      hdc: hdc.score,
      ou: ou.score
    },
    sources: displaySources,
    votingSources: voting,
    rejectedSources: all.filter(s => s.hardReject).slice(0, 8)
  };
}

function emptyConsensus() {
  return buildConsensus([], "", "");
}

/* =========================
   TAVILY + PAGE FETCH
========================= */

async function tavilySearch(query, maxResults = 6) {
  const key = getTavilyKey();

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

async function safeTavilySearch(query, maxResults = 6) {
  try {
    return await tavilySearch(query, maxResults);
  } catch (e) {
    return {
      answer: "",
      results: [],
      error: e.message || "Tavily failed"
    };
  }
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
        .replace(/&quot;/g, '"')
    ).slice(0, 18000);
  } catch {
    return "";
  }
}

/* =========================
   EXPERT / SUPERCOMPUTER SEARCH
========================= */

async function autoExpertSearch(home, away, league, date, manualMode = false) {
  const preferredQueries = [
    ...PREFERRED_DOMAINS.slice(0, 8).map(site => `site:${site} ${home} ${away} nhận định soi kèo dự đoán tỷ số tài xỉu handicap`),
    `site:kqbd.mobi/du-doan-bong-da ${home} ${away} dự đoán bóng đá xác suất tỷ số`,
    `site:bongdanet.online/sieu-may-tinh-du-doan-bong-da ${home} ${away} siêu máy tính dự đoán bóng đá`
  ];

  const openQueries = [
    `${home} vs ${away} ${league} ${date} prediction preview betting tips correct score over under handicap`,
    `${home} vs ${away} supercomputer prediction probability score expected goals`
  ];

  const queries = manualMode
    ? preferredQueries.slice(0, 8)
    : [...preferredQueries.slice(0, 8), ...openQueries];

  const packs = await Promise.allSettled(
    queries.map(q => safeTavilySearch(q, manualMode ? 4 : 5))
  );

  const results = [];
  const answers = [];

  for (const p of packs) {
    if (p.status !== "fulfilled") continue;

    if (p.value.answer && !manualMode) answers.push(p.value.answer);
    results.push(...(p.value.results || []));
  }

  const deduped = uniqByUrl(results)
    .map(r => {
      const blob = `${r.title} ${r.snippet} ${r.url}`;
      let boost = 0;

      if (isTrustedDomain(r.url)) boost += 1.8;
      if (textHasBothTeams(blob, home, away)) boost += 2.2;
      if (opponentMismatchInTitle(r.title, home, away) || opponentMismatchInTitle(r.url, home, away)) boost -= 99;
      if (isSuperComputerSource(r.url, blob)) boost += 0.8;
      if (containsAny(blob, ["soi kèo", "soi keo", "nhận định", "nhan dinh", "prediction", "preview"])) boost += 0.7;
      if (isKnownCategoryUrl(r.url)) boost -= 1.2;

      return { ...r, localBoost: boost };
    })
    .filter(r => r.localBoost > -50)
    .filter(r => manualMode ? isTrustedDomain(r.url) : true)
    .sort((a, b) => (b.localBoost + clamp(b.score, 0, 99)) - (a.localBoost + clamp(a.score, 0, 99)))
    .slice(0, manualMode ? 8 : 12);

  const pageTexts = await Promise.all(deduped.map(r => fetchPageText(r.url)));

  const sources = deduped.map((r, i) => parseExpertSource({
    title: r.title,
    url: r.url,
    text: pageTexts[i] || r.snippet || "",
    type: "auto",
    manualPriority: false,
    fromManualTitle: false
  }, home, away));

  const answerSource = answers.length
    ? parseExpertSource({
        title: "Tavily tổng hợp nhanh",
        url: "tavily://answer",
        text: answers.join(" "),
        type: "summary",
        manualPriority: false
      }, home, away)
    : null;

  const allSources = answerSource ? [answerSource, ...sources] : sources;
  const consensus = buildConsensus(allSources, home, away);

  return {
    ...consensus,
    whitelist: PREFERRED_DOMAINS,
    methodologySource: "Source Split Voting V4.4",
    rawAnswer: answers.join(" ").slice(0, 1600)
  };
}

async function safeAutoExpertSearch(home, away, league, date, manualMode = false) {
  try {
    return await autoExpertSearch(home, away, league, date, manualMode);
  } catch (e) {
    return {
      ...buildConsensus([], home, away),
      status: "auto_failed",
      summary: `Auto expert lỗi nhưng API không sập: ${e.message || "unknown"}`,
      rawAnswer: ""
    };
  }
}

async function parseManualInputs(lines = [], type, home, away) {
  const inputs = lines.map(clean).filter(Boolean).slice(0, 12);
  const directUrls = inputs.filter(isUrl);
  const titleQueries = inputs.filter(x => !isUrl(x));

  const directTexts = await Promise.all(directUrls.map(u => fetchPageText(u)));

  const directSources = directUrls.map((url, i) => parseExpertSource({
    title: url,
    url,
    text: directTexts[i] || "",
    type,
    manualPriority: true,
    fromManualTitle: false
  }, home, away));

  const titleSearches = await Promise.allSettled(
    titleQueries.map(async q => {
      const pack = await safeTavilySearch(`"${q}" ${home} ${away}`, 3);

      const results = uniqByUrl(pack.results || [])
        .filter(r => !opponentMismatchInTitle(r.title, home, away))
        .slice(0, 2);

      const texts = await Promise.all(results.map(r => fetchPageText(r.url)));

      const parsed = results.map((r, i) => parseExpertSource({
        title: r.title || q,
        url: r.url,
        text: texts[i] || r.snippet || q,
        type,
        manualPriority: true,
        fromManualTitle: true
      }, home, away));

      if (!parsed.length) {
        parsed.push(parseExpertSource({
          title: q,
          url: `manual-title://${encodeURIComponent(q)}`,
          text: q,
          type,
          manualPriority: true,
          fromManualTitle: true
        }, home, away));
      }

      return parsed;
    })
  );

  const titleSources = [];

  for (const r of titleSearches) {
    if (r.status === "fulfilled") titleSources.push(...r.value);
  }

  return [...directSources, ...titleSources];
}

async function safeParseManualInputs(lines = [], type, home, away) {
  try {
    return await parseManualInputs(lines, type, home, away);
  } catch {
    return [];
  }
}

/* =========================
   CONTEXT / MARKET SPLIT
========================= */

function emptyImpact() {
  return {
    status: "none",
    confidence: 0,
    summary: "Chưa có dữ liệu.",
    score: {
      homeHdc: 0,
      awayHdc: 0,
      over: 0,
      under: 0
    },
    notes: [],
    sources: []
  };
}

async function readTypedLinks(lines = [], type = "context", home = "", away = "") {
  const inputs = lines.map(clean).filter(Boolean).slice(0, 12);
  const urls = inputs.filter(isUrl);
  const titles = inputs.filter(x => !isUrl(x));

  const out = [];

  const urlTexts = await Promise.all(urls.map(u => fetchPageText(u)));

  urls.forEach((url, i) => {
    out.push({
      title: url,
      url,
      type,
      text: urlTexts[i] || "",
      manualPriority: true
    });
  });

  const titleSearches = await Promise.allSettled(
    titles.map(async q => {
      const pack = await safeTavilySearch(`"${q}" ${home} ${away}`, 3);

      const results = uniqByUrl(pack.results || [])
        .filter(r => !opponentMismatchInTitle(r.title, home, away))
        .slice(0, 2);

      const texts = await Promise.all(results.map(r => fetchPageText(r.url)));

      if (!results.length) {
        return [{
          title: q,
          url: `manual-title://${encodeURIComponent(q)}`,
          type,
          text: q,
          manualPriority: true
        }];
      }

      return results.map((r, i) => ({
        title: r.title || q,
        url: r.url,
        type,
        text: texts[i] || r.snippet || q,
        manualPriority: true
      }));
    })
  );

  for (const r of titleSearches) {
    if (r.status === "fulfilled") out.push(...r.value);
  }

  return out;
}

async function safeReadTypedLinks(lines = [], type = "context", home = "", away = "") {
  try {
    return await readTypedLinks(lines, type, home, away);
  } catch {
    return [];
  }
}

function buildContextImpact(sources = [], home = "", away = "") {
  if (!sources.length) return emptyImpact();

  const score = { homeHdc: 0, awayHdc: 0, over: 0, under: 0 };
  const notes = [];
  const used = [];

  function add(key, val, note) {
    score[key] += val;
    notes.push(note);
  }

  for (const src of sources) {
    const title = src.title || "";
    const text = clean(`${src.title || ""}. ${src.url || ""}. ${src.text || ""}`);
    const t = fold(text);

    const hasHome = textHasTeam(text, home);
    const hasAway = textHasTeam(text, away);
    const both = hasHome && hasAway;

    if (!both && !src.manualPriority) continue;

    let localHit = false;

    const issueWords = [
      "injury", "injuries", "injured", "suspended", "doubtful", "out injured",
      "chấn thương", "chan thuong", "treo giò", "treo gio",
      "vắng", "vang", "xoay tua", "rotation", "rest", "dưỡng sức", "duong suc"
    ];

    const defensiveIssue =
      containsAny(t, ["trung vệ", "centre back", "center back", "defender", "hậu vệ", "hau ve", "goalkeeper", "thủ môn", "thu mon"]) &&
      containsAny(t, issueWords);

    const attackingIssue =
      containsAny(t, ["striker", "forward", "winger", "tiền đạo", "tien dao", "chân sút", "chan sut"]) &&
      containsAny(t, issueWords);

    const homeIssue = hasHome && containsAny(t, issueWords);
    const awayIssue = hasAway && containsAny(t, issueWords);

    if (homeIssue) {
      add("awayHdc", 1.2, `${home} có vấn đề lực lượng/bối cảnh`);
      add("homeHdc", -1.0, `${home} bị trừ vì lực lượng/bối cảnh`);
      localHit = true;
    }

    if (awayIssue) {
      add("homeHdc", 1.2, `${away} có vấn đề lực lượng/bối cảnh`);
      add("awayHdc", -1.0, `${away} bị trừ vì lực lượng/bối cảnh`);
      localHit = true;
    }

    if (defensiveIssue) {
      add("over", 0.6, "Có dấu hiệu hàng thủ/thủ môn sứt mẻ, tăng nhẹ Tài");
      localHit = true;
    }

    if (attackingIssue) {
      add("under", 0.45, "Có dấu hiệu hàng công vắng người, tăng nhẹ Xỉu");
      add("over", -0.35, "Hàng công thiếu người, giảm nhẹ Tài");
      localHit = true;
    }

    if (containsAny(t, ["đội nhà cần thắng", "home need win", "home must win", "motivation home", "must win for home"])) {
      add("homeHdc", 0.9, "Động lực đội nhà tốt");
      add("over", 0.25, "Đội nhà cần thắng, tăng nhẹ nhịp trận");
      localHit = true;
    }

    if (containsAny(t, ["đội khách cần thắng", "away need win", "away must win", "motivation away", "must win for away"])) {
      add("awayHdc", 0.9, "Động lực đội khách tốt");
      add("over", 0.25, "Đội khách cần thắng, tăng nhẹ nhịp trận");
      localHit = true;
    }

    if (containsAny(t, ["mưa lớn", "mua lon", "heavy rain", "sân xấu", "san xau", "bad pitch", "low block", "defensive", "tight game", "thận trọng", "than trong", "cautious"])) {
      add("under", 1.2, "Bối cảnh nghiêng nhịp chậm/Xỉu");
      add("over", -1.0, "Bối cảnh cản Tài");
      localHit = true;
    }

    if (containsAny(t, ["open game", "attacking", "pressing", "nhiều bàn", "nhieu ban", "mưa bàn thắng", "mua ban thang", "both teams to score", "btts"])) {
      add("over", 1.2, "Bối cảnh nghiêng trận mở/Tài");
      add("under", -1.0, "Bối cảnh cản Xỉu");
      localHit = true;
    }

    if (containsAny(t, ["schedule congestion", "fixture congestion", "lịch dày", "lich day", "fatigue", "mệt mỏi", "met moi"])) {
      if (hasHome) {
        add("awayHdc", 0.45, `${home} có dấu hiệu lịch dày/mệt`);
        add("homeHdc", -0.35, `${home} lịch dày, giảm HDC`);
      }
      if (hasAway) {
        add("homeHdc", 0.45, `${away} có dấu hiệu lịch dày/mệt`);
        add("awayHdc", -0.35, `${away} lịch dày, giảm HDC`);
      }
      add("under", 0.25, "Lịch dày có thể giảm nhịp trận");
      localHit = true;
    }

    if (localHit) {
      used.push({
        title,
        url: src.url,
        type: "context",
        snippet: text.slice(0, 900)
      });
    }
  }

  const totalAbs = Object.values(score).reduce((a, b) => a + Math.abs(b), 0);
  const confidence = clamp(totalAbs / 8, 0, 0.75);

  let summary = "Lực lượng/bối cảnh chưa có hướng rõ.";
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];

  if (best && best[1] > 0.4) {
    const label = {
      homeHdc: `ủng hộ ${home} HDC`,
      awayHdc: `ủng hộ ${away} HDC`,
      over: "ủng hộ Tài",
      under: "ủng hộ Xỉu"
    }[best[0]];

    summary = `Lực lượng/bối cảnh ${label}.`;
  }

  return {
    status: used.length ? "ok" : "weak",
    confidence,
    summary,
    score: {
      homeHdc: clamp(score.homeHdc, -3, 3),
      awayHdc: clamp(score.awayHdc, -3, 3),
      over: clamp(score.over, -3, 3),
      under: clamp(score.under, -3, 3)
    },
    notes: [...new Set(notes)].slice(0, 10),
    sources: used.slice(0, 10)
  };
}

function buildMarketImpact(sources = [], home = "", away = "") {
  if (!sources.length) return emptyImpact();

  const score = { homeHdc: 0, awayHdc: 0, over: 0, under: 0 };
  const notes = [];
  const used = [];

  function add(key, val, note) {
    score[key] += val;
    notes.push(note);
  }

  for (const src of sources) {
    const title = src.title || "";
    const text = clean(`${src.title || ""}. ${src.url || ""}. ${src.text || ""}`);
    const t = fold(text);

    let localHit = false;

    const homeMention = textHasTeam(text, home);
    const awayMention = textHasTeam(text, away);

    if (containsAny(t, [
      "over odds drop", "odds over drop", "odds tài giảm", "tai odds giam",
      "tài bị đè", "tai bi de", "over backed", "steam over",
      "money on over", "sharp over"
    ])) {
      add("over", 1.4, "Thị trường/odds ủng hộ Tài");
      add("under", -1.0, "Thị trường/odds cản Xỉu");
      localHit = true;
    }

    if (containsAny(t, [
      "under odds drop", "odds under drop", "odds xỉu giảm", "xiu odds giam",
      "xỉu bị đè", "xiu bi de", "under backed", "steam under",
      "money on under", "sharp under"
    ])) {
      add("under", 1.4, "Thị trường/odds ủng hộ Xỉu");
      add("over", -1.0, "Thị trường/odds cản Tài");
      localHit = true;
    }

    if (containsAny(t, [
      "line moved up", "total moved up", "tài xỉu tăng", "tai xiu tang",
      "mốc tăng", "moc tang", "total line rises", "total rises"
    ])) {
      add("over", 1.0, "Mốc T/X tăng, thị trường nghiêng Tài");
      localHit = true;
    }

    if (containsAny(t, [
      "line moved down", "total moved down", "tài xỉu giảm", "tai xiu giam",
      "mốc giảm", "moc giam", "total line drops", "total drops"
    ])) {
      add("under", 1.0, "Mốc T/X giảm, thị trường nghiêng Xỉu");
      localHit = true;
    }

    if (homeMention && containsAny(t, [
      "odds drop", "price shortened", "backed", "steam", "bị đè", "bi de",
      "odds giảm", "odds giam", "market support", "money on"
    ])) {
      add("homeHdc", 1.2, `Thị trường đè ${home}`);
      add("awayHdc", -0.8, `Thị trường không ủng hộ ${away}`);
      localHit = true;
    }

    if (awayMention && containsAny(t, [
      "odds drop", "price shortened", "backed", "steam", "bị đè", "bi de",
      "odds giảm", "odds giam", "market support", "money on"
    ])) {
      add("awayHdc", 1.2, `Thị trường đè ${away}`);
      add("homeHdc", -0.8, `Thị trường không ủng hộ ${home}`);
      localHit = true;
    }

    if (containsAny(t, [
      "trap", "bẫy", "bay", "public money", "sharp money",
      "reverse line movement", "rlm", "fake move", "kèo dụ", "keo du"
    ])) {
      add("homeHdc", -0.4, "Có dấu hiệu trap/reverse line, giảm nhẹ HDC");
      add("awayHdc", -0.4, "Có dấu hiệu trap/reverse line, giảm nhẹ HDC");
      add("over", -0.3, "Có dấu hiệu trap/reverse line, giảm nhẹ T/X");
      add("under", -0.3, "Có dấu hiệu trap/reverse line, giảm nhẹ T/X");
      localHit = true;
    }

    if (localHit) {
      used.push({
        title,
        url: src.url,
        type: "market",
        snippet: text.slice(0, 900)
      });
    }
  }

  const totalAbs = Object.values(score).reduce((a, b) => a + Math.abs(b), 0);
  const confidence = clamp(totalAbs / 8, 0, 0.75);

  let summary = "Odds thị trường chưa có hướng rõ.";
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];

  if (best && best[1] > 0.4) {
    const label = {
      homeHdc: `ủng hộ ${home} HDC`,
      awayHdc: `ủng hộ ${away} HDC`,
      over: "ủng hộ Tài",
      under: "ủng hộ Xỉu"
    }[best[0]];

    summary = `Odds thị trường ${label}.`;
  }

  return {
    status: used.length ? "ok" : "weak",
    confidence,
    summary,
    score: {
      homeHdc: clamp(score.homeHdc, -3, 3),
      awayHdc: clamp(score.awayHdc, -3, 3),
      over: clamp(score.over, -3, 3),
      under: clamp(score.under, -3, 3)
    },
    notes: [...new Set(notes)].slice(0, 10),
    sources: used.slice(0, 10)
  };
}

/* =========================
   API FOOTBALL
========================= */

async function apiFootball(path) {
  try {
    const key = getFootballKey();
    if (!key) return null;

    const res = await fetch(`https://v3.football.api-sports.io${path}`, {
      headers: { "x-apisports-key": key }
    });

    if (!res.ok) return null;

    return await res.json();
  } catch {
    return null;
  }
}

function teamSearchCandidates(name = "") {
  const raw = clean(name);
  const aliases = aliasSetFor(name);

  return [...new Set([raw, ...aliases])]
    .map(clean)
    .filter(Boolean)
    .slice(0, 8);
}

async function findTeamId(name) {
  const candidates = teamSearchCandidates(name);

  for (const c of candidates) {
    const data = await apiFootball(`/teams?search=${encodeURIComponent(c)}`);
    const row = data?.response?.[0];

    if (row?.team?.id) return row.team.id;
  }

  return null;
}

async function findFixture(home, away, date = "") {
  const homeId = await findTeamId(home);
  const awayId = await findTeamId(away);

  const pools = [];

  if (homeId) {
    const data = await apiFootball(`/fixtures?team=${homeId}&next=30`);
    pools.push(...(data?.response || []));
  }

  if (awayId) {
    const data = await apiFootball(`/fixtures?team=${awayId}&next=30`);
    pools.push(...(data?.response || []));
  }

  const rows = pools.filter(Boolean);
  const seen = new Set();
  const deduped = [];

  for (const f of rows) {
    const id = f?.fixture?.id;
    if (!id || seen.has(id)) continue;

    seen.add(id);
    deduped.push(f);
  }

  const exact = deduped.filter(f => {
    const h = f?.teams?.home?.name || "";
    const a = f?.teams?.away?.name || "";
    const blob = `${h} ${a}`;
    return textHasTeam(blob, home) && textHasTeam(blob, away);
  });

  if (!exact.length) return deduped[0] || null;

  if (date) {
    const dText = fold(date);
    const dated = exact.find(f => fold(f?.fixture?.date || "").includes(dText));
    if (dated) return dated;
  }

  return exact[0];
}

async function footballStructured(home, away, date = "") {
  if (!getFootballKey()) return null;

  const fixture = await findFixture(home, away, date);
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
    .filter(x => textHasTeam(x?.team?.name || "", homeName))
    .map(x => `${x?.player?.name || "Cầu thủ"}: ${x?.player?.reason || "vắng/đau"}`)
    .slice(0, 6);

  const awayInj = injRows
    .filter(x => textHasTeam(x?.team?.name || "", awayName))
    .map(x => `${x?.player?.name || "Cầu thủ"}: ${x?.player?.reason || "vắng/đau"}`)
    .slice(0, 6);

  const homeLine = lineRows.find(x => textHasTeam(x?.team?.name || "", homeName));
  const awayLine = lineRows.find(x => textHasTeam(x?.team?.name || "", awayName));

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
}

async function safeFootballStructured(home, away, date = "") {
  try {
    return await footballStructured(home, away, date);
  } catch {
    return null;
  }
}

/* =========================
   LINEUP WEB FALLBACK
========================= */

function looksLikeRealLineup(chunk = "") {
  const text = clean(chunk);
  if (!text || text.length < 80) return false;

  const commaCount = (text.match(/,/g) || []).length;
  const semicolonCount = (text.match(/;/g) || []).length;
  const hasFormation = /\b[3-5]-[2-5]-[1-4]\b/.test(text);

  const hasPositionWords = containsAny(text, [
    "gk", "goalkeeper", "defenders", "midfielders", "forwards",
    "df:", "mf:", "fw:", "thủ môn", "thu mon", "hậu vệ", "hau ve",
    "tiền vệ", "tien ve", "tiền đạo", "tien dao"
  ]);

  const nameMatches = text.match(/\b[A-Z][a-z'’-]{2,}\s+[A-Z][a-z'’-]{2,}\b/g) || [];
  const nameCount = new Set(nameMatches).size;

  if (commaCount >= 5 && nameCount >= 4) return true;
  if (semicolonCount >= 4 && nameCount >= 4) return true;
  if (hasFormation && nameCount >= 5) return true;
  if (hasPositionWords && nameCount >= 5) return true;

  return false;
}

function cleanLineupChunk(chunk = "") {
  return clean(chunk)
    .replace(/Predicted Lineups\s*&\s*Starting XIs/gi, "")
    .replace(/Lineups\s*&\s*Injury News/gi, "")
    .replace(/RotoWire Soccer Lineups Widget/gi, "")
    .replace(/###/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function webLineupFallback(home, away, sourceText = "") {
  const text = clean(sourceText).slice(0, 30000);

  function findLineupForTeam(team) {
    const aliases = aliasSetFor(team).slice(0, 4);
    const lineupWords = [
      "predicted lineup",
      "expected lineup",
      "starting xi",
      "probable lineup",
      "lineup",
      "đội hình dự kiến",
      "doi hinh du kien",
      "đội hình ra sân",
      "doi hinh ra san"
    ];

    for (const a of aliases) {
      for (const w of lineupWords) {
        const idx1 = fold(text).indexOf(`${a}`);
        const idx2 = fold(text).indexOf(fold(w));

        if (idx1 >= 0 && idx2 >= 0 && Math.abs(idx1 - idx2) < 1800) {
          const start = Math.max(0, Math.min(idx1, idx2) - 200);
          const chunk = cleanLineupChunk(text.slice(start, start + 2200));

          if (looksLikeRealLineup(chunk)) return chunk;
        }
      }
    }

    return "";
  }

  function findInjuryForTeam(team) {
    const aliases = aliasSetFor(team).slice(0, 4);
    const injuryWords = [
      "injury", "injuries", "suspended", "suspension", "doubtful", "out injured",
      "chấn thương", "chan thuong", "treo giò", "treo gio", "vắng mặt", "vang mat"
    ];

    for (const a of aliases) {
      for (const w of injuryWords) {
        const idx1 = fold(text).indexOf(a);
        const idx2 = fold(text).indexOf(fold(w));

        if (idx1 >= 0 && idx2 >= 0 && Math.abs(idx1 - idx2) < 1800) {
          const start = Math.max(0, Math.min(idx1, idx2) - 200);
          const chunk = cleanLineupChunk(text.slice(start, start + 1800));

          if (chunk.length > 120) return chunk;
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

/* =========================
   CONTEXT SCORING FROM TEXT
========================= */

function scoreContextFromText(text = "") {
  let tempo = 0;
  let homeIssues = 0;
  let awayIssues = 0;

  if (containsAny(text, [
    "defensive", "low block", "cautious", "low scoring", "under", "tight game",
    "phòng ngự", "thận trọng", "ít bàn", "xỉu"
  ])) {
    tempo -= 1;
  }

  if (containsAny(text, [
    "attacking", "open game", "high scoring", "over", "pressing",
    "tấn công", "cởi mở", "nhiều bàn", "tài", "mưa bàn thắng"
  ])) {
    tempo += 1;
  }

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

/* =========================
   ROUTES
========================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Soi Kèo AI Research API V4.4 Source Split Voting",
    endpoint: "/api/research",
    tavily: Boolean(getTavilyKey()),
    apiFootball: Boolean(getFootballKey()),
    safeExpertConsensus: true,
    sourcePriorityGate: true,
    sourceSplitVoting: true,
    safePost: true,
    accepts: [
      "expertLinks",
      "superComputerLinks",
      "lineupContextLinks",
      "marketOddsLinks"
    ]
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
    const lineupContextLinks = Array.isArray(req.body.lineupContextLinks) ? req.body.lineupContextLinks : [];
    const marketOddsLinks = Array.isArray(req.body.marketOddsLinks) ? req.body.marketOddsLinks : [];

    const allManualInputs = [
      ...expertLinks,
      ...superComputerLinks,
      ...lineupContextLinks,
      ...marketOddsLinks
    ].map(clean).filter(Boolean);

    const manualMode = allManualInputs.length > 0;
    const autoExpertEnabled = req.body.autoExpertSearch !== false;

    const teamNewsQuery =
      `${home} vs ${away} ${league} ${date} predicted lineups injuries suspensions team news preview tactical style`;

    const [
      webInfo,
      structured,
      autoConsensus,
      manualExpertSources,
      manualSuperSources,
      contextSources,
      marketSources
    ] = await Promise.all([
      safeTavilySearch(teamNewsQuery, 6),
      safeFootballStructured(home, away, date),
      autoExpertEnabled
        ? safeAutoExpertSearch(home, away, league, date, manualMode)
        : Promise.resolve({
            ...buildConsensus([], home, away),
            status: "off",
            summary: "Tự tìm chuyên gia đang tắt.",
            sources: [],
            votingSources: [],
            rawAnswer: ""
          }),
      safeParseManualInputs(expertLinks, "expert_manual", home, away),
      safeParseManualInputs(superComputerLinks, "supercomputer_manual", home, away),
      safeReadTypedLinks(lineupContextLinks, "context", home, away),
      safeReadTypedLinks(marketOddsLinks, "market", home, away)
    ]);

    const manualSources = [
      ...(manualExpertSources || []),
      ...(manualSuperSources || [])
    ];

    const combinedSources = [
      ...manualSources,
      ...(autoConsensus.sources || [])
    ];

    const combinedConsensus = buildConsensus(combinedSources, home, away);

    combinedConsensus.rawAnswer = autoConsensus.rawAnswer || "";
    combinedConsensus.whitelist = PREFERRED_DOMAINS;
    combinedConsensus.methodologySource = "Source Split Voting V4.4";
    combinedConsensus.manualSourceCount = manualSources.length;
    combinedConsensus.autoExpertEnabled = autoExpertEnabled;
    combinedConsensus.manualMode = manualMode;

    const contextImpact = buildContextImpact(contextSources || [], home, away);
    const marketImpact = buildMarketImpact(marketSources || [], home, away);

    const sourceText = [
      webInfo.answer,
      ...(webInfo.results || []).map(r => `${r.title}. ${r.snippet}`),
      combinedConsensus.summary,
      contextImpact.summary,
      marketImpact.summary,
      ...(combinedConsensus.sources || []).map(s => `${s.title}. ${s.snippet || s.note || ""}`),
      ...(contextImpact.sources || []).map(s => `${s.title}. ${s.snippet || ""}`),
      ...(marketImpact.sources || []).map(s => `${s.title}. ${s.snippet || ""}`),
      ...(contextSources || []).map(s => `${s.title}. ${s.text || ""}`),
      ...(marketSources || []).map(s => `${s.title}. ${s.text || ""}`)
    ].join(" ");

    const webFallback = webLineupFallback(home, away, sourceText);
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
      combinedConsensus.summary || "",
      contextImpact.summary || "",
      marketImpact.summary || ""
    ].filter(Boolean).join(" ");

    const flags = {
      lowBlock:
        combinedConsensus.ouLean === "under" ||
        contextImpact.score.under > contextImpact.score.over ||
        containsAny(sourceText, ["low block", "defensive", "tight game", "xỉu", "ít bàn"]),

      earlyGoalRisk:
        combinedConsensus.ouLean === "over" ||
        contextImpact.score.over > contextImpact.score.under ||
        marketImpact.score.over > marketImpact.score.under ||
        containsAny(sourceText, ["open game", "attacking", "high scoring", "tài", "nhiều bàn", "mưa bàn thắng"]),

      rotation:
        containsAny(sourceText, ["rotation", "rotate", "xoay tua", "rest players", "giữ chân", "dưỡng sức"]),

      homeMotivation:
        containsAny(sourceText, [`${home} need win`, `${home} must win`, "home motivation", "đội nhà cần thắng"]),

      awayMotivation:
        containsAny(sourceText, [`${away} need win`, `${away} must win`, "away motivation", "đội khách cần thắng"])
    };

    res.json({
      apiVersion: "V4.4 Source Split Voting",
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
        safeMode: true,
        sourcePriorityGate: true,
        sourceSplitVoting: true,
        safePost: true
      },
      contextImpact,
      marketImpact,
      sources: [
        ...(webInfo.results || []),
        ...((combinedConsensus.sources || []).filter(s => s.url && !String(s.url).startsWith("tavily://"))),
        ...(contextImpact.sources || []),
        ...(marketImpact.sources || [])
      ].slice(0, 18)
    });
  } catch (err) {
    res.status(200).json({
      apiVersion: "V4.4 Source Split Voting",
      summary: "API gặp lỗi nội bộ nhưng đã trả fallback an toàn, app không bị sập.",
      homeAdvantage: 1,
      tempo: 0,
      homeIssues: 0,
      awayIssues: 0,
      injuriesHome: "API lỗi, chưa có dữ liệu chấn thương.",
      injuriesAway: "API lỗi, chưa có dữ liệu chấn thương.",
      lineupHome: "API lỗi, chưa có đội hình.",
      lineupAway: "API lỗi, chưa có đội hình.",
      styleHome: "Fallback an toàn.",
      styleAway: "Fallback an toàn.",
      flags: {},
      expertConsensus: {
        status: "server_safe_fallback",
        safeMode: true,
        sourcePriorityGate: true,
        sourceSplitVoting: true,
        safePost: true,
        sourceCount: 0,
        readSourceCount: 0,
        weakIgnored: 0,
        hardRejected: 0,
        winnerLean: "neutral",
        hdcLean: "neutral",
        ouLean: "neutral",
        confidence: 0,
        commonScores: [],
        summary: `Server fallback an toàn: ${err.message || "unknown error"}`,
        sources: [],
        votingSources: []
      },
      contextImpact: emptyImpact(),
      marketImpact: emptyImpact(),
      sources: []
    });
  }
});

app.listen(PORT, () => {
  console.log(`Soi Kèo AI Research API V4.4 chạy tại http://localhost:${PORT}`);
});
