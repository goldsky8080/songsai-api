import bcrypt from "bcryptjs";
import { CreditKind, CreditTransactionType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { signupSchema } from "@/server/auth/schema";
import { grantUserCredits } from "@/server/credits/service";
import { SIGNUP_FREE_CREDITS } from "@/server/credits/constants";
import { toPublicUser } from "@/server/auth/user";
import {
  buildEmailVerificationUrl,
  createEmailVerificationToken,
  isEmailVerificationConfigured,
  sendVerificationEmail,
} from "@/server/email/verification";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request);
  const body = await request.json();
  const parsed = signupSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: corsHeaders },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const existingUser = await db.user.findUnique({ where: { email } });

  if (existingUser) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409, headers: corsHeaders },
    );
  }

  if (!isEmailVerificationConfigured()) {
    return NextResponse.json(
      { error: "Email verification is not configured." },
      { status: 503, headers: corsHeaders },
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await db.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email,
        name: parsed.data.name,
        passwordHash,
      },
    });

    await grantUserCredits(
      createdUser.id,
      SIGNUP_FREE_CREDITS,
      CreditKind.FREE,
      "signup_bonus",
      `welcome_bonus:${SIGNUP_FREE_CREDITS}`,
      tx,
      {
        type: CreditTransactionType.PROMOTION,
        metadata: {
          reason: "signup_welcome_bonus",
        },
      },
    );

    return createdUser;
  });

  const verification = await createEmailVerificationToken(user.id);
  const verifyUrl = buildEmailVerificationUrl(verification.rawToken, request.nextUrl.searchParams.get("next"));

  try {
    await sendVerificationEmail({
      toEmail: user.email,
      name: user.name,
      verifyUrl,
    });
  } catch (error) {
    await db.user.delete({ where: { id: user.id } }).catch(() => null);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Verification email could not be sent.",
      },
      { status: 500, headers: corsHeaders },
    );
  }

  return NextResponse.json(
    {
      user: toPublicUser(user),
      requiresEmailVerification: true,
      message: "Verification email sent. Please verify your email before logging in.",
      verificationExpiresAt: verification.expiresAt.toISOString(),
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
