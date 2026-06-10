import { NextResponse } from "next/server";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const SEARCH_URL = "https://duckduckgo.com/html/";

export async function POST(request) {
  try {
    const { url } = await request.json();
    if (!url) {
      return NextResponse.json({ ok: false, error: "Link produk wajib diisi." }, { status: 400 });
    }
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({ ok: false, error: "GROQ_API_KEY belum diset di Vercel Environment Variables." }, { status: 500 });
    }

    const pageContext = await fetchProductContext(url);
    const webContext = await fetchWebSearchContext(url, pageContext);
    const context = { ...pageContext, webSearch: webContext };
    const product = await enrichProductWithGroq(url, context);
    return NextResponse.json({ ok: true, product, source: pageContext.source, webSearch: webContext });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

async function fetchProductContext(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AffiliateProductBot/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "id-ID,id;q=0.9,en-US;q=0.7,en;q=0.6",
      },
      signal: AbortSignal.timeout(6000),
    });
    const html = await response.text();
    const jsonLd = extractJsonLdProduct(html);
    const title = cleanTitle(jsonLd.name || extractMeta(html, "og:title") || extractMeta(html, "twitter:title") || extractTitle(html));
    const description = cleanText(jsonLd.description || extractMeta(html, "og:description") || extractMeta(html, "twitter:description") || extractMeta(html, "description"));
    return {
      source: response.url || url,
      title,
      description,
      price: jsonLd.price || extractMeta(html, "product:price:amount") || "",
      snippet: stripHtml(html).slice(0, 1200),
    };
  } catch {
    return { source: url, title: "", description: "", snippet: "" };
  }
}

async function enrichProductWithGroq(url, context) {
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Kamu adalah product researcher Shopee Affiliate Indonesia untuk konten Threads. Balas hanya JSON valid tanpa markdown. Utamakan fakta dari title/description. Jika data minim, buat profil generik yang jujur dan beri confidence low.",
        },
        {
          role: "user",
          content: `Ekstrak profil produk affiliate dari konteks berikut.

Link: ${url}
Final URL: ${context.source}
Title: ${context.title}
Description: ${context.description}
Price: ${context.price}
Snippet: ${context.snippet}
Web search query: ${context.webSearch?.query || "-"}
Web search results:
${formatSearchResults(context.webSearch?.results)}

Aturan kualitas:
- Nama produk harus natural untuk pembeli Indonesia, 3-10 kata, bukan kode link, bukan token acak, bukan nama toko.
- Buat "description" sebagai deskripsi produk 2-3 kalimat dalam bahasa Indonesia yang enak dipakai di dashboard affiliate.
- Description harus menjelaskan produk, kegunaan, target pembeli, dan konteks pemakaian. Jangan hanya mengulang nama produk.
- Gunakan hasil web search untuk memperbaiki judul/deskripsi/kategori jika metadata halaman kosong atau terlalu umum.
- Jika hasil web search bertentangan dengan metadata, prioritaskan data yang paling spesifik menyebut produk Shopee dari link/final URL.
- Jangan pakai kata "Shopee" sebagai nama produk kecuali memang bagian dari produk.
- Kategori harus spesifik, misalnya "fashion wanita", "aksesoris gadget", "alat rumah tangga", "skincare", "perlengkapan bayi".
- Selling point harus berupa manfaat nyata yang bisa dijadikan caption, bukan klaim berlebihan.
- Keywords adalah istilah pencarian Threads yang umum dipakai manusia, bukan hashtag dan bukan keyword marketplace yang terlalu panjang.
- Jika konteks tidak cukup untuk tahu produk tepatnya, gunakan nama "Produk affiliate Shopee", kategori "produk harian", confidence "low", dan description yang jujur bahwa detail produk perlu dicek dari link.
- Jangan mengarang brand, harga, diskon, rating, atau bahan yang tidak ada di konteks.

Format JSON wajib:
{
  "name": "nama produk singkat",
  "description": "deskripsi produk 2-3 kalimat",
  "category": "kategori produk",
  "price": "",
  "audience": "target pembeli",
  "sellingPoints": ["3 sampai 5 selling point"],
  "keywords": ["5 sampai 8 keyword pencarian Threads"],
  "confidence": "high|medium|low"
}`,
        },
      ],
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error?.message || `Groq error ${response.status}`);
  }
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq tidak mengembalikan konten produk.");
  return normalizeProduct(JSON.parse(extractJson(content)), context);
}

