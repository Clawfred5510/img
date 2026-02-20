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

async function main() {
  logger.info(TAG, `💰 IMG Bot starting... (paper=${config.paperTrade})`);
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
process.on('SIGTERM', () => {
  logger.info(TAG, 'Shutting down...');
  cleanup();
  disconnectBinance();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info(TAG, 'Interrupted, shutting down...');
  cleanup();
  disconnectBinance();
  process.exit(0);
});

main().catch(err => {
  logger.error(TAG, 'Fatal error', err);
  process.exit(1);
});
