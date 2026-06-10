import { NextResponse } from "next/server";
import { replyThreadsText } from "@/lib/threads";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await replyThreadsText(body.targetThreadId, body.text || body.body || "");
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