async function fetchWebSearchContext(url, context) {
  const query = buildSearchQuery(url, context);
  if (!query) return { query: "", results: [] };

  try {
    const response = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(query)}`, {
      headers: {
        "user-agent": "Mozilla/5.0 AffiliateProductResearchBot/1.0",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "id-ID,id;q=0.9,en-US;q=0.7,en;q=0.6",
      },
      signal: AbortSignal.timeout(7000),
    });
    const html = await response.text();
    return { query, results: parseDuckDuckGoResults(html).slice(0, 5) };
  } catch {
    return { query, results: [] };
  }
}

function buildSearchQuery(url, context) {
  const title = cleanTitle(context.title);
  if (title && !isBadProductName(title)) return `${title} Shopee Indonesia`;

  const sourceTerms = extractProductTermsFromUrl(context.source || url);
  if (sourceTerms) return `${sourceTerms} Shopee`;

  try {
    const host = new URL(context.source || url).hostname;
    if (host.includes("shopee")) return `"${context.source || url}" produk Shopee`;
  } catch {
    // Ignore invalid URLs and fall through to the raw URL query.
  }

  return `${url} Shopee produk`;
}

function extractProductTermsFromUrl(value) {
  try {
    const parsed = new URL(value);
    const path = decodeURIComponent(parsed.pathname || "");
    const segments = path.split("/").filter(Boolean);
    const slug = segments.find((segment) => /[a-zA-Z]/.test(segment) && segment.length > 10);
    if (!slug) return "";
    return cleanText(slug.replace(/-i\.\d+\.\d+.*$/i, "").replace(/[-_]+/g, " "));
  } catch {
    return "";
  }
}

function parseDuckDuckGoResults(html) {
  const blocks = html.match(/<div class="result[\s\S]*?<\/div>\s*<\/div>/gi) || [];
  return blocks.map((block) => {
    const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const urlMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"/i);
    return {
      title: cleanText(stripHtml(titleMatch?.[1] || "")),
      snippet: cleanText(stripHtml(snippetMatch?.[1] || snippetMatch?.[2] || "")),
      url: decodeSearchUrl(urlMatch?.[1] || ""),
    };
  }).filter((item) => item.title || item.snippet);
}

function decodeSearchUrl(value) {
  const text = decodeHtml(value);
  try {
    const parsed = new URL(text, "https://duckduckgo.com");
    return parsed.searchParams.get("uddg") || text;
  } catch {
    return text;
  }
}

function formatSearchResults(results = []) {
  if (!results.length) return "-";
  return results.map((item, index) => `${index + 1}. Title: ${item.title || "-"}\n   Snippet: ${item.snippet || "-"}\n   URL: ${item.url || "-"}`).join("\n");
}

function extractMeta(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = getAttribute(tag, "property") || getAttribute(tag, "name");
    if (property?.toLowerCase() === key.toLowerCase()) return decodeHtml(getAttribute(tag, "content") || "");
  }
  return "";
}

function extractTitle(html) {
  return decodeHtml(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "");
}

function stripHtml(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function getAttribute(tag, name) {
  const match = tag.match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return match?.[1] || "";
}

function cleanTitle(value) {
  return cleanText(value)
    .replace(/\s*\|\s*Shopee.*$/i, "")
    .replace(/\s*-\s*Jual.*$/i, "")
    .replace(/\s*Harga.*$/i, "")
    .trim();
}

function cleanText(value) {
  return decodeHtml(value)
    .replace(/\s+/g, " ")
    .replace(/\b(Beli|Jual)\s+/gi, "")
    .trim();
}

function extractJson(content) {
  const text = String(content || "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

function normalizeProduct(parsed, context) {
  const fallbackName = inferNameFromContext(context);
  let name = cleanProductName(parsed.name) || fallbackName;
  let confidence = normalizeConfidence(parsed.confidence);
  if (isBadProductName(name)) {
    name = fallbackName;
    confidence = "low";
  }

  const sellingPoints = normalizeList(parsed.sellingPoints).filter((item) => !isBadProductName(item));
  const keywords = normalizeList(parsed.keywords).filter((item) => !isBadProductName(item));
  const category = cleanText(parsed.category) || inferCategory(`${context.title} ${context.description}`);
  const description = cleanDescription(parsed.description) || buildDescription(name, category, parsed.audience, context);

  return {
    name,
    description,
    category,
    price: normalizePrice(parsed.price || context.price),
    audience: cleanText(parsed.audience) || audienceForCategory(category),
    sellingPoints: (sellingPoints.length ? sellingPoints : defaultSellingPoints(category)).slice(0, 5).join(", "),
    keywords: (keywords.length ? keywords : defaultKeywords(name, category)).slice(0, 8).join(", "),
    confidence,
  };
}

function cleanProductName(value) {
  return cleanText(value)
    .replace(/^produk\s*:\s*/i, "")
    .replace(/^nama\s*produk\s*:\s*/i, "")
    .replace(/[|#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDescription(value) {
  const description = cleanText(value);
  if (!description) return "";
  if (/s\.shopee|shopee\.co\.id|https?:\/\//i.test(description)) return "";
  return description.slice(0, 420);
}

function inferNameFromContext(context) {
  const title = cleanProductName(context.title);
  if (title && !isBadProductName(title)) return title.slice(0, 90);
  return "Produk affiliate Shopee";
}

function buildDescription(name, category, audience, context) {
  if (context.description) return cleanDescription(context.description);
  const target = cleanText(audience) || audienceForCategory(category);
  if (name !== "Produk affiliate Shopee") {
    return `${name} adalah produk kategori ${category} yang bisa dipakai untuk kebutuhan harian. Produk ini cocok untuk ${target}, terutama saat mencari pilihan yang praktis dari link affiliate.`;
  }
  return "Detail produk belum terbaca jelas dari link Shopee yang dikirim. Buka link produk untuk memastikan judul, varian, harga, dan manfaat utama sebelum dipakai untuk konten affiliate.";
}

function isBadProductName(value) {
  const text = cleanText(value);
  if (!text) return true;
  if (/^[-\w]{7,14}$/i.test(text) && !/\s/.test(text)) return true;
  if (/^(shopee|produk|fashion|pakaian|aksesoris)$/i.test(text)) return true;
  if (/s\.shopee|shopee\.co\.id|https?:\/\//i.test(text)) return true;
  return false;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return String(value || "")
    .split(/[,;\n]/)
    .map(cleanText)
    .filter(Boolean);
}

function normalizePrice(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function normalizeConfidence(value) {
  const confidence = String(value || "").toLowerCase();
  return ["high", "medium", "low"].includes(confidence) ? confidence : "medium";
}

function inferCategory(text) {
  const source = cleanText(text).toLowerCase();
  if (/dress|baju|kaos|kemeja|celana|hijab|sepatu|sandal|tas/.test(source)) return "fashion";
  if (/case|charger|kabel|earphone|headset|powerbank|gadget|hp/.test(source)) return "aksesoris gadget";
  if (/lampu|rak|dapur|pel|vacuum|botol|minum|rumah/.test(source)) return "perlengkapan rumah";
  if (/skincare|serum|moisturizer|sunscreen|makeup|lip/.test(source)) return "beauty";
  if (/bayi|anak|mainan|popok/.test(source)) return "perlengkapan anak";
  return "produk harian";
}

function audienceForCategory(category) {
  const map = {
    fashion: "pengguna yang cari outfit praktis dan terjangkau",
    "aksesoris gadget": "pengguna gadget yang butuh aksesori praktis",
    "perlengkapan rumah": "orang yang ingin rumah lebih rapi dan nyaman",
    beauty: "pengguna skincare dan makeup harian",
    "perlengkapan anak": "orang tua dan keluarga muda",
  };
  return map[category] || "pembeli Shopee yang mencari produk praktis";
}

function defaultSellingPoints(category) {
  return [
    `cocok untuk kebutuhan ${category}`,
    "mudah dipakai sehari-hari",
    "pilihan praktis untuk pembeli online",
  ];
}

function defaultKeywords(name, category) {
  return [category, name, `rekomendasi ${category}`, `produk ${category}`, "belanja Shopee"];
}

function extractJsonLdProduct(html) {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const raw = script.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      const data = JSON.parse(decodeHtml(raw));
      const product = findProductJsonLd(data);
      if (product) {
        return {
          name: cleanText(product.name),
          description: cleanText(product.description),
          price: normalizePrice(product.offers?.price || product.offers?.lowPrice || product.price),
        };
      }
    } catch {
      // Ignore malformed embedded JSON-LD and continue with meta tags.
    }
  }
  return {};
}

function findProductJsonLd(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const product = findProductJsonLd(item);
      if (product) return product;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : value["@type"];
  if (String(type || "").toLowerCase().includes("product")) return value;
  return findProductJsonLd(value["@graph"]);
}
