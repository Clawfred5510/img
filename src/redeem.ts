import { ethers } from 'ethers';
import { config } from './config';
import { logger } from './logger';

const TAG = 'REDEEM';

// Polymarket CTF (Conditional Token Framework) on Polygon
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';

const CTF_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
];

const NEG_RISK_ABI = [
  'function redeemPositions(bytes32 conditionId, uint256[] amounts)',
];

const USDC_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

let provider: ethers.providers.JsonRpcProvider | null = null;
let wallet: ethers.Wallet | null = null;

function getWallet(): ethers.Wallet {
  if (!wallet) {
    provider = new ethers.providers.JsonRpcProvider('https://polygon-bor-rpc.publicnode.com');
    wallet = new ethers.Wallet(config.privateKey, provider);
  }
  return wallet;
}

/**
 * Check if we hold winning conditional tokens for a resolved market
 * and redeem them for USDC automatically.
 */
export async function redeemWinnings(tokenId: string, conditionId: string): Promise<boolean> {
  try {
    const w = getWallet();
    const ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, w);

    // Check token balance
    const balance = await ctf.balanceOf(w.address, tokenId);
    if (balance.isZero()) {
      logger.info(TAG, 'No tokens to redeem for this position');
      return false;
    }

    const shares = parseFloat(ethers.utils.formatUnits(balance, 6));
    logger.info(TAG, `Found ${shares} winning shares to redeem`);

    // Redeem via CTF contract
    // indexSets: [1] for outcome 0 (Up/Yes), [2] for outcome 1 (Down/No)
    // We redeem both outcomes since we hold the winning side
    const gasOpts = {
      gasLimit: 300000,
      maxPriorityFeePerGas: ethers.utils.parseUnits('30', 'gwei'),
      maxFeePerGas: ethers.utils.parseUnits('100', 'gwei'),
    };

    const tx = await ctf.redeemPositions(
      USDC_POLYGON,
      ethers.constants.HashZero, // parentCollectionId (root)
      conditionId,
      [1, 2], // Both index sets to redeem
      gasOpts
    );

    logger.info(TAG, `Redeem TX sent: ${tx.hash}`);
    const receipt = await tx.wait(1);

    if (receipt.status === 1) {
      logger.info(TAG, `✅ Redeemed ${shares} shares → USDC | TX: ${tx.hash}`);
      return true;
    } else {
      logger.error(TAG, `Redeem TX failed | TX: ${tx.hash}`);
      return false;
    }
  } catch (err: any) {
    logger.error(TAG, `Redeem failed: ${err.message}`);
    // Try NegRisk adapter as fallback (some markets use it)
    try {
      return await redeemViaNegRisk(conditionId);
    } catch (err2: any) {
      logger.error(TAG, `NegRisk redeem also failed: ${err2.message}`);
      return false;
    }
  }
}

async function redeemViaNegRisk(conditionId: string): Promise<boolean> {
  const w = getWallet();
  const ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, w);

  // Try redeeming via the NegRisk adapter
  const negRisk = new ethers.Contract(
    ethers.utils.getAddress(NEG_RISK_ADAPTER.toLowerCase()),
    NEG_RISK_ABI,
    w
  );

  const gasOpts = {
    gasLimit: 300000,
    maxPriorityFeePerGas: ethers.utils.parseUnits('30', 'gwei'),
    maxFeePerGas: ethers.utils.parseUnits('100', 'gwei'),
  };

  // Amounts array — try max uint to redeem all
  const tx = await negRisk.redeemPositions(conditionId, [ethers.constants.MaxUint256, ethers.constants.MaxUint256], gasOpts);
  logger.info(TAG, `NegRisk redeem TX: ${tx.hash}`);
  const receipt = await tx.wait(1);

  if (receipt.status === 1) {
    logger.info(TAG, `✅ NegRisk redeem success | TX: ${tx.hash}`);
    return true;
  }
  return false;
}

/**
 * Attempt to redeem all known winning positions.
 * Called periodically or after trade resolution.
 */
export async function redeemAllWinnings(resolvedMarkets: Array<{ tokenId: string; conditionId: string }>): Promise<number> {
  let redeemed = 0;
  for (const m of resolvedMarkets) {
    const success = await redeemWinnings(m.tokenId, m.conditionId);
    if (success) redeemed++;
    // Small delay between redemptions
    await new Promise(r => setTimeout(r, 2000));
  }
  return redeemed;
}
