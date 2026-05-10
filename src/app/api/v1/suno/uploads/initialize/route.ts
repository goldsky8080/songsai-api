import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { buildCorsHeaders } from "@/lib/http";
import { sunoApi } from "@/lib/SunoApi";
import { normalizeInitializeClipUploadResponse } from "@/server/suno/uploads";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: buildCorsHeaders(request) });
  }

  try {
    const body = (await request.json()) as {
      filename?: string;
    };
    const filename = body.filename?.trim();

    if (!filename) {
      return NextResponse.json(
        { error: "filename is required." },
        { status: 400, headers: buildCorsHeaders(request) },
      );
    }

    const api = await sunoApi(cookies().toString());
    const raw = (await api.initializeClipUpload(filename)) as Record<string, any>;
    const normalized = normalizeInitializeClipUploadResponse(raw);

    return NextResponse.json(
      {
        filename,
        ...normalized,
      },
      { headers: buildCorsHeaders(request) },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.response?.data?.detail || error?.message || "Failed to initialize Suno clip upload.",
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
