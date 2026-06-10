import { NextResponse } from "next/server";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

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
    const product = await enrichProductWithGroq(url, pageContext);
    return NextResponse.json({ ok: true, product, source: pageContext.source });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

async function fetchProductContext(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 AffiliateProductBot/1.0",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(6000),
    });
    const html = await response.text();
    return {
      source: response.url || url,
      title: extractMeta(html, "og:title") || extractTitle(html),
      description: extractMeta(html, "og:description") || extractMeta(html, "description"),
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
          content: "Kamu adalah assistant affiliate Shopee Indonesia. Balas hanya JSON valid tanpa markdown.",
        },
        {
          role: "user",
          content: `Buat profil produk affiliate dari link dan konteks berikut.

Link: ${url}
Final URL: ${context.source}
Title: ${context.title}
Description: ${context.description}
Snippet: ${context.snippet}

Jika info kurang jelas, infer secara konservatif dari URL/title. Jangan mengarang brand spesifik yang tidak ada.

Format JSON wajib:
{
  "name": "nama produk singkat",
  "category": "kategori produk",
  "price": "",
  "audience": "target pembeli",
  "sellingPoints": "3-5 selling point dipisahkan koma",
  "keywords": "5-8 keyword pencarian Threads dipisahkan koma",
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
  const parsed = JSON.parse(content);
  return {
    name: parsed.name || "Produk Shopee",
    category: parsed.category || "produk",
    price: parsed.price || "",
    audience: parsed.audience || "pembeli Shopee",
    sellingPoints: parsed.sellingPoints || "praktis, value menarik, mudah digunakan",
    keywords: parsed.keywords || parsed.name || "produk Shopee",
    confidence: parsed.confidence || "medium",
  };
}

function extractMeta(html, key) {
  const propertyMatch = html.match(new RegExp(`<meta[^>]+property=["']${escapeRegExp(key)}["'][^>]+content=["']([^"']+)["']`, "i"));
  const nameMatch = html.match(new RegExp(`<meta[^>]+name=["']${escapeRegExp(key)}["'][^>]+content=["']([^"']+)["']`, "i"));
  return decodeHtml(propertyMatch?.[1] || nameMatch?.[1] || "");
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
