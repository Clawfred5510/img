import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { logger } from './logger';
import { placeTrade, getCurrentMarket } from './polymarket';
import { computeSignal, kellyBetSize, SignalResult } from './signals';
import { recordTrade, resolveTrade, saveBotState, saveBalanceSnapshot, logSignal } from './db';
import { redeemWinnings } from './redeem';

const TAG = 'TRADER';

interface TradeRecord {
  id: string;
  dbId?: string; // Prisma record ID
  timestamp: number;
  market: string;
  marketQuestion: string;
  conditionId: string;
  direction: 'UP' | 'DOWN';
  size: number;
  signal: SignalResult;
  orderId?: string;
  status: 'PLACED' | 'FILLED' | 'FAILED';
  pnl?: number;
}

import { instanceConfig } from './config';
const STATE_FILE = path.join(__dirname, '..', instanceConfig.stateFile);

interface PaperState {
  balance: number;
  dailyPnl: number;
  trades: TradeRecord[];
  tradedMarkets: string[];
  lastSaved: number;
  lifetimeTrades: number;
  lifetimeWins: number;
  lifetimeLosses: number;
  lifetimePnl: number;
}

function loadState(): PaperState | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (err: any) {
    logger.error(TAG, `Failed to load state: ${err.message}`);
  }
  return null;
}

function saveState() {
  try {
    const state: PaperState = {
      balance: paperBalance,
      dailyPnl,
      trades,
      tradedMarkets: [...tradedMarkets],
      lastSaved: Date.now(),
      lifetimeTrades,
      lifetimeWins,
      lifetimeLosses,
      lifetimePnl,
    };
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    // Also persist to database
    saveBotState({
      balance: paperBalance,
      dailyPnl,
      lifetimeTrades,
      lifetimeWins,
      lifetimeLosses,
      lifetimePnl,
      startingBalance: STARTING_BALANCE,
      mode: config.paperTrade ? 'paper' : 'live',
    });
  } catch (err: any) {
    logger.error(TAG, `Failed to save state: ${err.message}`);
  }
}

const STARTING_BALANCE = parseFloat(process.env.STARTING_BALANCE || '55');

const savedState = loadState();
const trades: TradeRecord[] = savedState?.trades || [];
let dailyPnl = savedState?.dailyPnl || 0;
let paperBalance = savedState?.balance || STARTING_BALANCE;
let lastTradeTime = 0;
const MIN_TRADE_INTERVAL = 5_000;
const tradedMarkets = new Set<string>(savedState?.tradedMarkets || []);

let lifetimeTrades = savedState?.lifetimeTrades || 0;
let lifetimeWins = savedState?.lifetimeWins || 0;
let lifetimeLosses = savedState?.lifetimeLosses || 0;
let lifetimePnl = savedState?.lifetimePnl || 0;

if (savedState) {
  logger.info(TAG, `Loaded saved state: Balance=$${paperBalance.toFixed(2)}, Trades=${lifetimeTrades}, PnL=$${lifetimePnl.toFixed(2)}`);
} else {
  logger.info(TAG, `Starting fresh: Balance=$${STARTING_BALANCE}`);
}

export function getDailyPnl(): number { return dailyPnl; }
export function getBalance(): number { return paperBalance; }
export function getStartingBalance(): number { return STARTING_BALANCE; }
export function getTrades(): TradeRecord[] { return trades; }
export function getStats() {
  return {
    totalTrades: lifetimeTrades,
    wins: lifetimeWins,
    losses: lifetimeLosses,
    winRate: lifetimeTrades > 0 ? lifetimeWins / lifetimeTrades : 0,
    dailyPnl,
    totalPnl: lifetimePnl,
    balance: paperBalance,
    startingBalance: STARTING_BALANCE,
    returnPct: ((paperBalance - STARTING_BALANCE) / STARTING_BALANCE * 100).toFixed(2) + '%',
    lastTrade: trades[trades.length - 1] || null,
    sessionTrades: trades.length,
  };
}

