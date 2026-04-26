import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { buildCorsHeaders } from "@/lib/http";
import { ensureMusicMaterialsReady } from "@/server/music/finalize";
import { isDownloadReady } from "@/server/music/policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function getFrontendBaseUrl() {
  const env = getEnv();
  return (env.FRONTEND_URL ?? env.APP_URL).replace(/\/$/, "");
}

export async function POST(request: NextRequest, context: RouteContext) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: buildCorsHeaders(request) });
  }

  const { id } = await context.params;
  const music = await db.music.findFirst({
    where: {
      id,
      userId: sessionUser.id,
    },
    select: {
      id: true,
      isPublic: true,
      createdAt: true,
    },
  });

  if (!music) {
    return NextResponse.json({ error: "Music not found." }, { status: 404, headers: buildCorsHeaders(request) });
  }

  if (!music.isPublic) {
    return NextResponse.json(
      { error: "Share links are available only for public tracks." },
      { status: 409, headers: buildCorsHeaders(request) },
    );
  }

  if (!isDownloadReady(music.createdAt)) {
    return NextResponse.json(
      {
        error: "Share is available after the 5 minute stabilization window.",
        downloadAvailableAt: new Date(music.createdAt.getTime() + 5 * 60 * 1000).toISOString(),
      },
      { status: 409, headers: buildCorsHeaders(request) },
    );
  }

  const materials = await ensureMusicMaterialsReady(music.id);
  if (!materials?.mp3AssetPath || !materials.coverAssetPath) {
    return NextResponse.json(
      { error: "Share materials are not ready yet." },
      { status: 409, headers: buildCorsHeaders(request) },
    );
  }

  return NextResponse.json(
    {
      item: {
        id: music.id,
        shareUrl: `${getFrontendBaseUrl()}/share/${music.id}`,
        mp3AssetReady: Boolean(materials.mp3AssetPath),
        coverAssetReady: Boolean(materials.coverAssetPath),
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
