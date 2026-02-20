import { config } from '../config';
import { momentumSignal } from './momentum';
import { meanReversionSignal } from './meanReversion';
import { volatilityFilter } from './volatility';
import { orderFlowSignal } from './orderFlow';
import { oracleLagSignal } from './oracleLag';
import { logger } from '../logger';

export interface SignalResult {
  combined: number;
  direction: 'UP' | 'DOWN' | null;
  confidence: number;
  components: Record<string, number>;
  shouldTrade: boolean;
}

export function computeSignal(): SignalResult {
  const w = config.weights;
  const components: Record<string, number> = {
    momentum: momentumSignal(),
    meanReversion: meanReversionSignal(),
    orderFlow: orderFlowSignal(),
    oracleLag: oracleLagSignal(),
  };

  const rawScore =
    components.momentum * w.momentum +
    components.meanReversion * w.meanReversion +
    components.orderFlow * w.orderFlow +
    components.oracleLag * w.oracleLag;

  const volFilter = volatilityFilter();
  components.volatility = volFilter;

  const combined = rawScore * (volFilter > 0 ? 1 : 0);
  const confidence = Math.abs(combined);
  const direction = combined > 0 ? 'UP' as const : combined < 0 ? 'DOWN' as const : null;
  const hasMomentum = Math.abs(components.momentum) > 0;
  const shouldTrade = confidence >= config.signalThreshold && volFilter > 0 && hasMomentum;

  logger.debug('SIGNAL', 'Signal computed', { components, combined, shouldTrade });

  return { combined, direction, confidence, components, shouldTrade };
}

/** Kelly criterion position sizing */
export function kellyBetSize(confidence: number): number {
  const p = config.estimatedWinRate + (confidence - 0.5) * 0.1;
  const q = 1 - p;
  const b = 1;
  const kelly = (b * p - q) / b;
  const size = Math.max(0, kelly * config.kellyFraction * config.maxBetSize);
  return Math.min(Math.max(size, config.defaultBetSize), config.maxBetSize);
}
