/** Circular buffer for BTC price ticks — sized for ~5-10 ticks/sec over 5 min */
export interface PriceTick {
  price: number;
  timestamp: number;
}

const MAX_TICKS = 3000;
const ticks: PriceTick[] = [];
let chainlinkPrice: PriceTick | null = null;

export const priceStore = {
  addTick(price: number, ts: number = Date.now()) {
    ticks.push({ price, timestamp: ts });
    if (ticks.length > MAX_TICKS) ticks.shift();
  },

  setChainlink(price: number, ts: number = Date.now()) {
    chainlinkPrice = { price, timestamp: ts };
  },

  getChainlink(): PriceTick | null {
    return chainlinkPrice;
  },

  latest(): PriceTick | null {
    return ticks.length ? ticks[ticks.length - 1] : null;
  },

  recent(seconds: number): PriceTick[] {
    const cutoff = Date.now() - seconds * 1000;
    return ticks.filter(t => t.timestamp >= cutoff);
  },

  returnOverPeriod(seconds: number): number | null {
    const recent = this.recent(seconds);
    if (recent.length < 2) return null;
    const first = recent[0].price;
    const last = recent[recent.length - 1].price;
    return (last - first) / first;
  },

  volatility(seconds: number): number | null {
    const recent = this.recent(seconds);
    if (recent.length < 10) return null;
    const returns: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      returns.push((recent[i].price - recent[i - 1].price) / recent[i - 1].price);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  },

  tickCount(): number {
    return ticks.length;
  },
};
