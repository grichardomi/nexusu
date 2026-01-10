import * as fs from 'fs';
import * as path from 'path';
import { logger } from './utils/logger';
import { Position, PerformanceStats, AIDecision, PyramidLevel } from './utils/types';

/**
 * Position Tracker
 * Tracks open trades, calculates P&L, and persists to JSON files
 */
export class PositionTracker {
  private positions: Map<string, Position> = new Map();
  private closedPositions: Position[] = [];
  private dataDir: string = './data';

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
    this.ensureDataDir();
    this.loadPositions();
  }

  /**
   * Ensure data directory exists
   */
  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Load positions from JSON
   */
  private loadPositions(): void {
    const filePath = path.join(this.dataDir, 'positions.json');

    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        this.closedPositions = data.closed || [];
        logger.info(`Loaded ${this.closedPositions.length} closed positions from disk`);
      }
    } catch (error) {
      logger.warn('Failed to load positions from disk', { error });
    }
  }

  /**
   * Save positions to JSON
   */
  private savePositions(): void {
    const filePath = path.join(this.dataDir, 'positions.json');

    try {
      const data = {
        closed: this.closedPositions,
        timestamp: Date.now(),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save positions to disk', { error });
    }
  }

  /**
   * Add new position (with pyramid support)
   */
  addPosition(
    pair: string,
    entryPrice: number,
    volume: number,
    stopLoss: number,
    profitTarget: number,
    aiDecision: AIDecision,
    adx: number = 0,
    regime: 'choppy' | 'weak' | 'moderate' | 'strong' = 'moderate',
    erosionCap: number = 0.008
  ): void {
    if (this.positions.has(pair)) {
      logger.warn(`Position already exists for ${pair}, ignoring new entry`);
      return;
    }

    const position: Position = {
      pair,
      // L0 (initial entry)
      entryPrice,
      volume,
      entryTime: Date.now(),
      stopLoss,
      profitTarget,

      // Pyramid tracking
      pyramidLevels: [],
      totalVolume: volume,
      pyramidLevelsActivated: 0,

      // Profit tracking
      currentProfit: 0,
      profitPct: 0,
      peakProfit: 0,

      // Erosion protection
      erosionCap,
      erosionUsed: 0,

      // Entry metadata
      aiReasoning: aiDecision.reasoning,
      adx,
      regime,
      status: 'open',
    };

    this.positions.set(pair, position);

    logger.logTradeEntry(pair, 'OPEN', {
      entryPrice,
      volume,
      stopLoss,
      profitTarget,
      aiConfidence: '?',
      adx: adx.toFixed(1),
      regime,
    });
  }

  /**
   * Get position by pair
   */
  getPosition(pair: string): Position | null {
    return this.positions.get(pair) || null;
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter((p) => p.status === 'open');
  }

  /**
   * Get all closed positions
   */
  getClosedPositions(): Position[] {
    return this.closedPositions;
  }

  /**
   * Update position with current price (handles pyramid levels)
   */
  updatePosition(pair: string, currentPrice: number): void {
    const position = this.positions.get(pair);
    if (!position) return;

    // Calculate profit for ALL levels (L0 + L1 + L2)
    let totalProfit = 0;
    let totalCost = 0;

    // L0 (initial entry)
    const l0Cost = position.entryPrice * position.volume;
    const l0Profit = (currentPrice - position.entryPrice) * position.volume;
    totalProfit += l0Profit;
    totalCost += l0Cost;

    // L1 + L2
    for (const level of position.pyramidLevels) {
      const levelCost = level.entryPrice * level.volume;
      const levelProfit = (currentPrice - level.entryPrice) * level.volume;
      totalProfit += levelProfit;
      totalCost += levelCost;
    }

    // Update tracking
    position.currentProfit = totalProfit;
    position.profitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    // Track peak profit for erosion protection
    if (position.currentProfit > position.peakProfit) {
      position.peakProfit = position.currentProfit;
      position.erosionUsed = 0; // Reset erosion when new peak
    } else {
      // Calculate erosion from peak
      position.erosionUsed = position.peakProfit - position.currentProfit;
    }
  }

  /**
   * Add pyramid level (L1 or L2)
   */
  addPyramidLevel(
    pair: string,
    level: 1 | 2,
    entryPrice: number,
    volume: number,
    aiConfidence: number
  ): boolean {
    const position = this.positions.get(pair);
    if (!position) return false;

    // Check max levels
    if (position.pyramidLevelsActivated >= 2) {
      logger.warn(`${pair} already has max pyramid levels (2)`);
      return false;
    }

    // Prevent duplicates
    if (position.pyramidLevels.some((l) => l.level === level)) {
      logger.warn(`${pair} L${level} already exists`);
      return false;
    }

    // Trigger profit stored as fraction (e.g., 0.045 = 4.5%)
    const triggerPct = level === 1 ? 0.045 : 0.08;
    const pyramidLevel: PyramidLevel = {
      level,
      entryPrice,
      volume,
      entryTime: Date.now(),
      triggerProfitPct: triggerPct,
      aiConfidence,
      status: 'active',
    };

    position.pyramidLevels.push(pyramidLevel);
    position.totalVolume += volume;
    position.pyramidLevelsActivated++;

    logger.info(`[PYRAMID] ${pair} L${level} added at $${entryPrice.toFixed(2)} (${(volume * entryPrice).toFixed(2)} USD)`, {
      addSize: `${volume.toFixed(6)} units`,
      aiConfidence,
    });

    return true;
  }

  /**
   * Check if erosion cap exceeded
   * Closes position if giveback exceeds cap
   */
  checkErosionCap(pair: string): boolean {
    const position = this.positions.get(pair);
    if (!position) return false;

    // Only protect if we have pyramid levels
    if (position.pyramidLevelsActivated === 0) return false;

    const erosionPct = position.peakProfit > 0 ? (position.erosionUsed / position.peakProfit) * 100 : 0;
    const capPct = position.erosionCap * 100;

    if (position.erosionUsed > position.erosionCap) {
      logger.warn(`[EROSION EXIT] ${pair} erosion (${erosionPct.toFixed(2)}%) exceeded cap (${capPct.toFixed(2)}%)`, {
        peakProfit: `$${position.peakProfit.toFixed(2)}`,
        erosion: `$${position.erosionUsed.toFixed(2)}`,
      });
      return true;
    }

    return false;
  }

  /**
   * Check if stop loss hit
   */
  checkStopLoss(pair: string, currentPrice: number): boolean {
    const position = this.positions.get(pair);
    if (!position) return false;

    return currentPrice <= position.stopLoss;
  }

  /**
   * Check if profit target hit
   */
  checkProfitTarget(pair: string, currentPrice: number): boolean {
    const position = this.positions.get(pair);
    if (!position) return false;

    return currentPrice >= position.profitTarget;
  }

  /**
   * Check if ready for pyramid L1 add
   */
  isReadyForL1(pair: string, currentProfit: number, l1TriggerPct: number): boolean {
    const position = this.positions.get(pair);
    if (!position) return false;

    // Already has L1
    if (position.pyramidLevelsActivated >= 1) return false;

    // Profit must reach L1 trigger
    return currentProfit >= l1TriggerPct;
  }

  /**
   * Check if ready for pyramid L2 add
   */
  isReadyForL2(pair: string, currentProfit: number, l2TriggerPct: number): boolean {
    const position = this.positions.get(pair);
    if (!position) return false;

    // Must have L1 first
    if (position.pyramidLevelsActivated < 1) return false;

    // Already has L2
    if (position.pyramidLevelsActivated >= 2) return false;

    // Profit must reach L2 trigger
    return currentProfit >= l2TriggerPct;
  }

  /**
   * Close position
   */
  closePosition(pair: string, exitPrice: number, exitReason: string): void {
    const position = this.positions.get(pair);
    if (!position) return;

    position.exitPrice = exitPrice;
    position.exitTime = Date.now();
    position.exitReason = exitReason;
    position.status = 'closed';

    const profitPct = (exitPrice - position.entryPrice) / position.entryPrice;
    position.profitPct = profitPct * 100;
    position.currentProfit = position.volume * profitPct * position.entryPrice;

    // Log trade exit
    logger.logTradeExit(pair, position.profitPct, exitReason);

    // Move to closed positions
    this.closedPositions.push(position);
    this.positions.delete(pair);

    // Save to disk
    this.savePositions();
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): PerformanceStats {
    if (this.closedPositions.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalProfit: 0,
        totalLoss: 0,
        expectancy: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        maxDrawdownPct: 0,
      };
    }

    let totalProfit = 0;
    let totalLoss = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let maxDrawdown = 0;
    let cumulativeProfit = 0;
    let peak = 0;

    for (const position of this.closedPositions) {
      const profit = position.currentProfit || 0;

      if (profit > 0) {
        totalProfit += profit;
        winningTrades++;
      } else {
        totalLoss += Math.abs(profit);
        losingTrades++;
      }

      cumulativeProfit += profit;
      if (cumulativeProfit > peak) {
        peak = cumulativeProfit;
      }

      const drawdown = peak - cumulativeProfit;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    const totalTrades = this.closedPositions.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const totalGain = totalProfit - totalLoss;
    const expectancy = totalTrades > 0 ? totalGain / totalTrades : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;
    const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      totalProfit,
      totalLoss,
      expectancy,
      profitFactor,
      maxDrawdown,
      maxDrawdownPct,
    };
  }

  /**
   * Log performance snapshot
   */
  logPerformance(): void {
    const stats = this.getPerformanceStats();
    logger.logPerformance({
      totalTrades: stats.totalTrades,
      winRate: `${stats.winRate.toFixed(1)}%`,
      expectancy: `$${stats.expectancy.toFixed(2)}`,
      profitFactor: stats.profitFactor.toFixed(2),
      totalProfit: `$${stats.totalProfit.toFixed(2)}`,
      totalLoss: `$${stats.totalLoss.toFixed(2)}`,
      maxDrawdown: `$${stats.maxDrawdown.toFixed(2)} (${stats.maxDrawdownPct.toFixed(1)}%)`,
    });
  }

  /**
   * Export trades to CSV
   */
  exportToCSV(filePath: string = './data/trades.csv'): void {
    try {
      const rows: string[] = [
        'Pair,EntryTime,ExitTime,EntryPrice,ExitPrice,Volume,ProfitUSD,ProfitPct,ExitReason',
      ];

      for (const position of this.closedPositions) {
        const entryTime = new Date(position.entryTime).toISOString();
        const exitTime = position.exitTime ? new Date(position.exitTime).toISOString() : '';
        const profitUSD = position.currentProfit?.toFixed(2) || '0';
        const profitPct = position.profitPct?.toFixed(2) || '0';

        rows.push(
          `${position.pair},${entryTime},${exitTime},${position.entryPrice.toFixed(2)},${position.exitPrice?.toFixed(2) || ''},${position.volume.toFixed(8)},${profitUSD},${profitPct}%,${position.exitReason || ''}`
        );
      }

      fs.writeFileSync(filePath, rows.join('\n'));
      logger.info(`Exported ${this.closedPositions.length} trades to ${filePath}`);
    } catch (error) {
      logger.error('Failed to export trades to CSV', { error });
    }
  }

  /**
   * Clear all positions (careful!)
   */
  clearAll(): void {
    this.positions.clear();
    logger.warn('All positions cleared');
  }
}

export default PositionTracker;
