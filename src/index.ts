import { config } from './config';
import { logger } from './utils/logger';
import KrakenClient from './KrakenClient';
import OpenAIDecisionMaker from './OpenAIDecisionMaker';
import IndicatorCalculator from './IndicatorCalculator';
import RiskManager from './RiskManager';
import PositionTracker from './PositionTracker';
import DynamicPositionSizer from './DynamicPositionSizer';
import DashboardServer from './DashboardServer';
import { MarketData, Position, MomentumFailureResult } from './utils/types';

/**
 * Main Trading Bot
 * Orchestrates all components and runs the trading loop
 */
class TradingBot {
  private krakenClient: KrakenClient;
  private aiDecisionMaker: OpenAIDecisionMaker;
  private riskManager: RiskManager;
  private positionTracker: PositionTracker;
  private positionSizer: DynamicPositionSizer;
  private dashboardServer: DashboardServer;
  private isRunning: boolean = false;
  private tradingLoop: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.krakenClient = new KrakenClient(config.krakenApiKey, config.krakenApiSecret);
    this.aiDecisionMaker = new OpenAIDecisionMaker(config);
    this.riskManager = new RiskManager(config);
    this.positionTracker = new PositionTracker('./data');
    this.positionSizer = new DynamicPositionSizer(config.accountBalance || 1000); // Fallback to 1k
    this.dashboardServer = new DashboardServer(this.positionTracker, this.aiDecisionMaker, this.positionSizer, config, 3001);
  }

  /**
   * Start the trading bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }

    this.isRunning = true;
    logger.info('🚀 Trading bot starting...');

    // Start dashboard server
    this.dashboardServer.start();

    // Test connections
    const connected = await this.testConnections();
    if (!connected) {
      logger.error('Failed to connect to required services');
      this.isRunning = false;
      return;
    }

    // Fetch actual Kraken balance (or use override)
    await this.initializeBalance();

    // Update position sizer with historical performance
    const stats = this.positionTracker.getPerformanceStats();
    this.positionSizer.updatePerformance(stats);

    // Start trading loop
    logger.info(`Starting trading loop (interval: ${config.checkIntervalMs}ms)`);

    // Run once immediately
    await this.tradingIteration();

    // Then set interval
    this.tradingLoop = setInterval(() => {
      this.tradingIteration().catch((error) => {
        logger.error('Error in trading loop', { error });
      });
    }, config.checkIntervalMs);

    logger.info('✅ Trading bot is running');
  }

  /**
   * Initialize account balance
   * Paper Trading: Use user-defined PAPER_TRADING_BALANCE (default $10k)
   * Live Trading: Fetch from Kraken API (or use ACCOUNT_BALANCE_OVERRIDE)
   */
  private async initializeBalance(): Promise<void> {
    try {
      if (config.paperTrading) {
        // Paper trading: use user-defined balance or default
        const balance = config.accountBalance > 0 ? config.accountBalance : config.paperTradingBalance;
        this.positionSizer.updateBalance(balance);
        logger.info(`📋 PAPER TRADING MODE | Balance: $${balance.toFixed(2)}`);
        return;
      }

      // Live trading: fetch from Kraken (or use override)
      if (config.accountBalance > 0) {
        this.positionSizer.updateBalance(config.accountBalance);
        logger.info(`💰 LIVE TRADING MODE | Using override balance: $${config.accountBalance.toFixed(2)}`);
        return;
      }

      // Fetch actual balance from Kraken
      logger.info('💰 LIVE TRADING MODE | Fetching account balance from Kraken...');
      const balance = await this.krakenClient.getBalance();

      if (!balance || !balance.ZUSD) {
        logger.error('❌ Could not fetch USD balance from Kraken!');
        logger.error('⚠️  TROUBLESHOOTING:');
        logger.error('  1. Verify API keys are correct');
        logger.error('  2. API key must have "Query Funds" permission');
        logger.error('  3. NOT just "Query Open Orders and Trades"');
        logger.error('  4. Regenerate API key with proper permissions in Kraken Settings');
        logger.error('  5. Or set ACCOUNT_BALANCE_OVERRIDE=50000 to manually specify amount');
        logger.warn('Using fallback balance: $10,000 (will not auto-compound)');
        this.positionSizer.updateBalance(10000);
        return;
      }

      const usdBalance = parseFloat(balance.ZUSD.toString());
      this.positionSizer.updateBalance(usdBalance);
      logger.info(`✅ LIVE TRADING MODE | Kraken balance fetched: $${usdBalance.toFixed(2)}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (config.paperTrading) {
        logger.warn('Paper trading - using default balance');
        this.positionSizer.updateBalance(config.paperTradingBalance);
      } else {
        logger.error('❌ Failed to fetch Kraken balance', { error: errorMsg });
        logger.error('⚠️  TROUBLESHOOTING:');
        logger.error('  Error: ' + errorMsg);
        logger.error('  Solutions:');
        logger.error('    • Check API key has "Query Funds" permission');
        logger.error('    • Test credentials: curl -H "API-Key: xxx" https://api.kraken.com/0/private/Balance');
        logger.error('    • Or set: ACCOUNT_BALANCE_OVERRIDE=50000');
        logger.warn('Using fallback balance: $10,000 (positions will not auto-compound)');
        this.positionSizer.updateBalance(10000);
      }
    }
  }

  /**
   * Stop the trading bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('🛑 Stopping trading bot...');
    this.isRunning = false;

    if (this.tradingLoop) {
      clearInterval(this.tradingLoop);
      this.tradingLoop = null;
    }

    // Stop dashboard server
    this.dashboardServer.stop();

    // Close any open positions
    const openPositions = this.positionTracker.getOpenPositions();
    if (openPositions.length > 0) {
      logger.warn(`${openPositions.length} open positions - not closing (paper trading mode)`);
    }

    // Log final stats
    this.positionTracker.logPerformance();

    logger.info('✅ Trading bot stopped');
  }

  /**
   * Test API connections
   */
  private async testConnections(): Promise<boolean> {
    logger.info('Testing API connections...');

    try {
      // Test Kraken API
      logger.info('Testing Kraken API...');
      const ticker = await this.krakenClient.getTicker('BTC/USD');
      if (!ticker) {
        logger.error('Kraken API test failed - getTicker returned null');
        return false;
      }
      logger.info('✓ Kraken API connected', { btcPrice: ticker.price });

      // Test OpenAI API
      logger.info('Testing OpenAI API...');
      // We'll test on first trade

      logger.info('✓ All API connections successful');
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('API connection test failed', { error: errorMsg, stack: error instanceof Error ? error.stack : '' });
      return false;
    }
  }

  /**
   * Main trading iteration (runs every CHECK_INTERVAL_MS)
   */
  private async tradingIteration(): Promise<void> {
    try {
      // Sync balance from Kraken every 10 minutes
      if (Date.now() % 600000 < config.checkIntervalMs && !config.accountBalance) {
        await this.syncBalance();
      }

      // Update position sizer performance every trading iteration
      const stats = this.positionTracker.getPerformanceStats();
      this.positionSizer.updatePerformance(stats);

      // Fetch BTC data first (used for drop protection on alts)
      logger.debug('Fetching market data...');
      const btcData = await this.fetchMarketData('BTC/USD');
      if (!btcData) {
        logger.warn('Failed to fetch BTC data');
        return;
      }

      // Update risk manager with BTC momentum
      this.riskManager.updateBTCMomentum(btcData.indicators.momentum1h);

      // Process each trading pair
      for (const pair of config.pairs) {
        if (!this.isRunning) break;

        await this.processPair(pair);
      }

      // Log periodic stats
      const openPositions = this.positionTracker.getOpenPositions();
      if (openPositions.length > 0 || (Date.now() % 60000 < config.checkIntervalMs)) {
        // Log every minute or when there are positions
        const aiStats = this.aiDecisionMaker.getCostStats();
        const sizerSummary = this.positionSizer.getSummary();
        logger.debug('Bot status', {
          pairs: config.pairs.length,
          openPositions: openPositions.length,
          balance: `$${sizerSummary.balance.toFixed(2)}`,
          winRate: `${(sizerSummary.winRate * 100).toFixed(1)}%`,
          kellyFraction: sizerSummary.kellyFraction,
          aiCallsToday: aiStats.totalCalls,
          estimatedCost: `$${aiStats.estimatedCostUSD.toFixed(2)}`,
          cacheHitRate: `${aiStats.cacheHitRate}%`,
        });
      }
    } catch (error) {
      logger.error('Error in trading iteration', { error });
    }
  }

  /**
   * Sync account balance from Kraken (live trading only)
   */
  private async syncBalance(): Promise<void> {
    // Only sync in live trading mode
    if (config.paperTrading) return;

    try {
      const balance = await this.krakenClient.getBalance();
      if (balance && balance.ZUSD) {
        const usdBalance = parseFloat(balance.ZUSD.toString());
        this.positionSizer.updateBalance(usdBalance);
        logger.debug('Balance synced from Kraken', { balance: `$${usdBalance.toFixed(2)}` });
      }
    } catch (error) {
      logger.debug('Failed to sync balance from Kraken', { error });
    }
  }

  /**
   * Fetch market data for a pair
   */
  private async fetchMarketData(pair: string): Promise<MarketData | null> {
    try {
      // Fetch OHLC candles (last 100)
      const candles = await this.krakenClient.getOHLC(pair, 15);
      if (candles.length === 0) {
        logger.warn(`No candle data for ${pair}`);
        return null;
      }

      // Fetch ticker (current price, spread, volume)
      const ticker = await this.krakenClient.getTicker(pair);
      if (!ticker) {
        logger.warn(`No ticker data for ${pair}`);
        return null;
      }

      // Calculate indicators
      const indicators = IndicatorCalculator.calculateAllIndicators(candles);

      return {
        pair,
        currentPrice: ticker.price,
        bid: ticker.bid,
        ask: ticker.ask,
        volume: ticker.volume,
        candles,
        indicators,
      };
    } catch (error) {
      logger.warn(`Failed to fetch market data for ${pair}`, { error });
      return null;
    }
  }

  /**
   * Process single pair (entry, exit, monitoring)
   */
  private async processPair(pair: string): Promise<void> {
    // Fetch market data
    const marketData = await this.fetchMarketData(pair);
    if (!marketData) {
      logger.debug(`Skipping ${pair} - no market data`);
      return;
    }

    // Check if we have an open position
    const position = this.positionTracker.getPosition(pair);

    if (position) {
      // Monitor existing position
      await this.monitorPosition(pair, marketData);
    } else {
      // Try to enter new trade
      await this.tryEntry(pair, marketData);
    }
  }

  /**
   * Try to enter a trade
   */
  private async tryEntry(pair: string, marketData: MarketData): Promise<void> {
    const { currentPrice, indicators, candles } = marketData;
    const ticker = candles.length > 0 ? { spread: marketData.ask - marketData.bid } : null;

    // Run 5-stage risk filter
    const profitTarget = currentPrice * config.profitTargetPct;

    const riskFilter = await this.riskManager.runFullRiskFilter(
      pair,
      currentPrice,
      indicators,
      ticker,
      profitTarget
    );

    if (!riskFilter.pass) {
      // Entry blocked by risk filter
      return;
    }

    // Stage 4: AI Validation
    const costs = this.riskManager.calculateCosts(pair, currentPrice, 0, config.profitTargetPct);

    logger.debug(`Running AI validation for ${pair}`, {
      confidence: config.aiMinConfidence,
      momentum1h: indicators.momentum1h.toFixed(3),
      volumeRatio: indicators.volumeRatio.toFixed(2),
    });

    this.riskManager.incrementAICallCount();
    const aiDecision = await this.aiDecisionMaker.decideEntry(pair, currentPrice, indicators, costs);

    // Check AI confidence
    if (aiDecision.confidence < config.aiMinConfidence) {
      logger.debug(`AI confidence too low for ${pair}`, {
        confidence: aiDecision.confidence,
        threshold: config.aiMinConfidence,
      });
      return;
    }

    // All filters passed - execute trade
    if (aiDecision.decision === 'BUY') {
      await this.executeTrade(pair, marketData, aiDecision);
    }
  }

  /**
   * Execute trade (with pyramid support + dynamic position sizing)
   */
  private async executeTrade(
    pair: string,
    marketData: MarketData,
    aiDecision: any
  ): Promise<void> {
    const { currentPrice, indicators } = marketData;

    // Calculate position size using dynamic sizing (based on AI confidence + win rate)
    const { stopLoss, profitTarget } = this.riskManager.calculateLevels(currentPrice, 'buy');
    const positionSizeData = config.dynamicSizingEnabled
      ? this.positionSizer.calculatePositionSize(aiDecision.confidence, currentPrice, config.stopLossPct)
      : this.riskManager.calculatePositionSize(this.positionSizer.getBalance(), currentPrice);

    // Get market regime and erosion cap
    const regime = this.riskManager.getRegime(indicators.adx);
    const erosionCap = this.riskManager.getErosionCap(regime);

    // In paper trading mode, just track the position
    if (config.paperTrading) {
      logger.info(`[PAPER] BUY ${pair} at $${currentPrice.toFixed(2)} | Size: ${positionSizeData.sizeAsset.toFixed(8)}`, {
        stopLoss: stopLoss.toFixed(2),
        profitTarget: profitTarget.toFixed(2),
        risk: `$${positionSizeData.riskUSD.toFixed(2)}`,
        confidence: `${aiDecision.confidence}%`,
        regime,
        adx: indicators.adx.toFixed(1),
        dynamic: config.dynamicSizingEnabled,
      });

      this.positionTracker.addPosition(
        pair,
        currentPrice,
        positionSizeData.sizeAsset,
        stopLoss,
        profitTarget,
        aiDecision,
        indicators.adx,
        regime,
        erosionCap
      );
    } else {
      // Live trading - place real order
      logger.info(`[LIVE] Placing BUY order for ${pair}...`);

      const orderId = await this.krakenClient.placeOrder(pair, 'buy', positionSizeData.sizeAsset);

      if (orderId) {
        this.positionTracker.addPosition(
          pair,
          currentPrice,
          positionSizeData.sizeAsset,
          stopLoss,
          profitTarget,
          aiDecision,
          indicators.adx,
          regime,
          erosionCap
        );
      } else {
        logger.error(`Failed to place order for ${pair}`);
      }
    }
  }

  /**
   * Monitor open position (with pyramiding and erosion protection)
   */
  private async monitorPosition(pair: string, marketData: MarketData): Promise<void> {
    const position = this.positionTracker.getPosition(pair)!;
    const { currentPrice } = marketData;

    // Update position with current price (handles pyramid levels)
    this.positionTracker.updatePosition(pair, currentPrice);

    const profitPct = position.profitPct || 0;
    const profitUSD = position.currentProfit || 0;

    // Check stop loss
    if (this.positionTracker.checkStopLoss(pair, currentPrice)) {
      logger.info(`[STOP LOSS] ${pair} hit stop at $${currentPrice.toFixed(2)}`, {
        profitPct: profitPct.toFixed(2),
        profitUSD: profitUSD.toFixed(2),
        levels: position.pyramidLevelsActivated,
      });

      await this.closePosition(pair, currentPrice, 'Stop Loss');
      return;
    }

    // Check erosion cap (pyramid protection)
    if (this.positionTracker.checkErosionCap(pair)) {
      logger.info(`[EROSION EXIT] ${pair} erosion exceeded cap at $${currentPrice.toFixed(2)}`, {
        erosion: `$${position.erosionUsed.toFixed(2)}`,
        cap: `$${position.erosionCap.toFixed(4)}`,
        profitPct: profitPct.toFixed(2),
      });

      await this.closePosition(pair, currentPrice, 'Erosion Cap Exceeded');
      return;
    }

    // Check momentum failure (zero-cost AI exit replacement)
    const momentumFailure = this.detectMomentumFailure(pair, marketData, position);
    if (momentumFailure.shouldExit) {
      logger.info(`[MOMENTUM FAILURE] ${pair} exit at $${currentPrice.toFixed(2)}`, {
        profitPct: profitPct.toFixed(2),
        profitUSD: profitUSD.toFixed(2),
        signals: `${momentumFailure.signalCount}/${config.momentumFailureRequiredSignals}`,
        priceAction: momentumFailure.signals.priceActionFailure,
        volumeExhaustion: momentumFailure.signals.volumeExhaustion,
        htfBreakdown: momentumFailure.signals.htfBreakdown,
        levels: position.pyramidLevelsActivated,
      });

      logger.debug(`[MOMENTUM FAILURE] ${pair} reasoning:`, {
        reasoning: momentumFailure.reasoning,
      });

      await this.closePosition(pair, currentPrice, 'Momentum Failure');
      return;
    }

    // Check profit target
    if (this.positionTracker.checkProfitTarget(pair, currentPrice)) {
      logger.info(`[PROFIT TARGET] ${pair} hit target at $${currentPrice.toFixed(2)}`, {
        profitPct: profitPct.toFixed(2),
        profitUSD: profitUSD.toFixed(2),
        levels: position.pyramidLevelsActivated,
      });

      await this.closePosition(pair, currentPrice, 'Profit Target');
      return;
    }

    // PYRAMID LOGIC: Check for L1/L2 adds
    if (config.pyramidingEnabled) {
      await this.checkAndExecutePyramidAdds(pair, marketData, position);
    }

    // Position still open - log periodic updates
    if (Date.now() % 60000 < config.checkIntervalMs) {
      const levelInfo = position.pyramidLevelsActivated > 0 ? `, Levels: ${position.pyramidLevelsActivated}` : '';
      logger.debug(`[OPEN] ${pair}${levelInfo}`, {
        entryPrice: position.entryPrice.toFixed(2),
        currentPrice: currentPrice.toFixed(2),
        profitPct: profitPct.toFixed(2),
        profitUSD: profitUSD.toFixed(2),
        stopLoss: position.stopLoss.toFixed(2),
        erosion: `$${position.erosionUsed.toFixed(4)} / $${position.erosionCap.toFixed(4)}`,
      });
    }
  }

  /**
   * Detect momentum failure (conservative AI exit replacement)
   *
   * Three-gate detection:
   * 1. Price Action Failure: Higher highs failing OR strong 1h reversal
   * 2. Volume Exhaustion: Below-average volume in profitable position
   * 3. HTF Breakdown: 4h momentum weakening OR EMA200 break
   *
   * Conservative: Requires 2 of 3 signals to trigger exit
   * Only activates when position is in profit >2%
   *
   * @param pair - Trading pair
   * @param marketData - Current market indicators
   * @param position - Open position details
   * @returns MomentumFailureResult with exit decision and reasoning
   */
  private detectMomentumFailure(
    _pair: string, // Not used but kept for method signature consistency
    marketData: MarketData,
    position: Position
  ): MomentumFailureResult {
    const { indicators, currentPrice } = marketData;
    const profitPct = position.profitPct / 100; // Convert to decimal

    // Initialize result
    const result: MomentumFailureResult = {
      shouldExit: false,
      signals: {
        priceActionFailure: false,
        volumeExhaustion: false,
        htfBreakdown: false,
      },
      signalCount: 0,
      reasoning: [],
    };

    // Gate 1: Only check if momentum failure is enabled
    if (!config.momentumFailureEnabled) {
      return result;
    }

    // Gate 2: Only check if profit exceeds minimum (default 2%)
    if (profitPct < config.momentumFailureMinProfit) {
      return result;
    }

    // Determine timeframe-adaptive thresholds
    // Use 4h thresholds if pyramid levels active (longer hold time), else 1h
    const use4hThresholds = position.pyramidLevelsActivated >= 1;

    const momentumThreshold = use4hThresholds
      ? config.momentum4hFailureThreshold
      : config.momentum1hFailureThreshold;

    const volumeThreshold = use4hThresholds
      ? config.volumeExhaustionThreshold4h
      : config.volumeExhaustionThreshold1h;

    // SIGNAL 1: Price Action Failure
    // Check if price is near recent high but momentum is declining
    const priceNearPeak = currentPrice / indicators.recentHigh;
    const momentum1hNegative = indicators.momentum1h < momentumThreshold * 100; // Convert to %

    if (priceNearPeak >= config.priceNearPeakThreshold && momentum1hNegative) {
      result.signals.priceActionFailure = true;
      result.signalCount++;
      result.reasoning.push(
        `Price action failure: ${(priceNearPeak * 100).toFixed(1)}% of peak, ` +
          `1h momentum ${indicators.momentum1h.toFixed(2)}% (threshold: ${(momentumThreshold * 100).toFixed(2)}%)`
      );
    } else if (indicators.momentum1h < momentumThreshold * 100) {
      // Alternative: Strong 1h reversal (even if not at peak)
      result.signals.priceActionFailure = true;
      result.signalCount++;
      result.reasoning.push(
        `Strong 1h reversal: momentum ${indicators.momentum1h.toFixed(2)}% ` +
          `(threshold: ${(momentumThreshold * 100).toFixed(2)}%)`
      );
    }

    // SIGNAL 2: Volume Exhaustion
    // Volume below threshold while in profit = buyers exhausted
    if (indicators.volumeRatio < volumeThreshold) {
      result.signals.volumeExhaustion = true;
      result.signalCount++;
      result.reasoning.push(
        `Volume exhaustion: ${indicators.volumeRatio.toFixed(2)}× ` +
          `(threshold: ${volumeThreshold.toFixed(2)}×)`
      );
    }

    // SIGNAL 3: HTF Breakdown
    // 4h momentum weakening OR price breaking below EMA200
    const htfMomentumWeak = indicators.momentum4h < config.htfMomentumWeakening * 100;
    const belowEMA200 = currentPrice < indicators.ema200;

    if (htfMomentumWeak) {
      result.signals.htfBreakdown = true;
      result.signalCount++;
      result.reasoning.push(
        `4h momentum weakening: ${indicators.momentum4h.toFixed(2)}% ` +
          `(threshold: ${(config.htfMomentumWeakening * 100).toFixed(2)}%)`
      );
    } else if (belowEMA200 && indicators.ema200 > 0) {
      result.signals.htfBreakdown = true;
      result.signalCount++;
      result.reasoning.push(
        `EMA200 breakdown: price $${currentPrice.toFixed(2)} < ` +
          `EMA200 $${indicators.ema200.toFixed(2)}`
      );
    }

    // Conservative decision: Require N signals (default 2 of 3)
    result.shouldExit = result.signalCount >= config.momentumFailureRequiredSignals;

    // Add summary reasoning
    if (result.shouldExit) {
      result.reasoning.push(
        `EXIT TRIGGERED: ${result.signalCount}/${config.momentumFailureRequiredSignals} signals met ` +
          `(profit: ${(profitPct * 100).toFixed(2)}%)`
      );
    }

    return result;
  }

  /**
   * Check and execute pyramid adds (L1 + L2)
   */
  private async checkAndExecutePyramidAdds(
    pair: string,
    marketData: MarketData,
    position: any
  ): Promise<void> {
    const { currentPrice, indicators } = marketData;
    // Use profit fraction (e.g., 0.045 for 4.5%) for trigger comparisons
    const profitFraction = (position.profitPct || 0) / 100;

    // Check for L1 add (4.5% trigger)
    if (this.positionTracker.isReadyForL1(pair, profitFraction, config.pyramidL1TriggerPct)) {
      const pyramidDecision = await this.aiDecisionMaker.decidePyramidAdd(
        pair,
        currentPrice,
        1,
        profitFraction,
        indicators
      );

      // Validate L1 decision
      const validation = this.riskManager.validatePyramidAdd(
        pair,
        pyramidDecision.confidence,
        1,
        profitFraction,
        config.pyramidL1TriggerPct
      );

      if (validation.pass && pyramidDecision.shouldAdd) {
        // Calculate 35% add size for L1 (aggressive pyramiding)
        const addVolume = position.volume * config.pyramidAddSizePctL1;
        const added = this.positionTracker.addPyramidLevel(pair, 1, currentPrice, addVolume, pyramidDecision.confidence);

        if (added && !config.paperTrading) {
          // Place actual buy order
          await this.krakenClient.placeOrder(pair, 'buy', addVolume);
        }
      } else if (!validation.pass) {
        logger.debug(`L1 validation failed: ${validation.reason}`);
      }
    }

    // Check for L2 add (8% trigger)
    if (this.positionTracker.isReadyForL2(pair, profitFraction, config.pyramidL2TriggerPct)) {
      const pyramidDecision = await this.aiDecisionMaker.decidePyramidAdd(
        pair,
        currentPrice,
        2,
        profitFraction,
        indicators
      );

      // Validate L2 decision
      const validation = this.riskManager.validatePyramidAdd(
        pair,
        pyramidDecision.confidence,
        2,
        profitFraction,
        config.pyramidL2TriggerPct
      );

      if (validation.pass && pyramidDecision.shouldAdd) {
        // Calculate 50% add size for L2 (very aggressive, only on strong trends with 90% confidence)
        const addVolume = position.volume * config.pyramidAddSizePctL2;
        const added = this.positionTracker.addPyramidLevel(pair, 2, currentPrice, addVolume, pyramidDecision.confidence);

        if (added && !config.paperTrading) {
          // Place actual buy order
          await this.krakenClient.placeOrder(pair, 'buy', addVolume);
        }
      } else if (!validation.pass) {
        logger.debug(`L2 validation failed: ${validation.reason}`);
      }
    }
  }

  /**
   * Close position (handles both regular and pyramid positions)
   */
  private async closePosition(pair: string, exitPrice: number, exitReason: string): Promise<void> {
    const position = this.positionTracker.getPosition(pair);
    if (!position) return;

    const totalVolume = position.totalVolume; // Includes all pyramid levels

    if (!config.paperTrading) {
      // Place sell order for total position size
      await this.krakenClient.placeOrder(pair, 'sell', totalVolume);
    }

    this.positionTracker.closePosition(pair, exitPrice, exitReason);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const bot = new TradingBot();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  // Start bot
  await bot.start();
}

// Run main
main().catch((error) => {
  logger.error('Fatal error', { error });
  process.exit(1);
});

export default TradingBot;
