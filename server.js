const express = require("express");
const cors = require("cors");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "2mb" }));

function todayBR() {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return "";
  return url.trim();
}

function guessNiche(text = "") {
  const t = text.toLowerCase();
  const rules = [
    ["emagrecimento", ["emagrecer", "peso", "gordura", "dieta", "shape"]],
    ["educação infantil", ["criança", "infantil", "professor", "pedagógico", "atividades"]],
    ["finanças", ["dinheiro", "renda", "investimento", "pix", "cartão", "crédito"]],
    ["relacionamento", ["casamento", "relacionamento", "ex", "conquistar"]],
    ["saúde", ["saúde", "dor", "tratamento", "natural", "suplemento"]],
    ["marketing digital", ["tráfego", "anúncio", "copy", "vendas", "marketing"]]
  ];
  for (const [niche, words] of rules) {
    if (words.some(w => t.includes(w))) return niche;
  }
  return "não identificado";
}

async function launchBrowser() {
  return puppeteer.launch({
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1365,768"
    ],
    defaultViewport: { width: 1365, height: 768 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  });
}

async function analyzeFacebookAdsLibrary(url) {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
  );

  await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
  await new Promise(resolve => setTimeout(resolve, 6000));

  const data = await page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const links = Array.from(document.querySelectorAll("a")).map(a => a.href).filter(Boolean);

    const externalLinks = links.filter(h =>
      !h.includes("facebook.com") &&
      !h.includes("fbcdn.net") &&
      !h.includes("instagram.com") &&
      /^https?:\/\//.test(h)
    );

    const title = document.title || "";

    const activeMatch =
      bodyText.match(/([\d.,]+)\s+(resultados|anúncios|ads|results)/i) ||
      bodyText.match(/([\d.,]+)\s+(active ads|anúncios ativos)/i);

    const dateMatches = Array.from(
      bodyText.matchAll(/(\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/g)
    ).map(m => m[1]);

    let pageName = "";
    const lines = bodyText.split("\n").map(x => x.trim()).filter(Boolean);
    const pageIdx = lines.findIndex(l =>
      l.toLowerCase().includes("facebook page") ||
      l.toLowerCase().includes("página do facebook") ||
      l.toLowerCase().includes("page transparency")
    );

    if (pageIdx > 0) pageName = lines[Math.max(0, pageIdx - 1)];

    return {
      title,
      textSample: bodyText.slice(0, 3000),
      activeRaw: activeMatch ? activeMatch[1] : "",
      dates: dateMatches.slice(0, 30),
      externalLinks: [...new Set(externalLinks)].slice(0, 20),
      pageName
    };
  });

  await browser.close();

  const textForNiche = `${data.title} ${data.textSample}`;
  const activeAds = data.activeRaw ? parseInt(data.activeRaw.replace(/[^\d]/g, ""), 10) : null;

  return {
    ok: true,
    source: "facebook_ads_library",
    analyzedAt: new Date().toISOString(),
    foundDate: todayBR(),
    url,
    pageName: data.pageName || "Não identificado automaticamente",
    niche: guessNiche(textForNiche),
    activeAds,
    oldestAdDate: data.dates.length ? data.dates[data.dates.length - 1] : "Não identificado",
    newestAdDate: data.dates.length ? data.dates[0] : "Não identificado",
    salesPageCandidates: data.externalLinks,
    raw: {
      title: data.title,
      dates: data.dates,
      note: "A Biblioteca de Anúncios pode carregar dados por JavaScript, login, bloqueio ou captcha. Quando isso ocorrer, alguns campos podem vir como não identificados."
    }
  };
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "JP Radar Robô",
    version: "2.0.0",
    endpoints: ["/health", "/analyze", "/monitor"]
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "Robô online",
    date: new Date().toISOString()
  });
});

app.post("/analyze", async (req, res) => {
  try {
    const url = normalizeUrl(req.body.url);
    if (!url) return res.status(400).json({ ok: false, error: "Envie o campo url no JSON." });

    if (!url.includes("facebook.com/ads/library")) {
      return res.status(400).json({
        ok: false,
        error: "O link precisa ser da Biblioteca de Anúncios do Facebook."
      });
    }

    const result = await analyzeFacebookAdsLibrary(url);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Falha ao analisar o link.",
      detail: err.message
    });
  }
});

app.get("/analyze", async (req, res) => {
  try {
    const url = normalizeUrl(req.query.url);
    if (!url) return res.status(400).json({ ok: false, error: "Use /analyze?url=LINK" });

    const result = await analyzeFacebookAdsLibrary(url);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Falha ao analisar.",
      detail: err.message
    });
  }
});

app.get("/monitor", async (req, res) => {
  res.json({
    ok: true,
    message: "Endpoint de monitoramento ativo. Na próxima etapa conectamos banco de dados e lista de ofertas.",
    date: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`JP Radar Robô rodando na porta ${PORT}`);
});
