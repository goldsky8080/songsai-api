import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser();
  const corsHeaders = buildCorsHeaders(request);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const user = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, email: true, createdAt: true, updatedAt: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const [musicCount, videoCount, latestMusic, supportCount] = await Promise.all([
    db.music.count({ where: { userId: user.id } }),
    db.video.count({ where: { music: { userId: user.id } } }),
    db.music.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    db.inboundEmail.count({ where: { fromEmail: user.email } }),
  ]);

  return NextResponse.json(
    {
      musicCount,
      videoCount,
      supportCount,
      latestActivityAt: latestMusic?.createdAt ?? null,
      joinedAt: user.createdAt,
    },
    { status: 200, headers: corsHeaders },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