export async function tradingTick(): Promise<void> {
  if (lifetimeTrades >= config.maxLifetimeTrades) {
    return;
  }

  if (dailyPnl <= -config.maxDailyLoss) {
    logger.warn(TAG, `Daily loss limit hit: ${dailyPnl.toFixed(2)} USDC. Stopping.`);
    return;
  }

  if (Date.now() - lastTradeTime < MIN_TRADE_INTERVAL) return;

  const market = getCurrentMarket();
  if (!market || !market.active) return;

  const signal = computeSignal();

  if (!tradedMarkets.has(market.conditionId + '_logged')) {
    tradedMarkets.add(market.conditionId + '_logged');
    logSignalData(market, signal);
  }

  if (!signal.shouldTrade || !signal.direction) return;
  if (tradedMarkets.has(market.conditionId)) return;

  const size = kellyBetSize(signal.confidence);
  if (size < market.minSize) return;

  if (size > paperBalance) {
    logger.warn(TAG, `Insufficient balance: $${paperBalance.toFixed(2)} < $${size.toFixed(2)}`);
    return;
  }

  const tokenId = signal.direction === 'UP' ? market.tokenIds[0] : market.tokenIds[1];

  logger.info(TAG, `Signal: ${signal.direction} (${signal.confidence.toFixed(3)}) — Betting ${size.toFixed(2)} USDC`);

  const result = await placeTrade({ tokenId, side: 'BUY', size });

  const record: TradeRecord = {
    id: `trade-${Date.now()}`,
    timestamp: Date.now(),
    market: market.slug,
    marketQuestion: market.question,
    conditionId: market.conditionId,
    direction: signal.direction,
    size,
    signal,
    orderId: result.orderId,
    status: result.success ? 'PLACED' : 'FAILED',
  };

  trades.push(record);
  lastTradeTime = Date.now();
  tradedMarkets.add(market.conditionId);
  lifetimeTrades++;

  if (!result.success) {
    logger.error(TAG, `Trade failed: ${result.error}`);
    return;
  }

  // Record trade to database (replaces Telegram notification)
  const dbRecord = await recordTrade({
    market: market.slug,
    marketQuestion: market.question,
    conditionId: market.conditionId,
    slug: market.slug,
    direction: signal.direction,
    size,
    orderId: result.orderId,
    status: result.success ? 'PLACED' : 'FAILED',
    mode: config.paperTrade ? 'paper' : 'live',
    signalCombined: signal.combined,
    signalConfidence: signal.confidence,
    signalMomentum: signal.components.momentum,
    signalMeanRev: signal.components.meanReversion,
    signalVolatility: signal.components.volatility,
    signalOrderFlow: signal.components.orderFlow,
    signalOracleLag: signal.components.oracleLag,
    balanceBefore: paperBalance,
  });

  if (dbRecord) {
    record.dbId = dbRecord.id;
  }

  paperBalance -= size;
  logger.info(TAG, `Balance: $${paperBalance.toFixed(2)} (-$${size.toFixed(2)} bet)`);
  saveState();

  // Take balance snapshot
  saveBalanceSnapshot({
    balance: paperBalance,
    dailyPnl,
    totalPnl: lifetimePnl,
    mode: config.paperTrade ? 'paper' : 'live',
  });

  setTimeout(() => resolvePaperTrade(record), 5.5 * 60 * 1000);
}

async function resolvePaperTrade(trade: TradeRecord) {
  try {
    const axios = (await import('axios')).default;
    const { data: events } = await axios.get(`https://gamma-api.polymarket.com/events`, {
      params: { slug: trade.market },
    });

    const market = events?.[0]?.markets?.[0];
    if (!market) {
      logger.warn(TAG, `Could not find market ${trade.market} for resolution, retrying...`);
      setTimeout(() => resolvePaperTrade(trade), 60_000);
      return;
    }

    const prices = JSON.parse(market.outcomePrices || '["0.5","0.5"]');
    const upPrice = parseFloat(prices[0]);

    if (upPrice > 0.9) {
      logResolution(trade.market, 'UP', upPrice);
      await settleTrade(trade, trade.direction === 'UP');
    } else if (upPrice < 0.1) {
      logResolution(trade.market, 'DOWN', upPrice);
      await settleTrade(trade, trade.direction === 'DOWN');
    } else {
      setTimeout(() => resolvePaperTrade(trade), 60_000);
    }
  } catch (err: any) {
    logger.error(TAG, `Error resolving trade: ${err.message}`);
    setTimeout(() => resolvePaperTrade(trade), 60_000);
  }
}

