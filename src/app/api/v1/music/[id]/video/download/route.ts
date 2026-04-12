import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sanitizeFilenamePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "").trim() || "video";
}

function encodeDispositionFilename(fileName: string, fallbackName: string) {
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

type RouteContext = {
  params: {
    id: string;
  };
};

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
      videos: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
  });

  if (!music) {
    return NextResponse.json({ error: "Music not found" }, { status: 404, headers: buildCorsHeaders(request) });
  }

  const video = music.videos[0] ?? null;
  if (!video || !video.mp4Url) {
    return NextResponse.json({ error: "Video is not ready yet." }, { status: 409, headers: buildCorsHeaders(request) });
  }

  const upstream = await fetchDownloadStream(video.mp4Url);
  if (!upstream) {
    return NextResponse.json({ error: "Failed to fetch downloadable video." }, { status: 502, headers: buildCorsHeaders(request) });
  }

  const fileName = `${sanitizeFilenamePart(music.title || "video")}.mp4`;
  const fallbackFileName = "video.mp4";

  return new Response(upstream.stream, {
    status: 200,
    headers: {
      ...buildCorsHeaders(request),
      "Content-Type": upstream.contentType ?? "video/mp4",
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

