import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { MusicStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { DEFAULT_MODEL, sunoApi } from "@/lib/SunoApi";
import { toMusicItem } from "@/server/music/mapper";

function toDbMusicStatus(status: string) {
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

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: buildCorsHeaders(request) });
  }

  try {
    const body = (await request.json()) as {
      sourceClipId?: string;
      title?: string;
      lyrics?: string;
      stylePrompt?: string;
      model?: string;
    };

    if (!body.sourceClipId?.trim()) {
      return NextResponse.json(
        { error: "sourceClipId is required." },
        { status: 400, headers: buildCorsHeaders(request) },
      );
    }

    if (!body.lyrics?.trim() || !body.stylePrompt?.trim()) {
      return NextResponse.json(
        { error: "lyrics and stylePrompt are required." },
        { status: 400, headers: buildCorsHeaders(request) },
      );
    }

    const sourceClipId = body.sourceClipId.trim();
    const lyrics = body.lyrics.trim();
    const stylePrompt = body.stylePrompt.trim();
    const resolvedTitle = body.title?.trim() || undefined;
    const resolvedModel = body.model || DEFAULT_MODEL;

    const api = await sunoApi(cookies().toString());
    const clips = await api.underpaint({
      underpaintingClipId: sourceClipId,
      prompt: lyrics,
      tags: stylePrompt,
      title: resolvedTitle,
      model: resolvedModel,
      metadata: {
        create_mode: "custom",
        is_custom: true,
        mv: resolvedModel,
        web_client_pathname: "/create",
      },
    });

    const requestGroupId = randomUUID();
    const created = await Promise.all(
      clips.map((clip) =>
        db.music.create({
          data: {
            userId: sessionUser.id,
            requestGroupId,
            isPublic: false,
            title: clip.title || resolvedTitle || "Underpainting result",
            lyrics,
            stylePrompt,
            provider: "SUNO",
            providerTaskId: clip.id,
            mp3Url: clip.audio_url ?? undefined,
            imageUrl: clip.image_url ?? undefined,
            rawStatus: clip.status,
            rawPayload: {
              sourceClipId,
              requestType: "underpainting",
            } as Prisma.InputJsonValue,
            rawResponse: clip as unknown as Prisma.InputJsonValue,
            status: toDbMusicStatus(clip.status),
            duration:
              typeof clip.duration === "string" && clip.duration.trim().length > 0
                ? Number.parseInt(clip.duration, 10) || undefined
                : undefined,
          },
        }),
      ),
    );

    return NextResponse.json(
      {
        sourceClipId,
        items: created.map((item) => toMusicItem(item)),
      },
      { headers: buildCorsHeaders(request) },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.response?.data?.detail || error?.message || "Failed to create underpainting track.",
      },
      {
        status: error?.response?.status || 502,
        headers: buildCorsHeaders(request),
      },
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 200, headers: buildCorsHeaders(request) });
}
