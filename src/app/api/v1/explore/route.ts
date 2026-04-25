import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { toMusicItem } from "@/server/music/mapper";

export const dynamic = "force-dynamic";

type ExploreSort = "latest" | "weekly" | "monthly";

function parseProviderFilter(value: string | null) {
  if (value === "suno") {
    return "SUNO" as const;
  }

  if (value === "ace_step") {
    return "ACE_STEP" as const;
  }

  return null;
}

function getArtistName(user: { name: string | null; email: string }) {
  return user.name?.trim() || user.email.split("@")[0] || "SongsAI Artist";
}

function getSortParam(value: string | null): ExploreSort {
  if (value === "weekly" || value === "monthly") {
    return value;
  }

  return "latest";
}

function getRangeDate(sort: ExploreSort) {
  const now = Date.now();

  if (sort === "weekly") {
    return new Date(now - 7 * 24 * 60 * 60 * 1000);
  }

  if (sort === "monthly") {
    return new Date(now - 30 * 24 * 60 * 60 * 1000);
  }

  return null;
}

async function buildRankedIds(sort: "weekly" | "monthly", provider: "SUNO" | "ACE_STEP" | null) {
  const since = getRangeDate(sort);

  const ranked = await db.musicLike.groupBy({
    by: ["musicId"],
    where: {
      createdAt: {
        gte: since ?? undefined,
      },
      music: {
        isPublic: true,
        ...(provider ? { provider } : {}),
      },
    },
    _count: {
      musicId: true,
    },
    orderBy: {
      _count: {
        musicId: "desc",
      },
    },
  });

  return ranked.map((item) => item.musicId);
}

export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser();
  const sort = getSortParam(request.nextUrl.searchParams.get("sort"));
  const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "12", 10);
  const parsedOffset = Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 30) : 12;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const provider = parseProviderFilter(request.nextUrl.searchParams.get("provider"));

  let orderBy: Prisma.MusicOrderByWithRelationInput | Prisma.MusicOrderByWithRelationInput[] = {
    createdAt: "desc",
  };
  let rankedIds: string[] = [];

  if (sort === "weekly" || sort === "monthly") {
    rankedIds = await buildRankedIds(sort, provider);
    if (rankedIds.length === 0) {
      return NextResponse.json(
        {
          items: [],
          pagination: { offset, limit, total: 0, hasMore: false },
        },
        { status: 200, headers: buildCorsHeaders(request) },
      );
    }
  }

  const where: Prisma.MusicWhereInput = {
    isPublic: true,
    mp3Url: { not: null },
    ...(provider ? { provider } : {}),
    ...(rankedIds.length > 0 ? { id: { in: rankedIds } } : {}),
  };

  const total = await db.music.count({ where });

  const items = await db.music.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      videos: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
      _count: {
        select: {
          likes: true,
        },
      },
      ...(sessionUser
        ? {
            likes: {
              where: {
                userId: sessionUser.id,
              },
              select: {
                id: true,
              },
              take: 1,
            },
          }
        : {}),
    },
    orderBy,
    skip: offset,
    take: rankedIds.length > 0 ? total : limit,
  });

  const orderedItems =
    rankedIds.length > 0
      ? rankedIds
          .map((id) => items.find((item) => item.id === id))
          .filter((item): item is NonNullable<(typeof items)[number]> => Boolean(item))
          .slice(offset, offset + limit)
      : items;

  return NextResponse.json(
    {
      items: orderedItems.map((item) =>
        toMusicItem(item, {
          latestVideo: item.videos[0] ?? null,
          artistId: item.user.id,
          artistName: getArtistName(item.user),
          likeCount: item._count.likes,
          likedByMe: sessionUser ? item.likes.length > 0 : false,
          forceNoDownload: true,
          forceNoVideo: true,
        }),
      ),
      pagination: {
        offset,
        limit,
        total,
        hasMore: offset + orderedItems.length < total,
      },
    },
    { status: 200, headers: buildCorsHeaders(request) },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
