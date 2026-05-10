function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }

  return null;
}

function pickKnownKeys(source: Record<string, unknown>, keys: string[]) {
  const picked: Record<string, unknown> = {};

  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      picked[key] = source[key];
    }
  }

  return picked;
}

export function normalizeInitializeClipUploadResponse(raw: Record<string, any>) {
  const uploadFields =
    firstRecord(raw.fields, raw.upload_fields, raw.form_fields, raw.upload?.fields, raw.data?.fields) ?? {};
  const uploadHeaders =
    firstRecord(raw.headers, raw.upload_headers, raw.upload?.headers, raw.data?.headers) ?? {};

  const uploadUrl = firstString(
    raw.upload_url,
    raw.uploadUrl,
    raw.url,
    raw.presigned_url,
    raw.presignedUrl,
    raw.signed_url,
    raw.signedUrl,
    raw.upload?.url,
    raw.data?.url,
  );

  const uploadMethod =
    firstString(
      raw.upload_method,
      raw.method,
      raw.http_method,
      raw.upload?.method,
      raw.data?.method,
    ) ?? (Object.keys(uploadFields).length > 0 ? "POST" : "PUT");

  return {
    uploadUrl,
    uploadMethod,
    uploadHeaders,
    uploadFields,
    uploadId: firstString(raw.id, raw.upload_id, raw.uploadId, raw.audio_id, raw.audioId, raw.upload?.id, raw.data?.id),
    providerClipId: firstString(raw.clip_id, raw.clipId, raw.clip?.id, raw.id),
    providerSongId: firstString(raw.song_id, raw.songId, raw.song?.id),
    raw,
  };
}

export function buildFinishClipUploadPayload(input: {
  filename?: string;
  initializeResponse?: Record<string, any> | null;
  payload?: Record<string, any> | null;
}) {
  const raw = input.initializeResponse ?? {};
  const payload = {
    ...(firstRecord(input.payload) ?? {}),
    ...(firstRecord(raw.finish_payload, raw.finishPayload, raw.upload_finish_payload) ?? {}),
  } as Record<string, unknown>;

  payload.upload_type ??= "file_upload";
  if (input.filename) {
    payload.upload_filename ??= input.filename;
  }

  const fallbackSource = firstRecord(raw.upload, raw.data, raw) ?? {};
  const pickedFallback = pickKnownKeys(fallbackSource, [
    "id",
    "clip_id",
    "clipId",
    "song_id",
    "songId",
    "upload_id",
    "uploadId",
    "file_id",
    "fileId",
    "asset_id",
    "assetId",
    "key",
    "s3_key",
    "s3Key",
    "bucket",
    "bucket_name",
    "content_type",
    "contentType",
  ]);

  return {
    ...pickedFallback,
    ...payload,
  };
}

export function summarizeUploadedClip(raw: Record<string, any>) {
  return {
    uploadId: firstString(raw.id, raw.upload_id, raw.uploadId, raw.audio_id, raw.audioId),
    providerClipId: firstString(raw.clip_id, raw.clipId, raw.clip?.id, raw.id),
    providerSongId: firstString(raw.song_id, raw.songId, raw.song?.id),
    audioUrl: firstString(raw.audio_url, raw.audioUrl, raw.clip?.audio_url),
    imageUrl: firstString(raw.image_url, raw.imageUrl, raw.clip?.image_url),
    title: firstString(raw.title, raw.clip?.title),
    status: firstString(raw.status, raw.clip?.status),
    displayTags: firstString(raw.display_tags, raw.displayTags),
    entityType: firstString(raw.entity_type, raw.entityType),
    raw,
  };
}
