import { NextResponse } from "next/server";
import { assertOk, buildMockOpportunities } from "@/lib/threads";

export async function POST(request) {
  try {
    const payload = await request.json();
    if (process.env.THREADS_DISCOVERY_PROVIDER_URL) {
      const response = await fetch(process.env.THREADS_DISCOVERY_PROVIDER_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then(assertOk);
      return NextResponse.json(response);
    }

    return NextResponse.json({
      mode: "mock",
      opportunities: buildMockOpportunities(payload.products || [], payload.settings || {}),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
