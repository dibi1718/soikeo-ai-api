// server.js - Soi Kèo AI Research API V4.3 Source Priority Gate
// Node.js 18+
// package.json cần có: express, cors, dotenv và "type": "module"

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

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

function isUrl(s = "") {
  return /^https?:\/\//i.test(clean(s));
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
    if (String(url).startsWith("manual-title://")) return "manual-title";
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

/* =======================
   TEAM ALIASES
======================= */

const TEAM_ALIAS_GROUPS = [
  ["netherlands", "holland", "dutch", "ha lan", "hà lan", "loc da cam", "lốc da cam"],
  ["sweden", "thuy dien", "thụy điển", "thuỵ điển", "thuy dien"],
  ["poland", "ba lan"],
  ["northern ireland", "bac ireland", "bắc ireland"],
  ["germany", "duc", "đức"],
  ["usa", "united states", "united states of america", "my", "mỹ", "hoa ky", "hoa kỳ"],
  ["turkey", "turkiye", "türkiye", "tho nhi ky", "thổ nhĩ kỳ"],
  ["bosnia", "bosnia and herzegovina", "bosnia herzegovina"],
  ["ivory coast", "cote d ivoire", "côte d’ivoire", "bo bien nga", "bờ biển ngà"],
  ["czech republic", "czechia", "sec", "séc"],
  ["south korea", "korea republic", "han quoc", "hàn quốc"],
  ["north korea", "trieu tien", "triều tiên"],
  ["japan", "nhat ban", "nhật bản"],
  ["china", "trung quoc", "trung quốc"],
  ["brazil", "brasil", "braxin"],
  ["argentina", "argentine", "ac hen ti na", "ác hen ti na"],
  ["spain", "tay ban nha", "tây ban nha"],
  ["france", "phap", "pháp"],
  ["italy", "italia", "y", "ý"],
  ["england", "anh", "tam su", "tam sư"],
  ["portugal", "bo dao nha", "bồ đào nha"],
  ["belgium", "bi", "bỉ"],
  ["croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia"],
  ["croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia", "croatia"],
  ["croatia", "hrvatska", "croatia", "croatia", "croatia", "croatia"],
  ["morocco", "ma roc", "ma rốc"],
  ["mexico", "mexico", "me xi co", "mê xi cô"],
  ["canada", "canada", "ca na da"],
  ["paraguay", "paraguay"],
  ["uruguay", "uruguay"],
  ["colombia", "colombia"],
  ["chile", "chile"],
  ["ecuador", "ecuador"],
  ["peru", "peru"],
  ["australia", "uc", "úc"],
  ["new zealand", "new zealand", "tan tay lan", "tân tây lan"],
  ["switzerland", "thuy si", "thụy sĩ", "thuỵ sĩ"],
  ["austria", "ao", "áo"],
  ["norway", "na uy"],
  ["denmark", "dan mach", "đan mạch"],
  ["finland", "phan lan", "phần lan"],
  ["scotland", "scotland", "to cach lan", "tô cách lan"],
  ["wales", "wales", "xu wales"],
  ["ireland", "republic of ireland", "ireland", "ai len", "ái len"],
  ["romania", "romania", "rumani"],
  ["serbia", "serbia"],
  ["slovakia", "slovakia"],
  ["slovenia", "slovenia"],
  ["ukraine", "ukraine"],
  ["russia", "nga"],
  ["greece", "hy lap", "hy lạp"],
  ["egypt", "ai cap", "ai cập"],
  ["senegal", "senegal"],
  ["ghana", "ghana"],
  ["nigeria", "nigeria"],
  ["cameroon", "cameroon"],
  ["algeria", "algeria"],
  ["tunisia", "tunisia"],
  ["qatar", "qatar"],
  ["saudi arabia", "saudi", "arab saudi", "ả rập xê út"],
  ["iran", "iran"],
  ["iraq", "iraq"],
  ["uae", "united arab emirates", "cac tieu vuong quoc a rap thong nhat"],
  ["thailand", "thai lan", "thái lan"],
  ["vietnam", "viet nam", "việt nam"],
  ["indonesia", "indonesia"],
  ["malaysia", "malaysia"],
  ["singapore", "singapore"],
  ["philippines", "philippines"],
  ["haiti", "haiti"],
  ["jamaica", "jamaica"],
  ["panama", "panama"],
  ["costa rica", "costa rica"]
];

function aliasSetFor(name = "") {
  const n = normalizeTeamName(name);
  const set = new Set();

  if (n) set.add(n);

  const tokens = n.split(" ").filter(x => x.length >= 3);
  for (const tok of tokens) set.add(tok);

  for (const group of TEAM_ALIAS_GROUPS) {
    const folded = group.map(x => normalizeTeamName(x));
    if (folded.includes(n) || folded.some(x => x && n.includes(x)) || folded.some(x => x && x.includes(n))) {
      for (const a of folded) if (a) set.add(a);
    }
  }

  return [...set].filter(x => x.length >= 2);
}

function textHasTeam(text = "", team = "") {
  const t = normalizeTeamName(text);
  const aliases = aliasSetFor(team);

  for (const a of aliases) {
    if (!a) continue;
    if (a.length <= 2) {
      const re = new RegExp(`\\b${escapeRegExp(a)}\\b`, "i");
      if (re.test(t)) return true;
    } else if (t.includes(a)) {
      return true;
    }
  }

  return false;
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

/* =======================
   TRUSTED DOMAINS
======================= */

const DOMAIN_PROFILE = {
  "bongdaplus.vn": { type: "expert_main", priority: 1.25, label: "Bongdaplus" },
  "bongda24h.vn": { type: "expert_main", priority: 1.24, label: "Bongda24h" },
  "thethao247.vn": { type: "expert_main", priority: 1.2, label: "Thể Thao 247" },
  "kqbd.mobi": { type: "expert_secondary", priority: 1.08, label: "KQBD.mobi" },
  "bongdanet.online": { type: "expert_secondary", priority: 1.0, label: "Bongdanet" },
  "adidas-fifa.com": { type: "method_secondary", priority: 0.78, label: "Adidas-Fifa" }
};

const PREFERRED_DOMAINS = Object.keys(DOMAIN_PROFILE);

function domainPriority(url = "") {
  const d = domainOf(url);
  return DOMAIN_PROFILE[d]?.priority || 0.62;
}

function isTrustedDomain(url = "") {
  return Boolean(DOMAIN_PROFILE[domainOf(url)]);
}

function isKnownCategoryUrl(url = "") {
  const u = fold(url);

  return (
    u.includes("nhan-dinh-bong-da-tags") ||
    u.includes("nhan-dinh-bong-da-c344") ||
    u.includes("nhan-dinh-bong-da-c288") ||
    (u.includes("/nhan-dinh-bong-da") && !/\d{4}|vs|\.html/.test(u)) ||
    (u.includes("/soi-keo-bong-da/") && !/\d{4}|vs|\.html/.test(u)) ||
    (u.includes("/du-doan-bong-da") && !/\d{4}|vs|\.html/.test(u)) ||
    (u.includes("/sieu-may-tinh-du-doan-bong-da") && !/\d{4}|vs|\.html/.test(u))
  );
}

function isSuperComputerUrl(url = "", text = "") {
  const u = fold(`${url} ${text}`);

  return (
    u.includes("du-doan-bong-da") ||
    u.includes("sieu-may-tinh") ||
    u.includes("supercomputer") ||
    u.includes("probability") ||
    u.includes("xác suất") ||
    u.includes("xac suat")
  );
}

/* =======================
   DETECTION
======================= */

function detectScore(text = "") {
  const t = clean(text);

  const patterns = [
    /(?:prediction|score|scoreline|correct score|tỷ số|ti so|dự đoán|du doan|kết quả|ket qua)[^\d]{0,60}(\d{1,2})\s*[-:]\s*(\d{1,2})/i,
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
    containsAny(t, [
      "xác suất",
      "xac suat",
      "probability",
      "chance",
      "win probability",
      "tỷ lệ thắng",
      "ti le thang"
    ])
  );
}

function detectOU(text = "") {
  const t = fold(text);

  let over = 0;
  let under = 0;

  const overWords = [
    "over", "over 1.5", "over 2.5", "over 3.5",
    "tai", "tài", "mưa bàn thắng", "mua ban thang", "nhiều bàn", "nhieu ban",
    "high scoring", "goals expected", "open game", "attacking game",
    "both teams to score", "btts"
  ];

  const underWords = [
    "under", "under 1.5", "under 2.5", "under 3.5",
    "xiu", "xỉu", "it ban", "ít bàn",
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

  let hs = 0;
  let as = 0;
  let ds = 0;

  const score = detectScore(text);
  const scoreLean = scoreToLean(score);

  if (scoreLean === "home") hs += 2;
  if (scoreLean === "away") as += 2;
  if (scoreLean === "draw") ds += 2;

  const homeAliases = aliasSetFor(home);
  const awayAliases = aliasSetFor(away);

  for (const h of homeAliases) {
    if (!h) continue;
    if (t.includes(`${h} thang`) || t.includes(`${h} thắng`) || t.includes(`${h} win`) || t.includes(`${h} to win`) || t.includes(`${h} victory`)) {
      hs += 3;
    }
  }

  for (const a of awayAliases) {
    if (!a) continue;
    if (t.includes(`${a} thang`) || t.includes(`${a} thắng`) || t.includes(`${a} win`) || t.includes(`${a} to win`) || t.includes(`${a} victory`)) {
      as += 3;
    }
  }

  if (containsAny(t, ["draw", "hòa", "hoa", "stalemate", "chia điểm", "chia diem"])) ds += 2;
  if (containsAny(t, ["chủ nhà khó thắng", "chu nha kho thang"])) as += 1;
  if (containsAny(t, ["khách khó thắng", "khach kho thang"])) hs += 1;

  if (textHasTeam(t, home) && containsAny(t, ["favorite", "favourite", "được đánh giá cao", "duoc danh gia cao", "cửa trên", "cua tren"])) hs += 1;
  if (textHasTeam(t, away) && containsAny(t, ["favorite", "favourite", "được đánh giá cao", "duoc danh gia cao", "cửa trên", "cua tren"])) as += 1;

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
    homeHdc += 0.25;
    awayHdc += 0.25;
  }

  if (containsAny(t, ["handicap home", "home handicap", "chủ nhà", "chu nha", "cửa trên", "cua tren", "chấp"])) {
    if (textHasTeam(t, home)) homeHdc += 1;
    if (textHasTeam(t, away)) awayHdc += 1;
  }

  if (containsAny(t, ["handicap away", "away handicap", "đội khách", "doi khach"])) {
    if (textHasTeam(t, away)) awayHdc += 1;
  }

  if (containsAny(t, ["cover the spread", "cover handicap", "thắng kèo", "thang keo", "ăn kèo", "an keo"])) {
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
    isSuperComputerUrl(url, text) ||
    containsAny(blob, [
      "supercomputer",
      "sieu may tinh",
      "siêu máy tính",
      "probability",
      "xác suất",
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
   SOURCE QUALITY V4.3
======================= */

function qualitySource({ title = "", url = "", text = "", manualPriority = false, fromManualTitle = false }, home = "", away = "") {
  const domain = domainOf(url);
  const titleBlob = `${title} ${url}`;
  const all = `${title}. ${url}. ${text}`;

  const titleBoth = textHasBothTeams(title, home, away);
  const urlBoth = textHasBothTeams(url, home, away);
  const textBoth = textHasBothTeams(all, home, away);

  const matchOk = titleBoth || urlBoth || textBoth;
  const trusted = isTrustedDomain(url);
  const isCategory = isKnownCategoryUrl(url) && !titleBoth && !urlBoth;
  const type = detectSourceType(url, all);

  const titleMismatch = opponentMismatchInTitle(title, home, away);
  const urlMismatch = opponentMismatchInTitle(url, home, away);
  const hardReject = titleMismatch || urlMismatch;

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

  if (hardReject) {
    q = 0;
    flags.push("sai cặp trong title/url, loại vote");
  } else {
    if (matchOk) {
      q += 20;
      flags.push("đúng 2 đội");
    } else {
      flags.push("không xác minh đủ 2 đội");
    }

    if (titleBoth) {
      q += 28;
      flags.push("title đúng trận");
    }

    if (urlBoth) {
      q += 16;
      flags.push("url đúng trận");
    }

    if (trusted) {
      q += 10;
      flags.push(`domain ưu tiên: ${DOMAIN_PROFILE[domain]?.label || domain}`);
    }

    if (manualPriority) {
      q += 16;
      flags.push("nguồn thủ công ưu tiên");
    }

    if (fromManualTitle) {
      q += 6;
      flags.push("tìm từ tiêu đề bạn dán");
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
      q -= 30;
      flags.push("trang chuyên mục, giảm mạnh");
    }

    if (domain === "tavily") {
      q -= 24;
      flags.push("tóm tắt Tavily, không phải bài gốc");
    }

    if (!matchOk) q = Math.min(q, 18);

    const contentSignals = [hasScoreText, hasProb, hasOuText, hasHdcText, hasWinnerText].filter(Boolean).length;

    if (contentSignals === 0) {
      q = Math.min(q, manualPriority ? 48 : 34);
      flags.push("không có tín hiệu kèo rõ");
    }
  }

  q = clamp(q, 0, 100);

  let qualityLabel = "rejected";
  if (q >= 72) qualityLabel = "strong";
  else if (q >= 55) qualityLabel = "medium";
  else if (q >= 40) qualityLabel = "weak";

  const voteAllowed =
    !hardReject &&
    matchOk &&
    q >= 50 &&
    !isCategory;

  const priority = domainPriority(url) * (manualPriority ? 1.18 : 1);
  const confidence = clamp(0.22 + q / 145, 0.22, 0.84);
  const voteWeight = voteAllowed ? confidence * (q / 100) * priority : 0;

  const displayEligible =
    !hardReject &&
    (voteAllowed || q >= 40 || manualPriority);

  return {
    domain,
    trusted,
    type,
    matchOk,
    titleBoth,
    urlBoth,
    isCategory,
    hardReject,
    titleMismatch,
    urlMismatch,
    quality: q,
    qualityLabel,
    voteAllowed,
    voteWeight,
    displayEligible,
    flags,
    score,
    hasProb,
    hasOuText,
    hasHdcText,
    hasWinnerText
  };
}

function parseExpertSource({ title = "", url = "", text = "", type = "auto", manualPriority = false, fromManualTitle = false }, home, away) {
  const blob = clean(`${title}. ${text}`);
  const q = qualitySource({ title, url, text: blob, manualPriority, fromManualTitle }, home, away);

  const winnerLean = q.voteAllowed ? detectWinner(blob, home, away) : "neutral";
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
    note: note.join(" · ") || "Nguồn có liên quan nhưng chưa đủ chuẩn để vote mạnh.",
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

function sortSourcesForDisplay(all = []) {
  return [...all]
    .filter(s => s && s.displayEligible)
    .sort((a, b) => {
      const aScore =
        (a.manualPriority ? 1000 : 0) +
        (a.voteAllowed ? 500 : 0) +
        (a.quality || 0);

      const bScore =
        (b.manualPriority ? 1000 : 0) +
        (b.voteAllowed ? 500 : 0) +
        (b.quality || 0);

      return bScore - aScore;
    })
    .slice(0, 14);
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

  const hasRealKèo = voting.some(s => s.hdcLean !== "neutral" || s.ouLean !== "neutral");
  const hasScoreOrProb = voting.some(s => s.score || s.hasProbability);

  let appConfidence = 0;

  if (manualVoting >= 2 && voting.length >= 3 && strongCount >= 2 && avgAgreement >= 0.68 && hasRealKèo) {
    appConfidence = 0.66;
  } else if (voting.length >= 5 && strongCount >= 3 && avgAgreement >= 0.70 && hasRealKèo) {
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

  appConfidence = clamp(appConfidence, 0, 0.68);

  const hardRejected = all.filter(s => s.hardReject).length;
  const weakIgnored = all.filter(s => !s.voteAllowed).length;
  const displaySources = sortSourcesForDisplay(all);

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

  if (scores.length) {
    summaryParts.push(`tỷ số hay gặp: ${scores.join(", ")}`);
  }

  return {
    status: voting.length ? "ok" : "weak_or_no_sources",
    safeMode: true,
    sourcePriorityGate: true,
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
    summary: `Source Priority Gate V4.3: ${summaryParts.join("; ")}. ${hardRejected ? `Đã loại ${hardRejected} nguồn sai cặp.` : ""} ${weakIgnored ? `Bỏ qua ${weakIgnored} nguồn yếu/trang chuyên mục.` : ""}`.trim(),
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

/* =======================
   TAVILY / FETCH
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
        .replace(/&quot;/g, '"')
    ).slice(0, 16000);
  } catch {
    return "";
  }
}

/* =======================
   EXPERT SEARCH V4.3
======================= */

async function autoExpertSearch(home, away, league, date, manualMode = false) {
  const preferredQueries = [
    ...PREFERRED_DOMAINS.map(site => `site:${site} ${home} ${away} nhận định soi kèo dự đoán tỷ số tài xỉu handicap`),
    `site:kqbd.mobi/du-doan-bong-da ${home} ${away} dự đoán bóng đá xác suất tỷ số`,
    `site:bongdanet.online/sieu-may-tinh-du-doan-bong-da ${home} ${away} siêu máy tính dự đoán bóng đá`
  ];

  const openQueries = [
    `${home} vs ${away} ${league} ${date} prediction preview betting tips correct score over under handicap`,
    `${home} vs ${away} supercomputer prediction probability score`
  ];

  const queries = manualMode
    ? preferredQueries
    : [...preferredQueries, ...openQueries];

  const packs = await Promise.allSettled(
    queries.map(q => tavilySearch(q, manualMode ? 4 : 5))
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
      if (isSuperComputerUrl(r.url, blob)) boost += 0.8;
      if (containsAny(blob, ["soi kèo", "soi keo", "nhận định", "nhan dinh", "prediction", "preview"])) boost += 0.7;
      if (isKnownCategoryUrl(r.url)) boost -= 1.2;

      return { ...r, localBoost: boost };
    })
    .filter(r => r.localBoost > -50)
    .filter(r => manualMode ? isTrustedDomain(r.url) : true)
    .sort((a, b) => (b.localBoost + clamp(b.score, 0, 99)) - (a.localBoost + clamp(a.score, 0, 99)))
    .slice(0, manualMode ? 8 : 12);

  const pageTexts = await Promise.all(
    deduped.map(r => fetchPageText(r.url))
  );

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
    methodologySource: "Source Priority Gate V4.3",
    rawAnswer: answers.join(" ").slice(0, 1500)
  };
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
      const searchQuery = `"${q}" ${home} ${away}`;
      const pack = await tavilySearch(searchQuery, 3);
      const results = uniqByUrl(pack.results || [])
        .filter(r => !opponentMismatchInTitle(r.title, home, away))
        .slice(0, 2);

      const pageTexts = await Promise.all(results.map(r => fetchPageText(r.url)));

      const parsed = results.map((r, i) => parseExpertSource({
        title: r.title || q,
        url: r.url,
        text: pageTexts[i] || r.snippet || q,
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
  return clean(chunk)
    .replace(/Predicted Lineups\s*&\s*Starting XIs/gi, "")
    .replace(/Lineups\s*&\s*Injury News/gi, "")
    .replace(/RotoWire Soccer Lineups Widget/gi, "")
    .replace(/###/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
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

function teamSearchCandidates(name = "") {
  const aliases = aliasSetFor(name);
  const raw = clean(name);

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
  if (!process.env.API_FOOTBALL_KEY) return null;

  try {
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

  if (containsAny(text, ["attacking", "open game", "high scoring", "over", "pressing", "tấn công", "cởi mở", "nhiều bàn", "tài", "mưa bàn thắng"])) {
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
    name: "Soi Kèo AI Research API V4.3 Source Priority Gate",
    endpoint: "/api/research",
    tavily: Boolean(process.env.TAVILY_API_KEY),
    apiFootball: Boolean(process.env.API_FOOTBALL_KEY),
    safeExpertConsensus: true,
    sourcePriorityGate: true
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
    const manualInputs = [...expertLinks, ...superComputerLinks].map(clean).filter(Boolean);
    const manualMode = manualInputs.length > 0;

    const autoExpertEnabled = req.body.autoExpertSearch !== false;

    const teamNewsQuery = `${home} vs ${away} ${league} ${date} predicted lineups injuries suspensions team news preview tactical style`;

    const jobs = [
      tavilySearch(teamNewsQuery, 6),
      footballStructured(home, away, date)
    ];

    if (autoExpertEnabled) {
      jobs.push(autoExpertSearch(home, away, league, date, manualMode));
    } else {
      jobs.push(Promise.resolve({
        status: "off",
        sourceCount: 0,
        readSourceCount: 0,
        weakIgnored: 0,
        hardRejected: 0,
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

    jobs.push(parseManualInputs(expertLinks, "expert_manual", home, away));
    jobs.push(parseManualInputs(superComputerLinks, "supercomputer_manual", home, away));

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

    const combinedSources = [
      ...manualSources,
      ...(autoConsensus.sources || [])
    ];

    const combinedConsensus = buildConsensus(combinedSources, home, away);

    combinedConsensus.rawAnswer = autoConsensus.rawAnswer || "";
    combinedConsensus.whitelist = PREFERRED_DOMAINS;
    combinedConsensus.methodologySource = "Source Priority Gate V4.3";
    combinedConsensus.manualSourceCount = manualSources.length;
    combinedConsensus.autoExpertEnabled = autoExpertEnabled;
    combinedConsensus.manualMode = manualMode;

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
        containsAny(sourceText, ["open game", "attacking", "high scoring", "tài", "nhiều bàn", "mưa bàn thắng"]),

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
        safeMode: true,
        sourcePriorityGate: true
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
  console.log(`Soi Kèo AI Research API V4.3 chạy tại http://localhost:${PORT}`);
});
