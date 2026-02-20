import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

const TAG = 'DB';

export const prisma = new PrismaClient();

export async function initDb(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info(TAG, 'Database connected');
  } catch (err: any) {
    logger.error(TAG, `Database connection failed: ${err.message}`);
    logger.warn(TAG, 'Falling back to file-based state');
  }
}

export async function recordTrade(data: {
  market: string;
  marketQuestion: string;
  conditionId: string;
  slug: string;
  direction: 'UP' | 'DOWN';
  size: number;
  orderId?: string;
  status: string;
  mode: string;
  signalCombined: number;
  signalConfidence: number;
  signalMomentum?: number;
  signalMeanRev?: number;
  signalVolatility?: number;
  signalOrderFlow?: number;
  signalOracleLag?: number;
  balanceBefore: number;
}) {
  try {
    return await prisma.trade.create({ data });
  } catch (err: any) {
    logger.error(TAG, `Failed to record trade: ${err.message}`);
    return null;
  }
}

export async function resolveTrade(id: string, data: {
  won: boolean;
  pnl: number;
  balanceAfter: number;
}) {
  try {
    return await prisma.trade.update({
      where: { id },
      data: {
        ...data,
        status: 'FILLED',
        resolvedAt: new Date(),
      },
    });
  } catch (err: any) {
    logger.error(TAG, `Failed to resolve trade: ${err.message}`);
    return null;
  }
}

export async function saveBalanceSnapshot(data: {
  balance: number;
  dailyPnl: number;
  totalPnl: number;
  mode: string;
}) {
  try {
    return await prisma.balanceSnapshot.create({ data });
  } catch (err: any) {
    logger.error(TAG, `Failed to save balance snapshot: ${err.message}`);
    return null;
  }
}

export async function saveBotState(data: {
  balance: number;
  dailyPnl: number;
  lifetimeTrades: number;
  lifetimeWins: number;
  lifetimeLosses: number;
  lifetimePnl: number;
  startingBalance: number;
  mode: string;
}) {
  try {
    return await prisma.botState.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data },
    });
  } catch (err: any) {
    logger.error(TAG, `Failed to save bot state: ${err.message}`);
    return null;
  }
}

export async function logSignal(data: {
  market: string;
  conditionId: string;
  combined: number;
  direction?: string;
  confidence: number;
  shouldTrade: boolean;
  momentum?: number;
  meanReversion?: number;
  volatility?: number;
  orderFlow?: number;
  oracleLag?: number;
}) {
  try {
    return await prisma.signalLog.create({ data });
  } catch (err: any) {
    logger.error(TAG, `Failed to log signal: ${err.message}`);
    return null;
  }
}

export async function getRecentTrades(limit: number = 50) {
  return prisma.trade.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getStats() {
  return prisma.botState.findUnique({ where: { id: 'singleton' } });
}

export async function getBalanceHistory(hours: number = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return prisma.balanceSnapshot.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
  });
}
