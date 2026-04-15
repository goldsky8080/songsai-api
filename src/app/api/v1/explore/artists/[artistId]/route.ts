import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { toMusicItem } from "@/server/music/mapper";

export const dynamic = "force-dynamic";

function getArtistName(user: { name: string | null; email: string }) {
  return user.name?.trim() || user.email.split("@")[0] || "SongsAI Artist";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ artistId: string }> },
) {
  const sessionUser = await getSessionUser();
  const { artistId } = await context.params;
  const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "18", 10);
  const parsedOffset = Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 30) : 18;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

  const artist = await db.user.findUnique({
    where: { id: artistId },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      _count: {
        select: {
          musics: {
            where: {
              isPublic: true,
              mp3Url: { not: null },
            },
          },
        },
      },
    },
  });

  if (!artist) {
    return NextResponse.json({ error: "Artist not found." }, { status: 404, headers: buildCorsHeaders(request) });
  }

  const where = {
    userId: artistId,
    isPublic: true,
    mp3Url: { not: null },
  } as const;

  const total = await db.music.count({ where });
  const items = await db.music.findMany({
    where,
    include: {
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
              select: { id: true },
              take: 1,
            },
          }
        : {}),
    },
    orderBy: {
      createdAt: "desc",
    },
    skip: offset,
    take: limit,
  });

  return NextResponse.json(
    {
      artist: {
        id: artist.id,
        name: getArtistName(artist),
        joinedAt: artist.createdAt.toISOString(),
        publicCount: artist._count.musics,
      },
      items: items.map((item) =>
        toMusicItem(item, {
          latestVideo: item.videos[0] ?? null,
          artistId: artist.id,
          artistName: getArtistName(artist),
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
        hasMore: offset + items.length < total,
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
