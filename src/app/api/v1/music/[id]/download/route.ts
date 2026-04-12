import { access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { AssetStatus, MusicAssetType, MusicStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { getAlignedLyricsFromProvider, getMusicStatusFromProvider } from "@/server/music/provider";
import { buildAlignedLyricLines } from "@/server/music/aligned-lyrics";
import { syncMusicMetadataAssets } from "@/server/music/asset-storage";
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

function toDbMusicStatus(status: "queued" | "processing" | "completed" | "failed") {
  switch (status) {
    case "processing":
      return MusicStatus.PROCESSING;
    case "completed":
      return MusicStatus.COMPLETED;
    case "failed":
      return MusicStatus.FAILED;
    case "queued":
    default:
      return MusicStatus.QUEUED;
  }
}

function encodeDispositionFilename(fileName: string, fallbackName: string) {
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

type RouteContext = {
  params: {
    id: string;
  };
};

async function getLocalAssetStream(
  storagePath: string,
  contentType: string | null,
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string | null } | null> {
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

  if (!isDownloadReady(music.createdAt)) {
    return NextResponse.json(
      {
        error: "Download is not available yet.",
        downloadAvailableAt: new Date(music.createdAt.getTime() + 5 * 60 * 1000).toISOString(),
      },
      { status: 409, headers: buildCorsHeaders(request) },
    );
  }

  let currentMusic = music;

  if (music.providerTaskId) {
    const [providerState] = await getMusicStatusFromProvider([music.providerTaskId]).catch(() => []);

    if (providerState) {
      const alignedWords = await getAlignedLyricsFromProvider(music.providerTaskId).catch(() => []);
      const alignedLines = alignedWords.length > 0 ? buildAlignedLyricLines(alignedWords) : [];

      currentMusic = await db.music.update({
        where: { id: music.id },
        data: {
          status:
            providerState.status === "completed" && providerState.mp3Url
              ? MusicStatus.COMPLETED
              : toDbMusicStatus(providerState.status),
          mp3Url: providerState.mp3Url ?? music.mp3Url,
          imageUrl: providerState.imageUrl ?? music.imageUrl,
          videoUrl: providerState.videoUrl ?? music.videoUrl,
          rawStatus: providerState.status,
          rawResponse: providerState,
          errorMessage: providerState.errorMessage ?? null,
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

      await syncMusicMetadataAssets({
        musicId: music.id,
        alignedWords,
        alignedLines,
        titleText: currentMusic.title ?? null,
      });
    }
  }

  const fileName = buildDownloadFileName(currentMusic.title, ".mp3");
  const fallbackFileName = buildAsciiFallbackFileName(".mp3");

  const localAsset = currentMusic.assets[0] ?? null;
  if (localAsset?.storagePath) {
    const localStream = await getLocalAssetStream(localAsset.storagePath, localAsset.mimeType ?? "audio/mpeg");

    if (localStream) {
      return new Response(localStream.stream, {
        status: 200,
        headers: {
          ...buildCorsHeaders(request),
          "Content-Type": localStream.contentType ?? "audio/mpeg",
          "Content-Disposition": encodeDispositionFilename(fileName, fallbackFileName),
          "Cache-Control": "private, no-store",
        },
      });
    }
  }

  if (!currentMusic.mp3Url) {
    return NextResponse.json(
      { error: "Track is not ready for download yet." },
      { status: 409, headers: buildCorsHeaders(request) },
    );
  }

  const upstream = await fetchDownloadStream(currentMusic.mp3Url);
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
      "Content-Disposition": encodeDispositionFilename(fileName, fallbackFileName),
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

