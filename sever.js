import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

function cleanText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function hasAny(text, words) {
  const t = text.toLowerCase();
  return words.some(w => t.includes(w));
}

function readContextFromSearch(text) {
  let tempo = 0;
  let homeIssues = 0;
  let awayIssues = 0;

  if (hasAny(text, [
    "injury", "injured", "suspended", "doubtful",
    "chấn thương", "vắng mặt", "treo giò"
  ])) {
    homeIssues += 0.25;
    awayIssues += 0.25;
  }

  if (hasAny(text, [
    "defensive", "low block", "cautious", "tight game",
    "under", "low scoring", "phòng ngự", "thận trọng", "ít bàn"
  ])) {
    tempo -= 1;
  }

  if (hasAny(text, [
    "attacking", "open game", "high scoring", "pressing",
    "over", "tấn công", "cởi mở", "nhiều bàn"
  ])) {
    tempo += 1;
  }

  return { tempo, homeIssues, awayIssues };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Soi Kèo AI Research API",
    endpoint: "/api/research"
  });
});

app.post("/api/research", async (req, res) => {
  try {
    if (!TAVILY_API_KEY) {
      return res.status(500).json({
        error: "Thiếu TAVILY_API_KEY trong Environment Variables"
      });
    }

    const home = cleanText(req.body.home);
    const away = cleanText(req.body.away);
    const league = cleanText(req.body.league);
    const date = cleanText(req.body.date);

    if (!home || !away) {
      return res.status(400).json({
        error: "Thiếu tên đội nhà hoặc đội khách"
      });
    }

    const query = `
      ${home} vs ${away} ${league} ${date}
      predicted lineups injuries suspensions team news preview tactical style
    `;

    const tavilyRes = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query,
        search_depth: "advanced",
        include_answer: true,
        max_results: 6
      })
    });

    if (!tavilyRes.ok) {
      const txt = await tavilyRes.text();
      return res.status(500).json({
        error: "Tavily API lỗi",
        detail: txt
      });
    }

    const data = await tavilyRes.json();

    const results = (data.results || []).map(r => ({
      title: r.title || r.url,
      url: r.url,
      snippet: r.content || ""
    }));

    const fullText = [
      data.answer || "",
      ...results.map(r => `${r.title}. ${r.snippet}`)
    ].join(" ");

    const auto = readContextFromSearch(fullText);

    res.json({
      summary:
        data.answer ||
        `Đã tìm thông tin team news cho ${home} vs ${away}. Hãy mở nguồn để kiểm tra lại trước khi chốt.`,

      homeAdvantage: 1,
      tempo: auto.tempo,
      homeIssues: auto.homeIssues,
      awayIssues: auto.awayIssues,

      injuriesHome:
        "API đã tìm nguồn liên quan. Hãy mở link sources để kiểm tra chấn thương/treo giò đội nhà.",
      injuriesAway:
        "API đã tìm nguồn liên quan. Hãy mở link sources để kiểm tra chấn thương/treo giò đội khách.",

      lineupHome:
        "API đã tìm team news/lineups. Mở sources để xem đội hình dự kiến đội nhà.",
      lineupAway:
        "API đã tìm team news/lineups. Mở sources để xem đội hình dự kiến đội khách.",

      styleHome:
        "App tổng hợp từ team news + odds/line bạn nhập.",
      styleAway:
        "App tổng hợp từ team news + odds/line bạn nhập.",

      sources: results
    });

  } catch (err) {
    res.status(500).json({
      error: "Server lỗi",
      message: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Soi Kèo AI API chạy tại port ${PORT}`);
});
