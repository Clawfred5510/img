import dotenv from 'dotenv';
import * as path from 'path';

const envFile = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
dotenv.config({ path: envFile });

export const config = {
  // Polymarket
  polymarketHost: 'https://clob.polymarket.com',
  gammaHost: 'https://gamma-api.polymarket.com',
  chainId: 137,
  privateKey: process.env.POLYMARKET_PRIVATE_KEY || '',
  walletAddress: process.env.POLYMARKET_WALLET || '',

  // WebSockets
  clobWs: 'wss://ws-subscriptions-clob.polymarket.com/ws/',
  rtdsWs: 'wss://ws-live-data.polymarket.com',

  // Trading params
  paperTrade: process.env.PAPER_TRADE === 'true',
  defaultBetSize: parseFloat(process.env.BET_SIZE || '5'),
  maxBetSize: parseFloat(process.env.MAX_BET_SIZE || '25'),
  maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '50'),
  signalThreshold: parseFloat(process.env.SIGNAL_THRESHOLD || '0.25'),

  // Strategy weights — BACKTEST VALIDATED (576 markets, 48h, Feb 13-15 2026)
  weights: {
    momentum: 0.60,
    meanReversion: 0.00,
    volatility: 0.20,
    orderFlow: 0.20,
    oracleLag: 0.00,
  },

  // Strategy params — BACKTEST VALIDATED
  momentumWindow: 90,
  momentumThreshold: 0.0008,
  meanReversionThreshold: 0.002,
  volatilityMinThreshold: 0.0003,
  orderFlowImbalanceThreshold: 0.6,
  oracleLagThreshold: 0.001,

  // Price limits — don't buy when profit margin is too thin
  // At 0.75, a $5 bet profits $1.67 on win. At 0.90, only $0.56.
  maxBuyPrice: 0.75,  // Won't buy outcome tokens above this price

  // Kelly criterion — backtest-derived
  kellyFraction: 0.164,
  estimatedEdge: 0.30,
  estimatedWinRate: 0.80,

  // API
  apiPort: parseInt(process.env.BOT_API_PORT || '4001'),
  backendUrl: process.env.BACKEND_URL || 'http://localhost:4000',
  databaseUrl: process.env.DATABASE_URL || '',

  // Hard trade limit
  maxLifetimeTrades: parseInt(process.env.MAX_LIFETIME_TRADES || '20'),

  // Bot identity
  botName: 'IMG',
  botDescription: 'Infinite Money Glitch — Polymarket trading bot with multi-strategy signal engine',
};

export const instanceConfig = {
  stateFile: process.env.STATE_FILE || 'data/paper_state.json',
  instanceName: process.env.INSTANCE_NAME || 'img',
};
