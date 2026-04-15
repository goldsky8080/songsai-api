import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { buildCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";

const supportTypeSchema = z.enum([
  "account",
  "billing",
  "music",
  "video",
  "download",
  "other",
]);

const contactSchema = z.object({
  type: supportTypeSchema,
  name: z.string().trim().min(1, "이름을 입력해 주세요.").max(100, "이름이 너무 깁니다."),
  email: z.string().trim().email("올바른 이메일 형식으로 입력해 주세요."),
  title: z.string().trim().min(1, "제목을 입력해 주세요.").max(200, "제목이 너무 깁니다."),
  message: z.string().trim().min(10, "문의 내용을 조금 더 자세히 입력해 주세요.").max(5000, "문의 내용이 너무 깁니다."),
  relatedMusicId: z.string().trim().min(1).max(100).optional().nullable(),
});

const supportTypeLabels: Record<z.infer<typeof supportTypeSchema>, string> = {
  account: "계정",
  billing: "결제/크레딧",
  music: "음악 생성",
  video: "비디오 생성",
  download: "다운로드/자산",
  other: "기타",
};

function buildSupportBody(input: {
  type: z.infer<typeof supportTypeSchema>;
  name: string;
  email: string;
  title: string;
  message: string;
  relatedMusicId?: string | null;
  userId?: string | null;
}) {
  const lines = [
    `문의 유형: ${supportTypeLabels[input.type]}`,
    `이름: ${input.name}`,
    `회신 이메일: ${input.email}`,
    input.userId ? `계정 ID: ${input.userId}` : null,
    input.relatedMusicId ? `관련 곡 ID: ${input.relatedMusicId}` : null,
    "",
    input.message.trim(),
  ];

  return lines.filter((line): line is string => typeof line === "string").join("\n");
}

export async function POST(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request);
  const sessionUser = await getSessionUser();
  const body = await request.json().catch(() => null);
  const parsed = contactSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: corsHeaders },
    );
  }

  const input = parsed.data;

  if (sessionUser && input.relatedMusicId) {
    const relatedMusic = await db.music.findFirst({
      where: {
        id: input.relatedMusicId,
        userId: sessionUser.id,
      },
      select: { id: true },
    });

    if (!relatedMusic) {
      return NextResponse.json(
        {
          error: {
            formErrors: [],
            fieldErrors: {
              relatedMusicId: ["선택한 곡을 확인할 수 없습니다."],
            },
          },
        },
        { status: 400, headers: corsHeaders },
      );
    }
  }

  const supportInboxEmail = getEnv().SUPPORT_INBOX_EMAIL || "support@songsai.org";
  const subject = `[${supportTypeLabels[input.type]}] ${input.title.trim()}`;
  const email = await db.inboundEmail.create({
    data: {
      fromEmail: input.email,
      fromName: input.name,
      toEmail: supportInboxEmail,
      subject,
      textBody: buildSupportBody({
        type: input.type,
        name: input.name,
        email: input.email,
        title: input.title,
        message: input.message,
        relatedMusicId: input.relatedMusicId ?? null,
        userId: sessionUser?.id ?? null,
      }),
      status: "NEW",
      rawPayload: {
        source: "support-form",
        type: input.type,
        title: input.title,
        relatedMusicId: input.relatedMusicId ?? null,
        userId: sessionUser?.id ?? null,
        accountEmail: sessionUser?.email ?? null,
      },
    },
  });

  return NextResponse.json(
    {
      ok: true,
      id: email.id,
      message: "문의가 접수되었습니다. 운영 흐름에 따라 순차적으로 확인합니다.",
    },
    { status: 201, headers: corsHeaders },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
