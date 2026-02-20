import { priceStore } from '../priceStore';
import { config } from '../config';

/**
 * Oracle Lag Signal: Compare CEX real-time price vs Chainlink oracle price.
 * If CEX has already moved but oracle hasn't updated, front-run the settlement.
 * Returns: -1 to +1
 * NOTE: DISABLED in config (0% weight) — 0 trades in 17h testing, dead signal
 */
export function oracleLagSignal(): number {
  const cex = priceStore.latest();
  const oracle = priceStore.getChainlink();

  if (!cex || !oracle) return 0;
  if (Date.now() - oracle.timestamp > 30_000) return 0;

  const divergence = (cex.price - oracle.price) / oracle.price;

  const threshold = config.oracleLagThreshold;
  if (Math.abs(divergence) < threshold) return 0;

  const magnitude = Math.min(Math.abs(divergence) / (threshold * 3), 1);
  return magnitude * Math.sign(divergence);
}
