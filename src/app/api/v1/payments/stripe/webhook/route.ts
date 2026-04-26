import { CreditKind, CreditTransactionType, PaymentOrderStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { grantUserCredits } from "@/server/credits/service";
import { getStripeClient } from "@/server/payments/stripe";

export const dynamic = "force-dynamic";

async function markOrderStatus(
  stripeSessionId: string,
  status: PaymentOrderStatus,
  payload: unknown,
) {
  await db.paymentOrder.updateMany({
    where: { stripeSessionId },
    data: {
      status,
      rawPayload: JSON.parse(JSON.stringify(payload)),
    },
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const paymentOrderId = session.metadata?.paymentOrderId;
  if (!paymentOrderId) {
    return;
  }

  const order = await db.paymentOrder.findUnique({
    where: { id: paymentOrderId },
    include: { user: true },
  });

  if (!order || order.status === PaymentOrderStatus.PAID) {
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.paymentOrder.update({
      where: { id: order.id },
      data: {
        status: PaymentOrderStatus.PAID,
        stripeSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : order.stripePaymentIntentId,
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : order.stripeCustomerId,
        paidAt: new Date(),
        rawPayload: JSON.parse(JSON.stringify(session)),
      },
    });

    await grantUserCredits(
      order.userId,
      order.requestedCredits,
      CreditKind.PAID,
      `stripe:${order.id}`,
      `stripe_purchase:${order.productCode}`,
      tx,
      {
        paymentOrderId: order.id,
        type: CreditTransactionType.PURCHASE,
        metadata: JSON.parse(JSON.stringify(session)),
      },
    );
  });
}

export async function POST(request: NextRequest) {
  const env = getEnv();

  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const stripe = getStripeClient();
  const payload = await request.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid webhook signature." },
      { status: 400 },
    );
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "checkout.session.expired":
      await markOrderStatus((event.data.object as Stripe.Checkout.Session).id, PaymentOrderStatus.CANCELED, event);
      break;
    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      if (typeof paymentIntent.metadata?.paymentOrderId === "string") {
        await db.paymentOrder.updateMany({
          where: { id: paymentIntent.metadata.paymentOrderId },
          data: {
            status: PaymentOrderStatus.FAILED,
            rawPayload: JSON.parse(JSON.stringify(event)),
          },
        });
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
