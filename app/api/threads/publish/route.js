import { NextResponse } from "next/server";
import { publishThreadsText } from "@/lib/threads";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await publishThreadsText(body.text || body.caption || "");
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
