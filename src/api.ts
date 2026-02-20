import express from 'express';
import { config } from './config';
import { logger } from './logger';
import { getStats, getTrades, getBalance, getStartingBalance } from './tradeManager';
import { priceStore } from './priceStore';
import { getCurrentMarket } from './polymarket';
import { computeSignal } from './signals';
import { getRecentTrades, getBalanceHistory, getStats as getDbStats } from './db';

const TAG = 'API';

export function startApi() {
  const app = express();
  app.use(express.json());

  // Enable CORS for dashboard
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });

  app.get('/health', (_, res) => res.json({
    status: 'ok',
    bot: config.botName,
    paper: config.paperTrade,
    uptime: process.uptime(),
    balance: getBalance(),
    startingBalance: getStartingBalance(),
  }));

  app.get('/stats', (_, res) => res.json(getStats()));

  app.get('/trades', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    try {
      // Try database first
      const dbTrades = await getRecentTrades(limit);
      if (dbTrades.length > 0) {
        res.json(dbTrades);
        return;
      }
    } catch {}
    // Fallback to in-memory
    const all = getTrades();
    res.json(all.slice(-limit));
  });

  app.get('/signal', (_, res) => res.json(computeSignal()));

  app.get('/market', (_, res) => {
    const market = getCurrentMarket();
    const price = priceStore.latest();
    res.json({ market, btcPrice: price?.price, priceAge: price ? Date.now() - price.timestamp : null });
  });

  app.get('/config', (_, res) => res.json({
    paperTrade: config.paperTrade,
    betSize: config.defaultBetSize,
    maxBetSize: config.maxBetSize,
    maxDailyLoss: config.maxDailyLoss,
    signalThreshold: config.signalThreshold,
    weights: config.weights,
  }));

  // Dashboard endpoints
  app.get('/api/dashboard', async (_, res) => {
    try {
      const [stats, dbStats, trades, balanceHistory] = await Promise.all([
        Promise.resolve(getStats()),
        getDbStats(),
        getRecentTrades(20),
        getBalanceHistory(24),
      ]);

      const market = getCurrentMarket();
      const price = priceStore.latest();
      const signal = computeSignal();

      res.json({
        stats: dbStats || stats,
        recentTrades: trades,
        balanceHistory,
        currentMarket: market,
        btcPrice: price?.price,
        signal: {
          combined: signal.combined,
          direction: signal.direction,
          confidence: signal.confidence,
          shouldTrade: signal.shouldTrade,
          components: signal.components,
        },
        uptime: process.uptime(),
        mode: config.paperTrade ? 'paper' : 'live',
      });
    } catch (err: any) {
      logger.error(TAG, `Dashboard API error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/trades', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    try {
      const trades = await getRecentTrades(limit);
      res.json(trades);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/balance-history', async (req, res) => {
    const hours = parseInt(req.query.hours as string) || 24;
    try {
      const history = await getBalanceHistory(hours);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const server = app.listen(config.apiPort, () => {
    logger.info(TAG, `IMG API running on port ${config.apiPort}`);
  });
  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(TAG, `Port ${config.apiPort} in use, trying ${config.apiPort + 1}`);
      app.listen(config.apiPort + 1, () => {
        logger.info(TAG, `IMG API running on fallback port ${config.apiPort + 1}`);
      });
    } else {
      logger.error(TAG, `API server error: ${err.message}`);
    }
  });
}
