import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, status: "deauthorize callback active" });
}

export async function POST() {
  return NextResponse.json({ ok: true, status: "deauthorize received" });
}
