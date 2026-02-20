import axios from 'axios';
import { Wallet } from 'ethers';
import WebSocket from 'ws';
import { ClobClient, Side, AssetType } from '@polymarket/clob-client';
import { config } from './config';
import { logger } from './logger';
import { priceStore } from './priceStore';
import { updateOrderBook, OrderBook } from './signals/orderFlow';

const TAG = 'POLYMARKET';

const PROXY_URL = process.env.POLYMARKET_PROXY_URL || '';
const PROXY_KEY = process.env.POLYMARKET_PROXY_KEY || '';

interface MarketInfo {
  conditionId: string;
  tokenIds: [string, string];
  slug: string;
  question: string;
  outcomes: [string, string];
  minSize: number;
  tickSize: string;
  active: boolean;
}

let currentMarket: MarketInfo | null = null;
let rtdsWs: WebSocket | null = null;
let readClient: ClobClient | null = null;
let proxyClient: ClobClient | null = null;
let apiCreds: any = null;

async function getClients(): Promise<{ read: ClobClient; trade: ClobClient }> {
  if (readClient && proxyClient) return { read: readClient, trade: proxyClient };

  const wallet = new Wallet(config.privateKey);
  const tempClient = new ClobClient(config.polymarketHost, config.chainId, wallet);
  apiCreds = await tempClient.deriveApiKey();
  logger.info(TAG, 'API credentials derived', { address: wallet.address });

  readClient = new ClobClient(config.polymarketHost, config.chainId, wallet, apiCreds);

  if (PROXY_URL) {
    proxyClient = new ClobClient(PROXY_URL, config.chainId, wallet, apiCreds);
    logger.info(TAG, 'Using proxy for order placement', { proxy: PROXY_URL });
  } else {
    proxyClient = readClient;
    logger.warn(TAG, 'No proxy configured — orders will go direct (may be geoblocked)');
  }

  return { read: readClient, trade: proxyClient };
}

export async function findActiveBtcMarket(): Promise<MarketInfo | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const currentWindowStart = Math.floor(now / 300) * 300;

    const slugsToTry = [
      `btc-updown-5m-${currentWindowStart}`,
      `btc-updown-5m-${currentWindowStart + 300}`,
      `btc-updown-5m-${currentWindowStart - 300}`,
    ];

    for (const slug of slugsToTry) {
      try {
        const { data: events } = await axios.get(`${config.gammaHost}/events`, {
          params: { slug },
        });

        if (!events || events.length === 0) continue;

        const event = events[0];
        const market = event.markets?.[0];
        if (!market || !market.acceptingOrders) continue;

        const tokenIds = JSON.parse(market.clobTokenIds || '[]');
        if (tokenIds.length < 2) continue;

        const info: MarketInfo = {
          conditionId: market.conditionId,
          tokenIds: [tokenIds[0], tokenIds[1]],
          slug: market.slug,
          question: market.question,
          outcomes: market.outcomes ? JSON.parse(market.outcomes) : ['Up', 'Down'],
          minSize: parseFloat(market.orderMinSize || '5'),
          tickSize: market.orderPriceMinTickSize || '0.01',
          active: true,
        };
        logger.info(TAG, `Found market: ${info.question}`, { slug: info.slug, conditionId: info.conditionId });
        currentMarket = info;
        return info;
      } catch {
        continue;
      }
    }

    logger.warn(TAG, 'No active BTC 5-min market found', { tried: slugsToTry });
    return null;
  } catch (err: any) {
    logger.error(TAG, 'Error finding market', err.message);
    return null;
  }
}

export async function fetchOrderBook(tokenId: string): Promise<OrderBook | null> {
  try {
    const { data } = await axios.get(`${config.polymarketHost}/book`, {
      params: { token_id: tokenId },
    });
    const book: OrderBook = {
      bids: (data.bids || []).map((b: any) => ({ price: parseFloat(b.price), size: parseFloat(b.size) })),
      asks: (data.asks || []).map((a: any) => ({ price: parseFloat(a.price), size: parseFloat(a.size) })),
    };
    updateOrderBook(book);
    return book;
  } catch (err: any) {
    logger.error(TAG, 'Error fetching orderbook', err.message);
    return null;
  }
}

