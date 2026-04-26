import { randomUUID } from "node:crypto";
import { PaymentClient } from "@portone/server-sdk";
import { CreditKind, CreditTransactionType, PaymentOrderStatus, PaymentProvider, type PaymentOrder } from "@prisma/client";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { grantUserCredits, syncUserCreditBalances } from "@/server/credits/service";

export const PORTONE_CREDIT_PRODUCTS = [
  { code: "credit_110", credits: 110, amount: 11000, currency: "KRW" },
  { code: "credit_350", credits: 350, amount: 33000, currency: "KRW" },
  { code: "credit_590", credits: 590, amount: 55000, currency: "KRW" },
] as const;

export type PortoneCreditProductCode = (typeof PORTONE_CREDIT_PRODUCTS)[number]["code"];

let paymentClient: ReturnType<typeof PaymentClient> | null = null;

export function getPortoneConfig() {
  const env = getEnv();

  return {
    apiSecret: env.PORTONE_API_SECRET,
    storeId: env.PORTONE_STORE_ID,
    channelKey: env.PORTONE_CHANNEL_KEY,
    webhookSecret: env.PORTONE_WEBHOOK_SECRET,
    redirectUrl: `${env.FRONTEND_URL ?? env.APP_URL}/pricing?checkout=portone`,
    noticeUrl: `${env.APP_URL}/api/v1/payments/portone/webhook`,
  };
}

export function isPortoneConfigured() {
  const config = getPortoneConfig();
  return Boolean(config.apiSecret && config.storeId && config.channelKey);
}

export function getPortoneClient() {
  const config = getPortoneConfig();

  if (!config.apiSecret || !config.storeId) {
    throw new Error("PortOne is not configured.");
  }

  if (!paymentClient) {
    paymentClient = PaymentClient({
      secret: config.apiSecret,
      storeId: config.storeId,
    });
  }

  return paymentClient;
}

type PortonePayment = Awaited<ReturnType<ReturnType<typeof PaymentClient>["getPayment"]>>;

export function getPortoneCreditProductByCode(code: string) {
  return PORTONE_CREDIT_PRODUCTS.find((product) => product.code === code) ?? null;
}

export function createPortonePaymentId() {
  return `pay_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function isPaidPayment(payment: PortonePayment): payment is Extract<PortonePayment, { status: "PAID" }> {
  return payment.status === "PAID";
}

async function markPortoneOrderStatus(
  externalOrderId: string,
  status: PaymentOrderStatus,
  payload: unknown,
  paidAt?: Date,
) {
  await db.paymentOrder.updateMany({
    where: {
      externalOrderId,
      provider: PaymentProvider.PORTONE,
    },
    data: {
      status,
      paidAt,
      rawPayload: JSON.parse(JSON.stringify(payload)),
    },
  });
}

function getOrderStateFromPaymentStatus(status: PortonePayment["status"]) {
  switch (status) {
    case "PAID":
      return PaymentOrderStatus.PAID;
    case "FAILED":
      return PaymentOrderStatus.FAILED;
    case "CANCELLED":
    case "PARTIAL_CANCELLED":
      return PaymentOrderStatus.CANCELED;
    case "READY":
    case "PAY_PENDING":
    case "VIRTUAL_ACCOUNT_ISSUED":
    default:
      return PaymentOrderStatus.CHECKOUT_CREATED;
  }
}

export async function finalizePortonePaymentByPaymentId(paymentId: string) {
  const order = await db.paymentOrder.findFirst({
    where: {
      externalOrderId: paymentId,
      provider: PaymentProvider.PORTONE,
    },
  });

  if (!order) {
    throw new Error("Payment order not found.");
  }

  const payment = await getPortoneClient().getPayment({ paymentId });

  if (!isPaidPayment(payment)) {
    await markPortoneOrderStatus(paymentId, getOrderStateFromPaymentStatus(payment.status), payment);

    return {
      order,
      payment,
      paid: false as const,
      balance: await syncUserCreditBalances(order.userId),
    };
  }

  if (payment.amount.total !== order.amount) {
    throw new Error("Payment amount mismatch.");
  }

  if (payment.currency !== order.currency) {
    throw new Error("Payment currency mismatch.");
  }

  if (order.status !== PaymentOrderStatus.PAID) {
    await db.$transaction(async (tx) => {
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: PaymentOrderStatus.PAID,
          paidAt: new Date(payment.paidAt),
          rawPayload: JSON.parse(JSON.stringify(payment)),
        },
      });

      await grantUserCredits(
        order.userId,
        order.requestedCredits,
        CreditKind.PAID,
        `portone:${order.id}`,
        `portone_purchase:${order.productCode}`,
        tx,
        {
          paymentOrderId: order.id,
          type: CreditTransactionType.PURCHASE,
          metadata: JSON.parse(JSON.stringify(payment)),
        },
      );
    });
  }

  return {
    order,
    payment,
    paid: true as const,
    balance: await syncUserCreditBalances(order.userId),
  };
}

export async function reconcilePortoneWebhook(paymentId: string, eventType: string) {
  const payment = await getPortoneClient().getPayment({ paymentId });

  if (payment.status === "PAID") {
    return finalizePortonePaymentByPaymentId(paymentId);
  }

  await markPortoneOrderStatus(paymentId, getOrderStateFromPaymentStatus(payment.status), {
    eventType,
    payment,
  });

  const order = await db.paymentOrder.findFirst({
    where: {
      externalOrderId: paymentId,
      provider: PaymentProvider.PORTONE,
    },
  });

  if (!order) {
    throw new Error("Payment order not found.");
  }

  return {
    order,
    payment,
    paid: false as const,
    balance: await syncUserCreditBalances(order.userId),
  };
}

export type PortonePreparedOrder = PaymentOrder;
