import { priceStore } from '../priceStore';
import { config } from '../config';

/**
 * Momentum Signal: If BTC moved >threshold in a direction in the first 1-2 min
 * of the 5-min window, bet that direction continues.
 * Returns: -1 (strong down) to +1 (strong up)
 */
export function momentumSignal(): number {
  const ret = priceStore.returnOverPeriod(config.momentumWindow);
  if (ret === null) return 0;

  const threshold = config.momentumThreshold;
  if (Math.abs(ret) < threshold) return 0;

  const magnitude = Math.min(Math.abs(ret) / (threshold * 3), 1);
  const score = magnitude * Math.sign(ret);
  return score;
}
