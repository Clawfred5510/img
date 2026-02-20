/**
 * Order Flow Signal: Monitor Polymarket orderbook imbalance.
 * Heavy one-sided volume → signal in that direction.
 * Returns: -1 (heavy sell/down pressure) to +1 (heavy buy/up pressure)
 */

export interface OrderBook {
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
}

let currentBook: OrderBook | null = null;

export function updateOrderBook(book: OrderBook) {
  currentBook = book;
}

export function orderFlowSignal(): number {
  if (!currentBook) return 0;

  const bidVolume = currentBook.bids.reduce((sum, b) => sum + b.size * b.price, 0);
  const askVolume = currentBook.asks.reduce((sum, a) => sum + a.size * (1 - a.price), 0);
  const total = bidVolume + askVolume;

  if (total < 10) return 0;

  const imbalance = (bidVolume - askVolume) / total;

  if (Math.abs(imbalance) < 0.2) return 0;
  return Math.min(Math.max(imbalance * 2, -1), 1);
}
