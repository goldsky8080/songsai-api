import { access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { AssetStatus, MusicAssetType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { ensureMusicMaterialsReady } from "@/server/music/finalize";
import { getMusicStatusFromProvider } from "@/server/music/provider";
import { isDownloadReady } from "@/server/music/policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sanitizeFilenamePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "").trim() || "music";
}

function buildDownloadFileName(title: string | null | undefined, extension: string) {
  return `${sanitizeFilenamePart(title || "music")}${extension}`;
}

function buildAsciiFallbackFileName(extension: string) {
  return `music${extension}`;
}

function encodeDispositionFilename(fileName: string, fallbackName: string, disposition: "attachment" | "inline") {
  return `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

type RouteContext = {
  params: {
    id: string;
  };
};

async function getLocalAssetStream(storagePath: string, contentType: string | null) {
  try {
    await access(storagePath);
    return {
      stream: Readable.toWeb(createReadStream(storagePath)) as ReadableStream<Uint8Array>,
      contentType,
    };
  } catch {
    return null;
  }
}

async function fetchDownloadStream(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    return null;
  }

  return {
    stream: response.body,
    contentType: response.headers.get("content-type"),
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: buildCorsHeaders(request) });
  }

  const { id } = context.params;
  const music = await db.music.findFirst({
    where: {
      id,
      userId: sessionUser.id,
    },
    include: {
      assets: {
        where: {
          assetType: MusicAssetType.MP3,
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

  const isInlinePlayback = request.nextUrl.searchParams.get("inline") === "1";
  const isReady = isDownloadReady(music.createdAt);

  if (!isReady) {
    if (!isInlinePlayback) {
      return NextResponse.json(
        {
          error: "Download is not available yet.",
          downloadAvailableAt: new Date(music.createdAt.getTime() + 5 * 60 * 1000).toISOString(),
        },
        { status: 409, headers: buildCorsHeaders(request) },
      );
    }

    let previewUrl = music.mp3Url ?? null;

    if (music.providerTaskId && (!music.mp3Url || !music.title || !music.imageUrl)) {
      const [providerState] = await getMusicStatusFromProvider([music.providerTaskId]).catch(() => []);
      if (providerState) {
        const refreshedMusic = await db.music.update({
          where: { id: music.id },
          data: {
            title: providerState.title?.trim() || music.title,
            mp3Url: providerState.mp3Url ?? music.mp3Url,
            imageUrl: providerState.imageUrl ?? music.imageUrl,
            rawStatus: providerState.status,
            rawResponse: providerState,
            duration: music.duration,
            tags: providerState.tags ?? music.tags,
            errorMessage: providerState.errorMessage ?? null,
          },
        });

        previewUrl = refreshedMusic.mp3Url ?? previewUrl;
      }
    }

    if (!previewUrl) {
      return NextResponse.json(
        { error: "Preview URL is not ready yet." },
        { status: 409, headers: buildCorsHeaders(request) },
      );
    }

    return NextResponse.redirect(previewUrl, { status: 307, headers: buildCorsHeaders(request) });
  }

  const materials = await ensureMusicMaterialsReady(music.id);
  if (!materials) {
    return NextResponse.json({ error: "Music not found" }, { status: 404, headers: buildCorsHeaders(request) });
  }

  const fileName = buildDownloadFileName(materials.titleText, ".mp3");
  const fallbackFileName = buildAsciiFallbackFileName(".mp3");
  const dispositionType = isInlinePlayback ? "inline" : "attachment";

  if (materials.mp3AssetPath) {
    const localStream = await getLocalAssetStream(materials.mp3AssetPath, "audio/mpeg");
    if (localStream) {
      return new Response(localStream.stream, {
        status: 200,
        headers: {
          ...buildCorsHeaders(request),
          "Content-Type": localStream.contentType ?? "audio/mpeg",
          "Content-Disposition": encodeDispositionFilename(fileName, fallbackFileName, dispositionType),
          "Cache-Control": "private, no-store",
        },
      });
    }
  }

  if (!materials.music.mp3Url) {
    return NextResponse.json(
      { error: "Track is not ready for download yet." },
      { status: 409, headers: buildCorsHeaders(request) },
    );
  }

  if (isInlinePlayback) {
    return NextResponse.redirect(materials.music.mp3Url, { status: 307, headers: buildCorsHeaders(request) });
  }

  const upstream = await fetchDownloadStream(materials.music.mp3Url);
  if (!upstream) {
    return NextResponse.json(
      { error: "Failed to fetch downloadable track." },
      { status: 502, headers: buildCorsHeaders(request) },
    );
  }

  return new Response(upstream.stream, {
    status: 200,
    headers: {
      ...buildCorsHeaders(request),
      "Content-Type": upstream.contentType ?? "audio/mpeg",
      "Content-Disposition": encodeDispositionFilename(fileName, fallbackFileName, dispositionType),
      "Cache-Control": "private, no-store",
    },
  });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
