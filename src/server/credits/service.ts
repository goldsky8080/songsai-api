import {
  CreditGrantStatus,
  CreditKind,
  CreditTransactionStatus,
  CreditTransactionType,
  type Prisma,
} from "@prisma/client";

import { db } from "@/lib/db";
import { FREE_CREDIT_DAYS, getMusicGenerationCost } from "@/server/credits/constants";
import type { MusicProvider } from "@/server/music/types";

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

export class InsufficientCreditsError extends Error {
  requiredCredits: number;
  currentCredits: number;

  constructor(requiredCredits: number, currentCredits: number) {
    super("Insufficient credits.");
    this.name = "InsufficientCreditsError";
    this.requiredCredits = requiredCredits;
    this.currentCredits = currentCredits;
  }
}

export async function syncUserCreditBalances(userId: string, tx?: Prisma.TransactionClient) {
  const client = tx ?? db;
  const now = new Date();

  await client.creditGrant.updateMany({
    where: {
      userId,
      status: CreditGrantStatus.ACTIVE,
      expiresAt: {
        lte: now,
      },
      remainingAmount: {
        gt: 0,
      },
    },
    data: {
      remainingAmount: 0,
      status: CreditGrantStatus.EXPIRED,
      updatedAt: now,
    },
  });

  const grants = await client.creditGrant.findMany({
    where: {
      userId,
      status: CreditGrantStatus.ACTIVE,
      remainingAmount: {
        gt: 0,
      },
      OR: [
        { expiresAt: null },
        {
          expiresAt: {
            gt: now,
          },
        },
      ],
    },
    select: {
      creditKind: true,
      remainingAmount: true,
    },
  });

  const freeCredits = grants
    .filter((grant) => grant.creditKind === CreditKind.FREE)
    .reduce((sum, grant) => sum + grant.remainingAmount, 0);

  const paidCredits = grants
    .filter((grant) => grant.creditKind === CreditKind.PAID)
    .reduce((sum, grant) => sum + grant.remainingAmount, 0);

  await client.user.update({
    where: { id: userId },
    data: {
      freeCredits,
      paidCredits,
    },
  });

  return {
    freeCredits,
    paidCredits,
    totalCredits: freeCredits + paidCredits,
  };
}

export function getCreditExpiryDate(creditKind: CreditKind) {
  if (creditKind === CreditKind.FREE) {
    return addDays(new Date(), FREE_CREDIT_DAYS);
  }

  return null;
}

export async function grantUserCredits(
  userId: string,
  amount: number,
  creditKind: CreditKind,
  source: string,
  memo: string,
  tx: Prisma.TransactionClient,
  options?: {
    paymentOrderId?: string;
    musicId?: string;
    videoId?: string;
    type?: CreditTransactionType;
    metadata?: Prisma.InputJsonValue;
  },
) {
  const currentUser = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      freeCredits: true,
      paidCredits: true,
    },
  });

  const nextFreeCredits =
    creditKind === CreditKind.FREE ? currentUser.freeCredits + amount : currentUser.freeCredits;
  const nextPaidCredits =
    creditKind === CreditKind.PAID ? currentUser.paidCredits + amount : currentUser.paidCredits;

  await tx.creditGrant.create({
    data: {
      userId,
      creditKind,
      amount,
      remainingAmount: amount,
      expiresAt: getCreditExpiryDate(creditKind),
      source,
      paymentOrderId: options?.paymentOrderId,
    },
  });

  await tx.creditTransaction.create({
    data: {
      userId,
      musicId: options?.musicId,
      videoId: options?.videoId,
      paymentOrderId: options?.paymentOrderId,
      amount,
      creditKind,
      type: options?.type ?? CreditTransactionType.PURCHASE,
      status: CreditTransactionStatus.COMPLETED,
      balanceAfter: creditKind === CreditKind.FREE ? nextFreeCredits : nextPaidCredits,
      memo,
      metadata: options?.metadata,
    },
  });

  await tx.user.update({
    where: { id: userId },
    data: {
      freeCredits: nextFreeCredits,
      paidCredits: nextPaidCredits,
    },
  });

  return {
    nextFreeCredits,
    nextPaidCredits,
  };
}