export function connectRtdsPriceFeed() {
  if (rtdsWs) rtdsWs.close();

  rtdsWs = new WebSocket(config.rtdsWs);

  rtdsWs.on('open', () => {
    logger.info(TAG, 'RTDS WebSocket connected');
    rtdsWs!.send(JSON.stringify({
      action: 'subscribe',
      subscriptions: [
        { topic: 'crypto_prices', type: 'update', filters: 'btcusdt' },
        { topic: 'crypto_prices_chainlink', type: '*', filters: '{"symbol":"btc/usd"}' },
      ],
    }));
  });

  rtdsWs.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.topic === 'crypto_prices' && msg.payload?.symbol === 'btcusdt') {
        priceStore.addTick(msg.payload.value, msg.payload.timestamp || Date.now());
      } else if (msg.topic === 'crypto_prices_chainlink') {
        const val = msg.payload?.value || msg.payload?.price;
        if (val) priceStore.setChainlink(parseFloat(val), msg.timestamp || Date.now());
      }
    } catch {}
  });

  rtdsWs.on('close', () => {
    logger.warn(TAG, 'RTDS disconnected, reconnecting in 3s...');
    setTimeout(connectRtdsPriceFeed, 3000);
  });

  rtdsWs.on('error', (err) => {
    logger.error(TAG, 'RTDS error', err.message);
  });
}

let obPollInterval: ReturnType<typeof setInterval> | null = null;

export function connectClobFeed(tokenIds: string[]) {
  if (obPollInterval) clearInterval(obPollInterval);

  const pollOrderBook = async () => {
    for (const tokenId of tokenIds) {
      await fetchOrderBook(tokenId);
    }
  };

  pollOrderBook();
  obPollInterval = setInterval(pollOrderBook, 5000);
  logger.info(TAG, `Orderbook REST polling started for ${tokenIds.length} tokens`);
}

export interface TradeParams {
  tokenId: string;
  side: 'BUY';
  size: number;
  price?: number;
}

export async function placeTrade(params: TradeParams): Promise<{ success: boolean; orderId?: string; error?: string }> {
  if (config.paperTrade) {
    const orderId = `paper-${Date.now()}`;
    logger.info(TAG, `PAPER TRADE: BUY ${params.size} USDC of ${params.tokenId.slice(0, 10)}...`, params);
    return { success: true, orderId };
  }

  try {
    const { trade: client } = await getClients();

    let price = params.price;
    if (!price) {
      const book = await fetchOrderBook(params.tokenId);
      if (book && book.asks.length > 0) {
        price = book.asks[0].price;
      } else {
        return { success: false, error: 'No asks available' };
      }
    }

    const shares = Math.floor((params.size / price) * 100) / 100;

    if (!currentMarket) {
      return { success: false, error: 'No active market' };
    }

    logger.info(TAG, `LIVE TRADE: BUY ${shares} shares @ ${price} (${params.size} USDC)`, {
      tokenId: params.tokenId.slice(0, 16),
      price,
      shares,
      proxy: !!PROXY_URL,
    });

    const order = await client.createAndPostOrder({
      tokenID: params.tokenId,
      price: price,
      size: shares,
      side: Side.BUY,
      feeRateBps: 1000,
      nonce: 0,
    }, { tickSize: currentMarket.tickSize as any });

    if (order && order.orderID) {
      logger.info(TAG, `Order placed: ${order.orderID}`, order);
      return { success: true, orderId: order.orderID };
    } else if (order && (order as any).success === false) {
      const errMsg = (order as any).error || 'Order rejected';
      logger.warn(TAG, 'Order rejected', order);
      return { success: false, error: errMsg };
    } else {
      logger.info(TAG, 'Order response', order);
      return { success: true, orderId: (order as any)?.orderID || 'unknown' };
    }
  } catch (err: any) {
    logger.error(TAG, 'Trade failed', err.response?.data || err.message);
    return { success: false, error: err.response?.data?.error || err.message };
  }
}

export async function getBalance(): Promise<number> {
  try {
    const { read: client } = await getClients();
    const bal = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    return parseFloat(bal.balance || '0') / 1e6;
  } catch (err: any) {
    logger.error(TAG, 'Balance check failed', err.message);
    return 0;
  }
}

export function getCurrentMarket(): MarketInfo | null {
  return currentMarket;
}

export function cleanup() {
  if (obPollInterval) clearInterval(obPollInterval);
  if (rtdsWs) rtdsWs.close();
}
