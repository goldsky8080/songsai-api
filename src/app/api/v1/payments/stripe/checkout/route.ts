import { PaymentOrderStatus, PaymentProvider } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import {
  createExternalOrderId,
  getStripeCheckoutUrls,
  getStripeClient,
  getStripeCreditProductByCode,
} from "@/server/payments/stripe";

export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  productCode: z.enum(["credit_110", "credit_350", "credit_590"]),
});

export async function POST(request: NextRequest) {
  const sessionUser = await getSessionUser();
  const corsHeaders = buildCorsHeaders(request);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const body = await request.json();
  const parsed = checkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers: corsHeaders });
  }

  const product = getStripeCreditProductByCode(parsed.data.productCode);

  if (!product?.priceId) {
    return NextResponse.json(
      { error: "This credit pack is not configured yet." },
      { status: 503, headers: corsHeaders },
    );
  }

  const order = await db.paymentOrder.create({
    data: {
      userId: sessionUser.id,
      provider: PaymentProvider.STRIPE,
      status: PaymentOrderStatus.PENDING,
      productCode: product.code,
      requestedCredits: product.credits,
      amount: product.amount,
      currency: product.currency,
      externalOrderId: createExternalOrderId(),
    },
  });

  const stripe = getStripeClient();
  const { successUrl, cancelUrl } = getStripeCheckoutUrls();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: sessionUser.email,
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [
      {
        price: product.priceId,
        quantity: 1,
      },
    ],
    metadata: {
      paymentOrderId: order.id,
      externalOrderId: order.externalOrderId,
      userId: sessionUser.id,
      productCode: product.code,
      requestedCredits: String(product.credits),
    },
  });

  await db.paymentOrder.update({
    where: { id: order.id },
    data: {
      status: PaymentOrderStatus.CHECKOUT_CREATED,
      stripeSessionId: session.id,
      rawPayload: JSON.parse(JSON.stringify(session)),
    },
  });

  return NextResponse.json(
    {
      checkoutUrl: session.url,
      paymentOrderId: order.id,
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
