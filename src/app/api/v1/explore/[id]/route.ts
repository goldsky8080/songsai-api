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
  context: { params: Promise<{ id: string }> },
) {
  const sessionUser = await getSessionUser();
  const { id } = await context.params;

  const music = await db.music.findFirst({
    where: {
      id,
      isPublic: true,
      mp3Url: { not: null },
    },
    include: {
      user: {
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
              select: { id: true },
              take: 1,
            },
          }
        : {}),
    },
  });

  if (!music) {
    return NextResponse.json({ error: "Public music not found." }, { status: 404, headers: buildCorsHeaders(request) });
  }

  const related = await db.music.findMany({
    where: {
      userId: music.userId,
      isPublic: true,
      mp3Url: { not: null },
      NOT: {
        id: music.id,
      },
    },
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
    take: 6,
  });

  const artistName = getArtistName(music.user);

  return NextResponse.json(
    {
      item: toMusicItem(music, {
        latestVideo: music.videos[0] ?? null,
        artistId: music.user.id,
        artistName,
        likeCount: music._count.likes,
        likedByMe: sessionUser ? music.likes.length > 0 : false,
        forceNoDownload: true,
        forceNoVideo: true,
      }),
      artist: {
        id: music.user.id,
        name: artistName,
        joinedAt: music.user.createdAt.toISOString(),
        publicCount: music.user._count.musics,
      },
      related: related.map((item) =>
        toMusicItem(item, {
          latestVideo: item.videos[0] ?? null,
          artistId: music.user.id,
          artistName,
          likeCount: item._count.likes,
          likedByMe: sessionUser ? item.likes.length > 0 : false,
          forceNoDownload: true,
          forceNoVideo: true,
        }),
      ),
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
