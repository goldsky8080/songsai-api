import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { isRecentCompletedMusic, toRecentMusicItem } from "@/server/music/mapper";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 20) : 10;

  const musics = await db.music.findMany({
    where: {
      status: {
        notIn: ["FAILED", "CANCELLED"],
      },
      mp3Url: {
        not: null,
      },
      errorMessage: null,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: limit * 3,
  });

  const items = musics
    .filter(isRecentCompletedMusic)
    .slice(0, limit)
    .map(toRecentMusicItem);

  return NextResponse.json(
    {
      items,
      meta: {
        limit,
        fetchedAt: new Date().toISOString(),
      },
    },
    {
      headers: buildCorsHeaders(request),
    },
  );
}
