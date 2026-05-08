import express from "express";
import cors from "cors";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "10mb" }));

function todayBR() {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return "";
  return url.trim();
}

function forceActiveAdsUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.set("active_status", "active");
    u.searchParams.set("ad_type", u.searchParams.get("ad_type") || "all");
    u.searchParams.set("media_type", u.searchParams.get("media_type") || "all");
    return u.toString();
  } catch {
    return url;
  }
}

function guessNiche(text = "") {
  const t = text.toLowerCase();
  const rules = [
    ["educação infantil", ["criança", "infantil", "professor", "pedagógico", "atividades", "alfabetização", "maternal", "lúdico", "escola", "aluno"]],
    ["esporte / luta", ["jiu-jitsu", "jiu jitsu", "tatame", "faixa", "academia", "luta", "treino", "treinador"]],
    ["emagrecimento", ["emagrecer", "peso", "gordura", "dieta", "shape", "barriga", "seca", "metabolismo"]],
    ["finanças", ["dinheiro", "renda", "investimento", "pix", "cartão", "crédito", "empréstimo", "score"]],
    ["relacionamento", ["casamento", "relacionamento", "ex", "conquistar", "amor", "marido", "esposa"]],
    ["saúde", ["saúde", "dor", "tratamento", "natural", "suplemento", "médico", "colágeno", "diabetes"]],
    ["marketing digital", ["tráfego", "anúncio", "copy", "vendas", "marketing", "lançamento", "lead", "funil"]],
    ["beleza", ["beleza", "pele", "cabelo", "unha", "estética", "rugas", "make"]],
    ["pets", ["cachorro", "gato", "pet", "ração", "adestramento"]]
  ];
  for (const [niche, words] of rules) {
    if (words.some(w => t.includes(w))) return niche;
  }
  return "não identificado";
}

function parseDateScore(value) {
  if (!value) return 0;
  const v = String(value).toLowerCase();
  const months = { "janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3, "abril": 4, "maio": 5, "junho": 6, "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12 };
  let m = v.match(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
  if (m) return Number(m[3]) * 10000 + (months[m[2]] || 0) * 100 + Number(m[1]);
  m = v.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
  return 0;
}

function uniqueArray(items) {
  return [...new Set(items.filter(Boolean))];
}

function getDomain(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return ""; }
}

function classifyCreativeType(ad) {
  if ((ad.videos || []).length > 0) return "vídeo";
  if ((ad.images || []).length > 0) return "imagem";
  return "não identificado";
}

function getValidationStatus(activeCount, adsExtracted, oldestDate, newestDate, cleanAds = []) {
  let score = 0;
  const reasons = [];
  if (activeCount && activeCount >= 50) { score += 30; reasons.push("alto volume de resultados ativos"); }
  else if (activeCount && activeCount >= 15) { score += 20; reasons.push("volume moderado de resultados ativos"); }
  else if (activeCount && activeCount > 0) { score += 10; reasons.push("baixo volume inicial de resultados ativos"); }
  if (adsExtracted >= 10) { score += 25; reasons.push("robô conseguiu ler vários cards de anúncios"); }
  else if (adsExtracted >= 3) { score += 15; reasons.push("robô conseguiu ler alguns cards de anúncios"); }
  const withMedia = cleanAds.filter(a => (a.images || []).length || (a.videos || []).length).length;
  if (withMedia >= 5) { score += 15; reasons.push("vários anúncios possuem mídia/imagem/vídeo"); }
  else if (withMedia > 0) { score += 8; reasons.push("alguns anúncios possuem mídia/imagem/vídeo"); }
  if (oldestDate && oldestDate !== "Não identificado") { score += 20; reasons.push("existe sinal de anúncio antigo/continuidade"); }
  if (newestDate && newestDate !== "Não identificado") { score += 15; reasons.push("existe sinal de anúncio recente"); }
  if (score >= 75) return { score, status: "Oferta forte para monitorar", reasons };
  if (score >= 45) return { score, status: "Oferta promissora, precisa acompanhar", reasons };
  return { score, status: "Dados insuficientes, monitorar manualmente", reasons };
}

async function launchBrowser() {
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-web-security", "--window-size=1365,900"],
    defaultViewport: { width: 1365, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: true
  });
}

async function autoScroll(page, rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await new Promise(resolve => setTimeout(resolve, 1600));
  }
}

