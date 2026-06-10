import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    status: "data deletion callback active",
    message: "User data is stored locally in the user's browser localStorage. Clear site data to remove local records.",
  });
}

export async function POST() {
  return NextResponse.json({
    ok: true,
    confirmation_code: `delete_${Date.now()}`,
    status: "data deletion request received",
  });
}
