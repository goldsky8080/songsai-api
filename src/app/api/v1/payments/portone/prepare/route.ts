import { PaymentOrderStatus, PaymentProvider } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import {
  createPortonePaymentId,
  getPortoneConfig,
  getPortoneCreditProductByCode,
  isPortoneConfigured,
} from "@/server/payments/portone";

export const dynamic = "force-dynamic";

const prepareSchema = z.object({
  productCode: z.enum(["credit_110", "credit_350", "credit_590"]),
});

export async function POST(request: NextRequest) {
  const sessionUser = await getSessionUser();
  const corsHeaders = buildCorsHeaders(request);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  if (!isPortoneConfigured()) {
    return NextResponse.json({ error: "PortOne is not configured yet." }, { status: 503, headers: corsHeaders });
  }

  const body = await request.json();
  const parsed = prepareSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers: corsHeaders });
  }

  const product = getPortoneCreditProductByCode(parsed.data.productCode);
  if (!product) {
    return NextResponse.json({ error: "Unknown credit pack." }, { status: 400, headers: corsHeaders });
  }

  const config = getPortoneConfig();
  const paymentId = createPortonePaymentId();

  const order = await db.paymentOrder.create({
    data: {
      userId: sessionUser.id,
      provider: PaymentProvider.PORTONE,
      status: PaymentOrderStatus.CHECKOUT_CREATED,
      productCode: product.code,
      requestedCredits: product.credits,
      amount: product.amount,
      currency: product.currency,
      externalOrderId: paymentId,
      rawPayload: {
        source: "portone_prepare",
      },
    },
  });

  return NextResponse.json(
    {
      paymentId,
      paymentOrderId: order.id,
      storeId: config.storeId,
      channelKey: config.channelKey,
      redirectUrl: config.redirectUrl,
      noticeUrls: [config.noticeUrl],
      orderName: `${product.credits} Credits`,
      totalAmount: product.amount,
      currency: product.currency,
      customer: {
        customerId: sessionUser.id,
        fullName: sessionUser.email,
        email: sessionUser.email,
      },
    },
    { status: 200, headers: corsHeaders },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
