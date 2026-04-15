import { NextRequest, NextResponse } from "next/server";
import { MusicStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { ensureMusicMaterialsReady } from "@/server/music/finalize";
import { getMusicStatusFromProvider } from "@/server/music/provider";
import { isDownloadReady } from "@/server/music/policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const music = await db.music.findFirst({
    where: {
      id,
      isPublic: true,
    },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      mp3Url: true,
      imageUrl: true,
      providerTaskId: true,
      tags: true,
      duration: true,
      errorMessage: true,
    },
  });

  if (!music) {
    return NextResponse.json({ error: "Music not found." }, { status: 404, headers: buildCorsHeaders(request) });
  }

  if (!isDownloadReady(music.createdAt)) {
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
            tags: providerState.tags ?? music.tags,
            duration: music.duration,
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
  if (!materials?.music.mp3Url) {
    return NextResponse.json(
      { error: "Track is not ready yet." },
      { status: 409, headers: buildCorsHeaders(request) },
    );
  }

  if (materials.music.status !== MusicStatus.COMPLETED) {
    await db.music.update({
      where: { id: music.id },
      data: {
        status: MusicStatus.COMPLETED,
      },
    }).catch(() => undefined);
  }

  return NextResponse.redirect(materials.music.mp3Url, { status: 307, headers: buildCorsHeaders(request) });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