async function consumeCredits(
  userId: string,
  amount: number,
  memo: string,
  tx: Prisma.TransactionClient,
  musicId?: string,
) {
  const balances = await syncUserCreditBalances(userId, tx);

  if (balances.totalCredits < amount) {
    throw new InsufficientCreditsError(amount, balances.totalCredits);
  }

  let remainingCost = amount;

  const grants = await tx.creditGrant.findMany({
    where: {
      userId,
      status: CreditGrantStatus.ACTIVE,
      remainingAmount: {
        gt: 0,
      },
      OR: [
        { expiresAt: null },
        {
          expiresAt: {
            gt: new Date(),
          },
        },
      ],
    },
    orderBy: [{ creditKind: "asc" }, { expiresAt: "asc" }, { createdAt: "asc" }],
  });

  let freeSpent = 0;
  let paidSpent = 0;

  for (const grant of grants) {
    if (remainingCost <= 0) {
      break;
    }

    const deductAmount = Math.min(grant.remainingAmount, remainingCost);
    const nextRemaining = grant.remainingAmount - deductAmount;

    await tx.creditGrant.update({
      where: { id: grant.id },
      data: {
        remainingAmount: nextRemaining,
        lastUsedAt: new Date(),
        status: nextRemaining === 0 ? CreditGrantStatus.CONSUMED : CreditGrantStatus.ACTIVE,
      },
    });

    if (grant.creditKind === CreditKind.FREE) {
      freeSpent += deductAmount;
    } else {
      paidSpent += deductAmount;
    }

    remainingCost -= deductAmount;
  }

  const nextFreeCredits = balances.freeCredits - freeSpent;
  const nextPaidCredits = balances.paidCredits - paidSpent;

  if (freeSpent > 0) {
    await tx.creditTransaction.create({
      data: {
        userId,
        musicId,
        amount: -freeSpent,
        creditKind: CreditKind.FREE,
        type: CreditTransactionType.USAGE,
        status: CreditTransactionStatus.COMPLETED,
        balanceAfter: nextFreeCredits,
        memo,
      },
    });
  }

  if (paidSpent > 0) {
    await tx.creditTransaction.create({
      data: {
        userId,
        musicId,
        amount: -paidSpent,
        creditKind: CreditKind.PAID,
        type: CreditTransactionType.USAGE,
        status: CreditTransactionStatus.COMPLETED,
        balanceAfter: nextPaidCredits,
        memo,
      },
    });
  }

  await tx.user.update({
    where: { id: userId },
    data: {
      freeCredits: nextFreeCredits,
      paidCredits: nextPaidCredits,
    },
  });

  return {
    chargedAmount: amount,
    freeSpent,
    paidSpent,
  };
}

export async function consumeMusicGenerationCredits(
  userId: string,
  musicId: string,
  provider: MusicProvider,
  tx: Prisma.TransactionClient,
) {
  return consumeCredits(userId, getMusicGenerationCost(provider), `music_generation:${musicId}`, tx, musicId);
}

async function refundUsageCreditsByMemo(userId: string, usageMemo: string, refundMemoPrefix: string, musicId?: string) {
  const usageTransactions = await db.creditTransaction.findMany({
    where: {
      userId,
      type: CreditTransactionType.USAGE,
      status: CreditTransactionStatus.COMPLETED,
      memo: usageMemo,
    },
  });

  if (usageTransactions.length === 0) {
    return;
  }

  await db.$transaction(async (tx) => {
    await syncUserCreditBalances(userId, tx);

    const currentUser = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        freeCredits: true,
        paidCredits: true,
      },
    });

    let freeCredits = currentUser.freeCredits;
    let paidCredits = currentUser.paidCredits;

    for (const entry of usageTransactions) {
      const refundAmount = Math.abs(entry.amount);
      const creditKind = entry.creditKind ?? CreditKind.PAID;

      await tx.creditGrant.create({
        data: {
          userId,
          creditKind,
          amount: refundAmount,
          remainingAmount: refundAmount,
          expiresAt: getCreditExpiryDate(creditKind),
          source: `refund:${usageMemo}`,
        },
      });

      if (creditKind === CreditKind.FREE) {
        freeCredits += refundAmount;
      } else {
        paidCredits += refundAmount;
      }

      await tx.creditTransaction.create({
        data: {
          userId,
          musicId,
          amount: refundAmount,
          creditKind,
          type: CreditTransactionType.REFUND,
          status: CreditTransactionStatus.COMPLETED,
          balanceAfter: creditKind === CreditKind.FREE ? freeCredits : paidCredits,
          memo: `${refundMemoPrefix}:${entry.id}`,
        },
      });

      await tx.creditTransaction.update({
        where: { id: entry.id },
        data: {
          status: CreditTransactionStatus.CANCELLED,
          memo: `${usageMemo}:refunded`,
        },
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        freeCredits,
        paidCredits,
      },
    });
  });
}

export async function refundMusicGenerationCredits(userId: string, musicId: string) {
  await refundUsageCreditsByMemo(
    userId,
    `music_generation:${musicId}`,
    `music_generation_refund:${musicId}`,
    musicId,
  );
}