async function settleTrade(trade: TradeRecord, won: boolean) {
  const payout = won ? trade.size * 2 : 0;
  const pnl = payout - trade.size;

  trade.pnl = pnl;
  trade.status = 'FILLED';
  paperBalance += payout;
  dailyPnl += pnl;
  lifetimePnl += pnl;
  if (won) lifetimeWins++;
  else lifetimeLosses++;

  const winRate = lifetimeTrades > 0 ? lifetimeWins / lifetimeTrades : 0;

  const emoji = won ? '✅' : '❌';
  logger.info(TAG, `${emoji} ${trade.direction} on ${trade.marketQuestion} → ${won ? 'WON' : 'LOST'} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | Balance: $${paperBalance.toFixed(2)} | WR: ${(winRate * 100).toFixed(1)}%`);
  saveState();

  // Resolve trade in database (replaces Telegram result notification)
  if (trade.dbId) {
    await resolveTrade(trade.dbId, {
      won,
      pnl,
      balanceAfter: paperBalance,
    });
  }

  // Auto-redeem winning tokens for USDC
  if (won && !config.paperTrade && trade.conditionId) {
    const tokenId = trade.direction === 'UP'
      ? getCurrentMarket()?.tokenIds[0] || ''
      : getCurrentMarket()?.tokenIds[1] || '';
    if (tokenId) {
      logger.info(TAG, `Auto-redeeming winnings for ${trade.marketQuestion}...`);
      // Delay slightly to ensure on-chain settlement
      setTimeout(async () => {
        try {
          await redeemWinnings(tokenId, trade.conditionId);
        } catch (err: any) {
          logger.error(TAG, `Auto-redeem failed: ${err.message}`);
        }
      }, 30_000); // 30s delay for settlement
    }
  }

  // Take balance snapshot after resolution
  saveBalanceSnapshot({
    balance: paperBalance,
    dailyPnl,
    totalPnl: lifetimePnl,
    mode: config.paperTrade ? 'paper' : 'live',
  });

  if (lifetimeTrades >= config.maxLifetimeTrades) {
    logger.warn(TAG, `TRADE LIMIT REACHED: ${lifetimeTrades}/${config.maxLifetimeTrades}`);
  }
}

function logResolution(slug: string, outcome: 'UP' | 'DOWN', upPrice: number) {
  const entry = { ts: Date.now(), market: slug, outcome, upPrice };
  const resLog = path.join(__dirname, '..', 'data', 'resolutions.jsonl');
  try {
    fs.appendFileSync(resLog, JSON.stringify(entry) + '\n');
  } catch {}
}

const SIGNAL_LOG = path.join(__dirname, '..', 'data', 'signals.jsonl');

function logSignalData(market: any, signal: SignalResult) {
  const entry = {
    ts: Date.now(),
    market: market.slug,
    conditionId: market.conditionId,
    question: market.question,
    signal: {
      combined: signal.combined,
      direction: signal.direction,
      confidence: signal.confidence,
      shouldTrade: signal.shouldTrade,
      components: signal.components,
    },
  };

  try {
    const dir = path.dirname(SIGNAL_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(SIGNAL_LOG, JSON.stringify(entry) + '\n');
    logger.info(TAG, `Signal logged: ${market.question} → combined=${signal.combined.toFixed(3)} dir=${signal.direction || 'NONE'}`, signal.components);
  } catch (err: any) {
    logger.error(TAG, `Failed to log signal: ${err.message}`);
  }

  // Also log to database
  logSignal({
    market: market.slug,
    conditionId: market.conditionId,
    combined: signal.combined,
    direction: signal.direction || undefined,
    confidence: signal.confidence,
    shouldTrade: signal.shouldTrade,
    momentum: signal.components.momentum,
    meanReversion: signal.components.meanReversion,
    volatility: signal.components.volatility,
    orderFlow: signal.components.orderFlow,
    oracleLag: signal.components.oracleLag,
  });
}

export function resetDaily() {
  dailyPnl = 0;
  logger.info(TAG, 'Daily counters reset');
}
