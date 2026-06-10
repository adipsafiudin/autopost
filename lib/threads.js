import { cookies } from "next/headers";

const TOKEN_COOKIE = "threads_token";

export function appBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export function redirectUri() {
  return process.env.THREADS_REDIRECT_URI || `${appBaseUrl()}/auth/threads/callback`;
}

export function threadsConfigured() {
  return Boolean(process.env.THREADS_CLIENT_ID && process.env.THREADS_CLIENT_SECRET);
}

export function requireThreadsConfig() {
  if (!threadsConfigured()) {
    throw new Error("THREADS_CLIENT_ID dan THREADS_CLIENT_SECRET belum dikonfigurasi.");
  }
}

export async function getThreadsToken() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(TOKEN_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function setThreadsToken(token) {
  const cookieStore = await cookies();
  cookieStore.set(TOKEN_COOKIE, Buffer.from(JSON.stringify(token)).toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: token.expires_in || 60 * 60 * 24 * 45,
    path: "/",
  });
}

export async function publicTokenStatus() {
  const token = await getThreadsToken();
  if (!token) return { connected: false };
  return {
    connected: true,
    userId: token.user_id || token.userId || "me",
    expiresAt: token.expires_at || null,
    scope: token.scope || "threads_basic,threads_content_publish",
  };
}

export async function assertOk(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body.error?.message || body.message || `HTTP ${response.status}`);
  }
  return body;
}

export async function exchangeThreadsCode(code) {
  requireThreadsConfig();
  const shortLived = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.THREADS_CLIENT_ID,
      client_secret: process.env.THREADS_CLIENT_SECRET,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code,
    }),
  }).then(assertOk);

  const longLivedUrl = new URL("https://graph.threads.net/access_token");
  longLivedUrl.searchParams.set("grant_type", "th_exchange_token");
  longLivedUrl.searchParams.set("client_secret", process.env.THREADS_CLIENT_SECRET);
  longLivedUrl.searchParams.set("access_token", shortLived.access_token);
  const longLived = await fetch(longLivedUrl).then(assertOk);

  const token = {
    ...longLived,
    user_id: shortLived.user_id,
    created_at: new Date().toISOString(),
    expires_at: longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000).toISOString() : null,
  };
  await setThreadsToken(token);
  return token;
}

export async function publishThreadsText(text) {
  const token = await getThreadsToken();
  if (!token?.access_token) throw new Error("Threads belum connected.");

  const created = await fetch("https://graph.threads.net/v1.0/me/threads", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "TEXT",
      text,
      access_token: token.access_token,
    }),
  }).then(assertOk);

  return fetch("https://graph.threads.net/v1.0/me/threads_publish", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: created.id,
      access_token: token.access_token,
    }),
  }).then(assertOk);
}

export async function replyThreadsText(targetThreadId, text) {
  const token = await getThreadsToken();
  if (!token?.access_token) throw new Error("Threads belum connected.");
  if (!targetThreadId) throw new Error("Reply butuh targetThreadId dari sumber opportunity resmi.");

  const created = await fetch("https://graph.threads.net/v1.0/me/threads", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "TEXT",
      text,
      reply_to_id: targetThreadId,
      access_token: token.access_token,
    }),
  }).then(assertOk);

  return fetch("https://graph.threads.net/v1.0/me/threads_publish", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: created.id,
      access_token: token.access_token,
    }),
  }).then(assertOk);
}

export function splitList(value = "") {
  return String(value)
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildMockOpportunities(products, settings) {
  const blocked = splitList(settings.blockedKeywords || "");
  return products.flatMap((product) => {
    const keywords = splitList(product.keywords || product.category || product.name);
    const keyword = keywords[0] || product.name;
    return [
      {
        productId: product.id,
        author: "@calonpembeli",
        text: `Ada rekomendasi ${keyword} yang harganya masih masuk akal? Butuh yang gampang dipakai.`,
        platform: "Threads mock source",
        targetThreadId: "",
        ageMinutes: 14,
      },
      {
        productId: product.id,
        author: "@tanyabarang",
        text: `Lagi cari ${product.category || "barang"} buat ${product.audience || "harian"}, tapi bingung pilih yang mana.`,
        platform: "Threads mock source",
        targetThreadId: "",
        ageMinutes: 35,
      },
    ].filter((item) => !blocked.some((word) => item.text.toLowerCase().includes(word.toLowerCase())));
  });
}
