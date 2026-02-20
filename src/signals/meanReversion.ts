import { priceStore } from '../priceStore';
import { config } from '../config';

/**
 * Mean Reversion Signal: If price spiked hard (>0.2%) in one direction,
 * fade it — bet the opposite direction.
 * Returns: -1 to +1 (opposite of the spike direction)
 * NOTE: DISABLED in config (0% weight) — consistently loses (25-35% WR)
 */
export function meanReversionSignal(): number {
  const shortReturn = priceStore.returnOverPeriod(30);
  if (shortReturn === null) return 0;

  const threshold = config.meanReversionThreshold;
  if (Math.abs(shortReturn) < threshold) return 0;

  const magnitude = Math.min(Math.abs(shortReturn) / (threshold * 2), 1);
  return -magnitude * Math.sign(shortReturn);
}
