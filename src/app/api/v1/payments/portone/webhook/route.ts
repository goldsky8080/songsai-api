import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "@portone/server-sdk";
import { getEnv } from "@/lib/env";
import { reconcilePortoneWebhook } from "@/server/payments/portone";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const env = getEnv();

  if (!env.PORTONE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "PortOne webhook is not configured." }, { status: 503 });
  }

  const payload = await request.text();

  let webhookEvent: Awaited<ReturnType<typeof Webhook.verify>>;

  try {
    webhookEvent = await Webhook.verify(env.PORTONE_WEBHOOK_SECRET, payload, {
      "webhook-id": request.headers.get("webhook-id") ?? "",
      "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
      "webhook-signature": request.headers.get("webhook-signature") ?? "",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid webhook signature." },
      { status: 400 },
    );
  }

  try {
    switch (webhookEvent.type) {
      case "Transaction.Paid":
      case "Transaction.Failed":
      case "Transaction.Ready":
      case "Transaction.PayPending":
        await reconcilePortoneWebhook(webhookEvent.data.paymentId, webhookEvent.type);
        break;
      case "Transaction.Cancelled":
      case "Transaction.PartialCancelled":
      case "Transaction.CancelPending":
        await reconcilePortoneWebhook(webhookEvent.data.paymentId, webhookEvent.type);
        break;
      default:
        break;
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process webhook." },
      { status: 400 },
    );
  }
}
