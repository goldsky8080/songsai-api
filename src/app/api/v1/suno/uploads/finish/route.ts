import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { MusicStatus, Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { sunoApi } from "@/lib/SunoApi";
import { toMusicItem } from "@/server/music/mapper";
import { buildFinishClipUploadPayload, summarizeUploadedClip } from "@/server/suno/uploads";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: buildCorsHeaders(request) });
  }

  try {
    const body = (await request.json()) as {
      filename?: string;
      initializeResponse?: Record<string, any> | null;
      payload?: Record<string, any> | null;
      uploadId?: string | null;
    };

    const api = await sunoApi(cookies().toString());
    const payload = buildFinishClipUploadPayload(body);
    const uploadId =
      body.uploadId ||
      body.initializeResponse?.id ||
      body.initializeResponse?.upload_id ||
      body.initializeResponse?.audio_id;

    if (!uploadId || typeof uploadId !== "string") {
      return NextResponse.json(
        { error: "uploadId is required to finalize the uploaded audio." },
        { status: 400, headers: buildCorsHeaders(request) },
      );
    }

    const raw = (await api.finishClipUpload(uploadId, payload)) as Record<string, any>;
    const summary = summarizeUploadedClip(raw);
    const canonicalTitle = summary.title ?? body.filename ?? "Uploaded source audio";

    await api
      .setUploadedAudioMetadata(uploadId, {
        title: canonicalTitle,
      })
      .catch(() => null);

    await api
      .setUploadedAudioDescription(uploadId, canonicalTitle)
      .catch(() => null);

    const resolvedAudio = await api.resolveUploadedAudio([
      summary.providerClipId,
      summary.providerSongId,
      body.initializeResponse?.clip_id,
      body.initializeResponse?.clipId,
      body.initializeResponse?.song_id,
      body.initializeResponse?.songId,
      uploadId,
    ]);

    const enrichedSummary = {
      ...summary,
      providerClipId: resolvedAudio?.id ?? summary.providerClipId,
      audioUrl: resolvedAudio?.audio_url ?? summary.audioUrl,
      imageUrl: resolvedAudio?.image_url ?? summary.imageUrl,
      title: resolvedAudio?.title ?? canonicalTitle,
      status: resolvedAudio?.status ?? summary.status ?? "complete",
      displayTags: resolvedAudio?.tags ?? summary.displayTags,
    };

    const providerTaskId = enrichedSummary.providerClipId ?? enrichedSummary.providerSongId ?? uploadId;

    const item = await db.music.upsert({
      where: {
        providerTaskId,
      },
      update: {
        title: enrichedSummary.title ?? canonicalTitle,
        provider: "SUNO_UPLOAD",
        mp3Url: enrichedSummary.audioUrl ?? undefined,
        imageUrl: enrichedSummary.imageUrl ?? undefined,
        rawStatus: enrichedSummary.status ?? "complete",
        rawPayload: payload as Prisma.InputJsonValue,
        rawResponse: raw as Prisma.InputJsonValue,
        status: MusicStatus.COMPLETED,
        tags: enrichedSummary.displayTags ?? undefined,
        errorMessage: null,
      },
      create: {
        userId: sessionUser.id,
        requestGroupId: null,
        isPublic: false,
        title: enrichedSummary.title ?? canonicalTitle,
        lyrics: "",
        stylePrompt: "Uploaded source audio",
        provider: "SUNO_UPLOAD",
        providerTaskId,
        mp3Url: enrichedSummary.audioUrl ?? undefined,
        imageUrl: enrichedSummary.imageUrl ?? undefined,
        rawStatus: enrichedSummary.status ?? "complete",
        rawPayload: payload as Prisma.InputJsonValue,
        rawResponse: raw as Prisma.InputJsonValue,
        status: MusicStatus.COMPLETED,
        tags: enrichedSummary.displayTags ?? undefined,
      },
    });

    return NextResponse.json(
      {
        payload,
        ...enrichedSummary,
        resolvedAudio,
        item: toMusicItem(item, { forceNoVideo: true }),
      },
      { headers: buildCorsHeaders(request) },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.response?.data?.detail || error?.message || "Failed to finalize Suno clip upload.",
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
