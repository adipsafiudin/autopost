import { NextResponse } from "next/server";
import { publicTokenStatus, threadsConfigured } from "@/lib/threads";

export async function GET() {
  return NextResponse.json({
    backend: true,
    discoveryMode: process.env.THREADS_DISCOVERY_PROVIDER_URL ? "provider" : "mock",
    threads: await publicTokenStatus(),
    configured: threadsConfigured(),
  });
}
