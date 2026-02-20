import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { logger } from './logger';
import { initDb } from './db';
import {
  findActiveBtcMarket,
  connectRtdsPriceFeed,
  connectClobFeed,
  fetchOrderBook,
  cleanup,
} from './polymarket';
import { connectBinanceFeed, disconnectBinance } from './binance';
import { tradingTick, resetDaily } from './tradeManager';
import { startApi } from './api';

const TAG = 'MAIN';

// Startup lock to prevent duplicate instances
const LOCK_FILE = path.join(__dirname, '..', 'data', 'img.lock');

function acquireLock(): boolean {
  try {
    const dir = path.dirname(LOCK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Check if lock exists and if the PID is still alive
    if (fs.existsSync(LOCK_FILE)) {
      const oldPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim());
      try {
        process.kill(oldPid, 0); // Check if process exists
        logger.error(TAG, `Another instance is running (PID ${oldPid}). Exiting.`);
        return false;
      } catch {
        // Process doesn't exist, stale lock
        logger.warn(TAG, `Removing stale lock (PID ${oldPid})`);
      }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    return true;
  } catch (err: any) {
    logger.error(TAG, `Lock error: ${err.message}`);
    return false;
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

async function main() {
  if (!acquireLock()) {
    process.exit(1);
  }

  logger.info(TAG, `💰 IMG Bot starting... (paper=${config.paperTrade}) [PID ${process.pid}]`);
  logger.info(TAG, `Signal threshold: ${config.signalThreshold}, Max bet: ${config.maxBetSize} USDC`);

  // Initialize database
  await initDb();

  // Start API server
  startApi();

  // Connect to real-time price feeds
  connectBinanceFeed();
  connectRtdsPriceFeed();

  // Find and monitor markets
  let market = await findActiveBtcMarket();

  if (market) {
    connectClobFeed(market.tokenIds);
  } else {
    logger.warn(TAG, 'No market found — will keep scanning...');
  }

  // Market discovery loop
  setInterval(async () => {
    const newMarket = await findActiveBtcMarket();
    if (newMarket && (!market || newMarket.conditionId !== market.conditionId)) {
      logger.info(TAG, `🆕 New market detected: ${newMarket.question}`);
      market = newMarket;
      connectClobFeed(market.tokenIds);
    }
  }, 15_000);

  // Orderbook polling
  setInterval(async () => {
    if (market) {
      await fetchOrderBook(market.tokenIds[0]);
    }
  }, 10_000);

  // Trading loop — evaluate signals every 5 seconds
  setInterval(() => {
    tradingTick().catch(err => logger.error(TAG, 'Trading tick error', err.message));
  }, 5_000);

  // Price logging every 60s
  setInterval(() => {
    const { priceStore } = require('./priceStore');
    const tick = priceStore.latest();
    if (tick) {
      const vol = priceStore.volatility(60);
      const ret60 = priceStore.returnOverPeriod(60);
      const ret300 = priceStore.returnOverPeriod(300);
      const fs = require('fs');
      const path = require('path');
      const logFile = path.join(__dirname, '..', 'data', 'prices.jsonl');
      const dir = path.dirname(logFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const entry = {
        ts: Date.now(),
        price: tick.price,
        chainlink: priceStore.getChainlink()?.price || null,
        vol60s: vol,
        ret60s: ret60,
        ret300s: ret300,
        ticks: priceStore.tickCount(),
      };
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    }
  }, 60_000);

  // Reset daily counters at midnight UTC
  const msToMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  };
  setTimeout(() => {
    resetDaily();
    setInterval(resetDaily, 24 * 60 * 60 * 1000);
  }, msToMidnight());

  logger.info(TAG, '💰 IMG Bot running!');
}

// Graceful shutdown
function shutdown(signal: string) {
  logger.info(TAG, `${signal} received, shutting down...`);
  releaseLock();
  cleanup();
  disconnectBinance();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('exit', releaseLock);

main().catch(err => {
  logger.error(TAG, 'Fatal error', err);
  process.exit(1);
});
