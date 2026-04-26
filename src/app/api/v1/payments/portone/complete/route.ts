import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildCorsHeaders } from "@/lib/http";
import { finalizePortonePaymentByPaymentId, isPortoneConfigured } from "@/server/payments/portone";

export const dynamic = "force-dynamic";

const completeSchema = z.object({
  paymentId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request);

  if (!isPortoneConfigured()) {
    return NextResponse.json({ error: "PortOne is not configured yet." }, { status: 503, headers: corsHeaders });
  }

  const body = await request.json();
  const parsed = completeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers: corsHeaders });
  }

  try {
    const result = await finalizePortonePaymentByPaymentId(parsed.data.paymentId);

    return NextResponse.json(
      {
        paymentId: parsed.data.paymentId,
        paid: result.paid,
        status: result.payment.status,
        balance: result.balance,
      },
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to confirm payment." },
      { status: 400, headers: corsHeaders },
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
