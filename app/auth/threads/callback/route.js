import { NextResponse } from "next/server";
import { appBaseUrl, exchangeThreadsCode } from "@/lib/threads";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
  }

  try {
    await exchangeThreadsCode(code);
    return NextResponse.redirect(`${appBaseUrl()}/?threads=connected`);
  } catch (error) {
    return NextResponse.redirect(`${appBaseUrl()}/?threads=error&message=${encodeURIComponent(error.message)}`);
  }
}
