import { access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { AssetStatus, MusicAssetType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { syncMusicCoverImageAsset } from "@/server/music/asset-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: {
    id: string;
  };
};

async function getLocalCoverResponse(storagePath: string, mimeType: string | null) {
  try {
    await access(storagePath);

    return new Response(Readable.toWeb(createReadStream(storagePath)) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        "Content-Type": mimeType ?? "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = context.params;
  const music = await db.music.findUnique({
    where: { id },
    include: {
      assets: {
        where: {
          assetType: MusicAssetType.COVER_IMAGE,
          status: AssetStatus.READY,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 1,
      },
    },
  });

  if (!music) {
    return NextResponse.json({ error: "Music not found" }, { status: 404, headers: buildCorsHeaders(request) });
  }

  const existing = music.assets[0] ?? null;
  if (existing?.storagePath) {
    const local = await getLocalCoverResponse(existing.storagePath, existing.mimeType);
    if (local) {
      return local;
    }
  }

  const cached = await syncMusicCoverImageAsset({
    musicId: music.id,
    sourceUrl: existing?.sourceUrl ?? music.imageUrl,
  });

  if (cached?.storagePath) {
    const local = await getLocalCoverResponse(cached.storagePath, cached.mimeType);
    if (local) {
      return local;
    }
  }

  if (music.imageUrl) {
    const upstream = await fetch(music.imageUrl, { cache: "no-store", redirect: "follow" });
    if (upstream.ok && upstream.body) {
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
  }

  return NextResponse.json(
    { error: "Cover image not available" },
    { status: 404, headers: buildCorsHeaders(request) },
  );
}