async function analyzeFacebookAdsLibrary(inputUrl) {
  const url = forceActiveAdsUrl(inputUrl);
  const browser = await launchBrowser();
  const page = await browser.newPage();

  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36");
  await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7" });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
  await new Promise(resolve => setTimeout(resolve, 15000));
  await autoScroll(page, 15);

  const data = await page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const title = document.title || "";

    const allLinks = Array.from(document.querySelectorAll("a")).map(a => a.href).filter(Boolean);
    const externalLinks = allLinks.filter(h => !h.includes("facebook.com") && !h.includes("fbcdn.net") && !h.includes("instagram.com") && !h.includes("whatsapp.com") && !h.includes("metastatus.com") && /^https?:\/\//.test(h));

    const activeMatches = [
      ...bodyText.matchAll(/~?\s*([\d.,]+)\s+(resultados|results)/gi),
      ...bodyText.matchAll(/([\d.,]+)\s+(anúncios ativos|active ads|ads)/gi)
    ];
    const activeRaw = activeMatches.length ? activeMatches[0][1] : "";

    const dateMatches = Array.from(bodyText.matchAll(/(\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/g)).map(m => m[1]);
    const lines = bodyText.split("\n").map(x => x.trim()).filter(Boolean);

    let pageName = "";
    const sponsoredIndex = lines.findIndex(l => l.toLowerCase() === "patrocinado" || l.toLowerCase() === "sponsored");
    if (sponsoredIndex > 0) pageName = lines[Math.max(0, sponsoredIndex - 1)];

    const cards = Array.from(document.querySelectorAll("div")).map((el, index) => {
      const text = el.innerText || "";
      if (!text) return null;
      const lower = text.toLowerCase();

      const looksLikeAd = lower.includes("patrocinado") && (
        lower.includes("identificação da biblioteca") ||
        lower.includes("veiculação iniciada") ||
        lower.includes("saiba mais") ||
        lower.includes("open in new tab")
      );

      if (!looksLikeAd) return null;
      if (text.length < 180 || text.length > 5000) return null;

      const links = Array.from(el.querySelectorAll("a")).map(a => a.href).filter(Boolean);
      const images = Array.from(el.querySelectorAll("img")).map(img => img.src).filter(Boolean);
      const videos = Array.from(el.querySelectorAll("video")).map(video => video.src || video.currentSrc).filter(Boolean);

      const libraryIdMatch = text.match(/Identificação da biblioteca:\s*([0-9]+)/i) || text.match(/Library ID[:\s]+([0-9]+)/i);
      const startedMatch = text.match(/Veiculação iniciada em\s*([^\n]+)/i) || text.match(/Started running on\s*([^\n]+)/i);
      const activeAdsMatch = text.match(/([0-9]+)\s+anúncios/i) || text.match(/([0-9]+)\s+ads/i);
      const ctaMatch = text.match(/\b(Saiba mais|Comprar agora|Inscrever-se|Baixar|Enviar mensagem|Learn more|Shop now|Sign up|Download)\b/i);

      const externalLinks = links.filter(h => !h.includes("facebook.com") && !h.includes("fbcdn.net") && !h.includes("instagram.com") && !h.includes("whatsapp.com") && !h.includes("metastatus.com") && /^https?:\/\//.test(h));

      const cardLines = text.split("\n").map(t => t.trim()).filter(Boolean);
      let advertiser = "";
      let copyPreview = "";
      const patrocinadoIndex = cardLines.findIndex(l => l.toLowerCase() === "patrocinado" || l.toLowerCase() === "sponsored");

      if (patrocinadoIndex > 0) advertiser = cardLines[patrocinadoIndex - 1] || "";

      const blockedWords = ["ativo", "save to storage", "shows: n/a", "open in new tab", "download media", "copy link", "identificação da biblioteca", "veiculação iniciada", "plataformas", "ver detalhes do anúncio", "ver resumo", "patrocinado"];
      const afterSponsored = cardLines.slice(Math.max(0, patrocinadoIndex + 1));
      const copyLines = afterSponsored.filter(line => {
        const l = line.toLowerCase();
        if (blockedWords.some(w => l.includes(w))) return false;
        if (/^\d+\s+anúncios/.test(l)) return false;
        if (/^https?:\/\//.test(l)) return false;
        if (line.length < 8) return false;
        return true;
      });
      copyPreview = copyLines.slice(0, 6).join(" ");

      return {
        position: index + 1,
        advertiser,
        libraryId: libraryIdMatch?.[1] || null,
        startedAt: startedMatch?.[1] || null,
        activeAds: activeAdsMatch?.[1] ? Number(activeAdsMatch[1]) : null,
        cta: ctaMatch?.[1] || null,
        copyPreview,
        images: [...new Set(images)].slice(0, 12),
        videos: [...new Set(videos)].slice(0, 6),
        externalLinks: [...new Set(externalLinks)].slice(0, 8),
        rawText: text.slice(0, 3000)
      };
    }).filter(Boolean);

    const dedup = [];
    const seen = new Set();
    for (const c of cards) {
      const key = c.libraryId || `${c.advertiser}-${c.copyPreview.slice(0, 120)}-${c.startedAt || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedup.push(c);
      }
      if (dedup.length >= 40) break;
    }

    return { title, textSample: bodyText.slice(0, 6000), activeRaw, dates: [...new Set(dateMatches)].slice(0, 80), externalLinks: [...new Set(externalLinks)].slice(0, 50), pageName, cards: dedup };
  });

  await browser.close();

  const activeCount = data.activeRaw ? parseInt(data.activeRaw.replace(/[^\d]/g, ""), 10) : null;

  const adCards = data.cards.map((c, index) => {
    const type = classifyCreativeType(c);
    const domains = uniqueArray((c.externalLinks || []).map(getDomain)).filter(Boolean);
    return {
      position: index + 1,
      advertiser: c.advertiser || data.pageName || null,
      libraryId: c.libraryId || null,
      startedAt: c.startedAt || null,
      activeAds: c.activeAds || null,
      cta: c.cta || null,
      creativeType: type,
      copyPreview: c.copyPreview || "",
      domains,
      landingPages: c.externalLinks || [],
      images: c.images || [],
      videos: c.videos || [],
      rawText: c.rawText || ""
    };
  });

  const textForNiche = `${data.title} ${data.textSample} ${adCards.map(c => c.copyPreview).join(" ")}`;
  const allDates = uniqueArray([...data.dates, ...adCards.map(c => c.startedAt).filter(Boolean)]);
  const sortedDates = allDates.map(d => ({ raw: d, score: parseDateScore(d) })).filter(d => d.score > 0).sort((a, b) => a.score - b.score);
  const oldestAdDate = sortedDates.length ? sortedDates[0].raw : "Não identificado";
  const newestAdDate = sortedDates.length ? sortedDates[sortedDates.length - 1].raw : "Não identificado";

  const salesPageCandidates = uniqueArray([...data.externalLinks, ...adCards.flatMap(c => c.landingPages || [])]).slice(0, 50);
  const validation = getValidationStatus(activeCount, adCards.length, oldestAdDate, newestAdDate, adCards);

  const topCreatives = [...adCards].map(ad => {
    let score = 0;
    const reasons = [];
    if (ad.activeAds && ad.activeAds >= 5) { score += 30; reasons.push("criativo usado em vários anúncios"); }
    if (ad.startedAt) { score += 20; reasons.push("possui data de início"); }
    if (ad.copyPreview && ad.copyPreview.length > 60) { score += 20; reasons.push("copy identificada"); }
    if ((ad.images || []).length || (ad.videos || []).length) { score += 20; reasons.push("mídia capturada"); }
    if ((ad.landingPages || []).length) { score += 10; reasons.push("link externo detectado"); }
    return { ...ad, creativeScore: score, scoreReasons: reasons };
  }).sort((a, b) => b.creativeScore - a.creativeScore).slice(0, 10);

  return {
    ok: true,
    source: "facebook_ads_library",
    version: "2.2.0",
    activeOnly: true,
    analyzedAt: new Date().toISOString(),
    foundDate: todayBR(),
    url,
    pageName: data.pageName || "Não identificado automaticamente",
    niche: guessNiche(textForNiche),
    activeResultsCount: activeCount,
    adsExtracted: adCards.length,
    oldestAdDate,
    newestAdDate,
    salesPageCandidates,
    validation,
    topCreatives,
    ads: adCards,
    raw: {
      title: data.title,
      datesFound: allDates,
      note: "Versão 2.2: captura cards reais por patrocinado + identificação da biblioteca + veiculação iniciada, tenta extrair copy, mídia, CTA, domínio e landing pages."
    }
  };
}

app.get("/", (req, res) => {
  res.json({ status: "online", service: "JP Radar Robô", version: "2.2.0", endpoints: ["/health", "/analyze", "/monitor"], activeOnly: true });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Robô online", version: "2.2.0", date: new Date().toISOString() });
});

app.post("/analyze", async (req, res) => {
  try {
    const url = normalizeUrl(req.body.url);
    if (!url) return res.status(400).json({ ok: false, error: "Envie o campo url no JSON." });
    if (!url.includes("facebook.com/ads/library")) return res.status(400).json({ ok: false, error: "O link precisa ser da Biblioteca de Anúncios do Facebook." });
    const result = await analyzeFacebookAdsLibrary(url);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Falha ao analisar o link.", detail: err.message });
  }
});

app.get("/analyze", async (req, res) => {
  try {
    const url = normalizeUrl(req.query.url);
    if (!url) return res.status(400).json({ ok: false, error: "Use /analyze?url=LINK" });
    if (!url.includes("facebook.com/ads/library")) return res.status(400).json({ ok: false, error: "O link precisa ser da Biblioteca de Anúncios do Facebook." });
    const result = await analyzeFacebookAdsLibrary(url);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Falha ao analisar.", detail: err.message });
  }
});

app.get("/monitor", async (req, res) => {
  res.json({ ok: true, version: "2.2.0", message: "Endpoint de monitoramento ativo. Próximo passo: conectar banco de dados/Supabase e rodar lista diária de ofertas.", activeOnly: true, date: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`JP Radar Robô v2.2 rodando na porta ${PORT}`);
});
