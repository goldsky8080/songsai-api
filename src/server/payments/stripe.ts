import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { getEnv } from "@/lib/env";

export const STRIPE_CREDIT_PRODUCTS = [
  { code: "credit_110", credits: 110, amount: 11000, envKey: "STRIPE_PRICE_CREDIT_110" as const },
  { code: "credit_350", credits: 350, amount: 33000, envKey: "STRIPE_PRICE_CREDIT_350" as const },
  { code: "credit_590", credits: 590, amount: 55000, envKey: "STRIPE_PRICE_CREDIT_590" as const },
] as const;

export type StripeCreditProductCode = (typeof STRIPE_CREDIT_PRODUCTS)[number]["code"];

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  const env = getEnv();

  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe is not configured.");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  }

  return stripeClient;
}

export function getStripeCreditProducts() {
  const env = getEnv();

  return STRIPE_CREDIT_PRODUCTS.map((product) => ({
    code: product.code,
    credits: product.credits,
    amount: product.amount,
    currency: "KRW",
    priceId: env[product.envKey],
    enabled: Boolean(env[product.envKey]),
  }));
}

export function getStripeCreditProductByCode(code: string) {
  return getStripeCreditProducts().find((product) => product.code === code) ?? null;
}

export function getStripeCheckoutUrls() {
  const env = getEnv();
  const frontendBase = env.FRONTEND_URL ?? env.APP_URL;

  return {
    successUrl: env.STRIPE_CHECKOUT_SUCCESS_URL ?? `${frontendBase}/pricing?checkout=success`,
    cancelUrl: env.STRIPE_CHECKOUT_CANCEL_URL ?? `${frontendBase}/pricing?checkout=cancel`,
  };
}

export function createExternalOrderId() {
  return `pay_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
