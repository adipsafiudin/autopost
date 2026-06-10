import { NextResponse } from "next/server";
import { assertOk, buildMockOpportunities, searchThreadsByProduct } from "@/lib/threads";

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

    if (payload.settings?.threadsMode === "live") {
      const products = payload.products || [];
      const nested = await Promise.all(products.map((product) => searchThreadsByProduct(product, payload.manualQuery || "")));
      const opportunities = nested.flat();
      return NextResponse.json({
        mode: "threads_keyword_search",
        opportunities,
        searchedProducts: products.length,
        manualQuery: payload.manualQuery || "",
      });
    }

    return NextResponse.json({
      mode: "mock",
      opportunities: buildMockOpportunities(payload.products || [], payload.settings || {}),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
