import crypto from 'crypto';
import fetch from 'node-fetch';
import { logger } from './utils/logger';
import {
  Candle,
  Ticker,
  KrakenOHLC,
  KrakenTicker,
  KrakenBalance,
  KrakenAddOrder,
  KrakenAsset,
} from './utils/types';

/**
 * Kraken API client for public and private endpoints
 * Handles rate limiting, retries, and error handling
 */
export class KrakenClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl = 'https://api.kraken.com';
  private lastCallTime = 0;
  private isDegraded = false;
  private assetPairMap: Map<string, string> = new Map();

  // Rate limiting constants
  private readonly REQUEST_DELAY_MS = 100; // 100ms between requests
  private readonly MAX_RETRIES = 2;
  private readonly TIMEOUT_MS = 10000; // 10s timeout

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  /**
   * Check if API is in degraded mode (rate limited)
   */
  public isDegradedMode(): boolean {
    return this.isDegraded;
  }

  /**
   * Reset degraded mode flag after cooldown
   */
  public resetDegradedMode(): void {
    this.isDegraded = false;
  }

  /**
   * Rate limiting and retry logic
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    retries: number = this.MAX_RETRIES
  ): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Rate limiting
        const timeSinceLastCall = Date.now() - this.lastCallTime;
        if (timeSinceLastCall < this.REQUEST_DELAY_MS) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.REQUEST_DELAY_MS - timeSinceLastCall)
          );
        }

        this.lastCallTime = Date.now();
        return await this.withTimeout(fn(), this.TIMEOUT_MS);
      } catch (error: unknown) {
        const err = error as any;

        // Don't retry rate limits or 429 errors
        if (err?.status === 429 || err?.response?.status === 429) {
          logger.warn('Kraken API rate limit exceeded', { attempt });
          this.isDegraded = true;
          throw error;
        }

        // Don't retry non-recoverable errors
        if (err?.status === 401 || err?.status === 403) {
          throw error;
        }

        // Last attempt, throw
        if (attempt === retries) {
          throw error;
        }

        // Exponential backoff
        const backoffMs = Math.pow(2, attempt) * 1000;
        logger.debug(`Kraken API request failed, retrying in ${backoffMs}ms`, {
          attempt,
          error: err?.message,
        });
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * Add timeout to promise
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
      ),
    ]);
  }

  /**
   * Fetch public API endpoint
   */
  private async publicRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/0/public/${endpoint}`);

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    return this.withRetry(async () => {
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw {
          status: response.status,
          message: response.statusText,
        };
      }

      const data: any = await response.json();

      if (data.error && data.error.length > 0) {
        throw new Error(`Kraken API error: ${data.error[0]}`);
      }

      return data.result as T;
    });
  }

  /**
   * Sign private API request
   */
  private signRequest(
    endpoint: string,
    params: Record<string, string>,
    nonce: string
  ): { headers: Record<string, string>; body: string } {
    const postdata = new URLSearchParams({ nonce, ...params });
    const postdata_str = postdata.toString();

    const message = endpoint + crypto.createHash('sha256').update(nonce + postdata_str).digest();

    const signature = crypto
      .createHmac('sha512', Buffer.from(this.apiSecret, 'base64'))
      .update(message)
      .digest('base64');

    return {
      headers: {
        'API-Sign': signature,
        'API-Key': this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postdata_str,
    };
  }

  /**
   * Fetch private API endpoint
   */
  private async privateRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const nonce = Date.now().toString();
    const { headers, body } = this.signRequest(endpoint, params, nonce);

    return this.withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/0/private/${endpoint}`, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        throw {
          status: response.status,
          message: response.statusText,
        };
      }

      const data: any = await response.json();

      if (data.error && data.error.length > 0) {
        throw new Error(`Kraken API error: ${data.error.join(', ')}`);
      }

      return data.result as T;
    });
  }

  /**
   * Map trading pair to Kraken asset pair
   */
  private async mapAssetPair(pair: string): Promise<string> {
    if (this.assetPairMap.has(pair)) {
      return this.assetPairMap.get(pair)!;
    }

    // Try common mappings first
    const commonMappings: Record<string, string> = {
      'BTC/USD': 'XBTUSD',
      'ETH/USD': 'ETHUSD',
      'BTC/USDT': 'XBTUSDT',
      'ETH/USDT': 'ETHUSDT',
    };

    if (commonMappings[pair]) {
      const mapped = commonMappings[pair];
      this.assetPairMap.set(pair, mapped);
      return mapped;
    }

    // If not in common mappings, try to fetch asset list
    try {
      const assets = await this.publicRequest<KrakenAsset>('AssetPairs');
      for (const [krakenPair, _] of Object.entries(assets)) {
        this.assetPairMap.set(pair, krakenPair);
        return krakenPair;
      }
    } catch (error) {
      logger.warn(`Failed to map asset pair: ${pair}`, { error });
    }

    // Fallback to uppercase
    const fallback = pair.replace('/', '').toUpperCase();
    this.assetPairMap.set(pair, fallback);
    return fallback;
  }

  /**
   * Get OHLC candlestick data
   */
  async getOHLC(pair: string, interval: number = 15): Promise<Candle[]> {
    try {
      const krakenPair = await this.mapAssetPair(pair);
      const data = await this.publicRequest<KrakenOHLC>('OHLC', {
        pair: krakenPair,
        interval: interval.toString(),
      });

      // Kraken may return with different key format, just use first key in result
      let candles: Array<any> = [];
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) {
          candles = data[key];
          break;
        }
      }

      return candles
        .slice(0, -1) // Remove incomplete candle
        .map((candle) => ({
          timestamp: Number(candle[0]) * 1000,
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[6]),
        }));
    } catch (error) {
      logger.logAPIError('getOHLC', error);
      return [];
    }
  }

  /**
   * Get current ticker data
   */
  async getTicker(pair: string): Promise<Ticker | null> {
    try {
      const krakenPair = await this.mapAssetPair(pair);
      const data = await this.publicRequest<KrakenTicker>('Ticker', {
        pair: krakenPair,
      });

      // Kraken may return with different key format (e.g., request XBTUSD, get XXBTZUSD)
      // Just grab the first (and usually only) ticker data object
      let ticker = null;
      for (const key of Object.keys(data)) {
        if (data[key] && typeof data[key] === 'object' && data[key].a) {
          ticker = data[key];
          break;
        }
      }

      if (!ticker) return null;

      const bid = parseFloat(String(ticker.b[0]));
      const ask = parseFloat(String(ticker.a[0]));
      const price = parseFloat(String(ticker.c[0]));
      const volume = parseFloat(String(ticker.v[0]));
      const spread = ask - bid;

      return {
        bid,
        ask,
        price,
        volume,
        spread,
      };
    } catch (error) {
      logger.logAPIError('getTicker', error);
      return null;
    }
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<Record<string, number> | null> {
    try {
      const data = await this.privateRequest<KrakenBalance>('Balance');

      const balance: Record<string, number> = {};
      for (const [asset, amount] of Object.entries(data)) {
        balance[asset] = parseFloat(amount);
      }

      logger.debug('Kraken balance fetched successfully', {
        assets: Object.keys(balance).length,
        usd: balance.ZUSD ? `$${balance.ZUSD.toFixed(2)}` : 'N/A',
      });

      return balance;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch Kraken balance', {
        error: errorMsg,
        tip: 'Check that API keys have "Query Funds" permission (not just "Query Open Orders and Trades")',
      });
      return null;
    }
  }

  /**
   * Place market order
   */
  async placeOrder(
    pair: string,
    side: 'buy' | 'sell',
    volume: number,
    orderType: string = 'market'
  ): Promise<string | null> {
    try {
      if (!this.apiKey || !this.apiSecret) {
        logger.error('API credentials not configured');
        return null;
      }

      const krakenPair = await this.mapAssetPair(pair);

      const params: Record<string, string> = {
        pair: krakenPair,
        type: side,
        ordertype: orderType,
        volume: volume.toFixed(8),
      };

      const data = await this.privateRequest<KrakenAddOrder>('AddOrder', params);

      if (data.txid && data.txid.length > 0) {
        logger.info(`Order placed: ${side.toUpperCase()} ${volume} ${pair}`, {
          pair,
          side,
          volume,
          txid: data.txid[0],
        });
        return data.txid[0];
      }

      return null;
    } catch (error) {
      logger.logAPIError('placeOrder', error);
      return null;
    }
  }

  /**
   * Get open orders
   */
  async getOpenOrders(): Promise<Record<string, any> | null> {
    try {
      const data = await this.privateRequest<Record<string, any>>('OpenOrders');
      return data;
    } catch (error) {
      logger.logAPIError('getOpenOrders', error);
      return null;
    }
  }

  /**
   * Cancel order
   */
  async cancelOrder(txid: string): Promise<boolean> {
    try {
      await this.privateRequest('CancelOrder', { txid });
      logger.info('Order cancelled', { txid });
      return true;
    } catch (error) {
      logger.logAPIError('cancelOrder', error);
      return false;
    }
  }

  /**
   * Get closed orders
   */
  async getClosedOrders(): Promise<Record<string, any> | null> {
    try {
      const data = await this.privateRequest<Record<string, any>>('ClosedOrders');
      return data;
    } catch (error) {
      logger.logAPIError('getClosedOrders', error);
      return null;
    }
  }

  /**
   * Get order status
   */
  async queryOrders(txids: string[]): Promise<Record<string, any> | null> {
    try {
      const data = await this.privateRequest<Record<string, any>>('QueryOrders', {
        txid: txids.join(','),
      });
      return data;
    } catch (error) {
      logger.logAPIError('queryOrders', error);
      return null;
    }
  }
}

export default KrakenClient;
