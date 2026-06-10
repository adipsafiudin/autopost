import { NextResponse } from "next/server";
import { redirectUri, requireThreadsConfig, THREADS_SCOPES } from "@/lib/threads";

export async function POST() {
  try {
    requireThreadsConfig();
    const authUrl = new URL("https://threads.net/oauth/authorize");
    authUrl.searchParams.set("client_id", process.env.THREADS_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri());
    authUrl.searchParams.set("scope", THREADS_SCOPES);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", crypto.randomUUID());
    return NextResponse.json({ authUrl: authUrl.toString() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
