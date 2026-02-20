/**
 * Real-time BTC/USD price feed via Coinbase WebSocket
 * Falls back to Kraken, then Binance.US
 */
import WebSocket from 'ws';
import { priceStore } from './priceStore';
import { logger } from './logger';

const TAG = 'PRICEFEED';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let tickCount = 0;
let lastLogTime = 0;
let currentExchange = '';

interface ExchangeConfig {
  name: string;
  url: string;
  subscribe: any;
  parse: (msg: any) => { price: number; ts: number } | null;
}

const exchanges: ExchangeConfig[] = [
  {
    name: 'Coinbase',
    url: 'wss://ws-feed.exchange.coinbase.com',
    subscribe: {
      type: 'subscribe',
      channels: [
        { name: 'matches', product_ids: ['BTC-USD'] },
        { name: 'ticker', product_ids: ['BTC-USD'] },
      ],
    },
    parse: (msg) => {
      if (msg.type === 'match' && msg.product_id === 'BTC-USD' && msg.price) {
        return { price: parseFloat(msg.price), ts: msg.time ? new Date(msg.time).getTime() : Date.now() };
      }
      if (msg.type === 'ticker' && msg.product_id === 'BTC-USD' && msg.price) {
        return { price: parseFloat(msg.price), ts: msg.time ? new Date(msg.time).getTime() : Date.now() };
      }
      return null;
    },
  },
  {
    name: 'Kraken',
    url: 'wss://ws.kraken.com',
    subscribe: {
      event: 'subscribe',
      pair: ['XBT/USD'],
      subscription: { name: 'trade' },
    },
    parse: (msg) => {
      if (Array.isArray(msg) && msg.length >= 4 && msg[2] === 'trade') {
        const trades = msg[1];
        if (Array.isArray(trades) && trades.length > 0) {
          const last = trades[trades.length - 1];
          return { price: parseFloat(last[0]), ts: parseFloat(last[2]) * 1000 };
        }
      }
      return null;
    },
  },
  {
    name: 'Binance.US',
    url: 'wss://stream.binance.us:9443/ws/btcusdt@trade',
    subscribe: null,
    parse: (msg) => {
      if (msg.e === 'trade' && msg.p) {
        return { price: parseFloat(msg.p), ts: msg.T || Date.now() };
      }
      return null;
    },
  },
];

let exchangeIndex = 0;

function connectExchange(idx: number) {
  if (idx >= exchanges.length) {
    logger.error(TAG, 'All exchanges failed, retrying from start in 10s...');
    setTimeout(() => connectExchange(0), 10_000);
    return;
  }

  const ex = exchanges[idx];
  exchangeIndex = idx;
  currentExchange = ex.name;

  if (ws) { try { ws.close(); } catch {} }
  if (reconnectTimer) clearTimeout(reconnectTimer);

  logger.info(TAG, `Connecting to ${ex.name}...`);
  ws = new WebSocket(ex.url);

  ws.on('open', () => {
    logger.info(TAG, `${ex.name} BTC price feed connected`);
    tickCount = 0;
    if (ex.subscribe) {
      ws!.send(JSON.stringify(ex.subscribe));
    }
  });

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      const tick = ex.parse(msg);
      if (tick) {
        priceStore.addTick(tick.price, tick.ts);
        tickCount++;

        const now = Date.now();
        if (now - lastLogTime > 30_000) {
          lastLogTime = now;
          const vol = priceStore.volatility(60);
          const ret = priceStore.returnOverPeriod(60);
          logger.info(TAG, `BTC: $${tick.price.toFixed(2)} | 60s ret: ${ret !== null ? (ret * 100).toFixed(4) + '%' : 'n/a'} | vol: ${vol !== null ? (vol * 100).toFixed(4) + '%' : 'n/a'} | ticks: ${priceStore.tickCount()}`);
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    if (tickCount === 0) {
      logger.warn(TAG, `${ex.name} disconnected with 0 ticks, trying next exchange...`);
      reconnectTimer = setTimeout(() => connectExchange(idx + 1), 2000);
    } else {
      logger.warn(TAG, `${ex.name} disconnected (had ${tickCount} ticks), reconnecting...`);
      reconnectTimer = setTimeout(() => connectExchange(idx), 3000);
    }
  });

  ws.on('error', (err) => {
    logger.error(TAG, `${ex.name} WS error: ${err.message}`);
  });
}

export function connectBinanceFeed() {
  connectExchange(0);
}

export function disconnectBinance() {
  if (ws) { try { ws.close(); } catch {} }
  if (reconnectTimer) clearTimeout(reconnectTimer);
}

export function getCurrentExchange(): string {
  return currentExchange;
}
