import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { buildCorsHeaders } from "@/lib/http";
import { syncUserCreditBalances } from "@/server/credits/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: buildCorsHeaders(request) },
    );
  }

  const balance = await syncUserCreditBalances(sessionUser.id);

  return NextResponse.json(balance, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
