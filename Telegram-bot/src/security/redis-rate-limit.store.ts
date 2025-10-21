import Redis from 'ioredis';
import { RateLimitStore } from './rate-limiter.service';
import { Logger } from '../services/logger';

export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: Redis;
  private readonly logger = Logger.getInstance();
  private readonly prefix: string;

  constructor(url: string, prefix = 'rate:limiter') {
    this.redis = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 2,
      reconnectOnError: () => true
    });
    this.prefix = prefix;
  }

  async connect(): Promise<void> {
    try {
      // Avoid unhandled errors on connect in production
      if ((this.redis as any).status !== 'ready') {
        await this.redis.connect();
      }
    } catch (error) {
      this.logger.error('RedisRateLimitStore connect error:', error);
      throw error;
    }
  }

  private key(k: string) {
    return `${this.prefix}:${k}`;
  }

  async get(key: string): Promise<{ count: number; resetTime: number } | null> {
    try {
      const rkey = this.key(key);
      const res = await this.redis
        .multi()
        .get(rkey)
        .pttl(rkey)
        .exec();

      const countStr = (res?.[0]?.[1] as string | null) ?? null;
      const ttlRaw = Number(res?.[1]?.[1]);
      if (!countStr || !isFinite(ttlRaw) || ttlRaw <= 0) return null;
      const count = parseInt(countStr ?? '0', 10) || 0;
      const resetTime = Date.now() + ttlRaw;
      return { count, resetTime };
    } catch (error) {
      this.logger.error('RedisRateLimitStore.get error:', error);
      return null;
    }
  }

  async set(key: string, value: { count: number; resetTime: number }): Promise<void> {
    try {
      const rkey = this.key(key);
      const ttl = Math.max(0, value.resetTime - Date.now());
      if (ttl <= 0) return;
      await this.redis.set(rkey, String(value.count), 'PX', ttl);
    } catch (error) {
      this.logger.error('RedisRateLimitStore.set error:', error);
    }
  }

  async increment(key: string): Promise<{ count: number; resetTime: number }> {
    const rkey = this.key(key);
    const windowMs = 60_000;
    try {
      const txn = this.redis.multi();
      txn.incr(rkey);
      txn.pttl(rkey);
      const res = await txn.exec();
      const count = parseInt(String(res?.[0]?.[1] ?? '1'), 10) || 1;
      let ttl = Number(res?.[1]?.[1] ?? -1);
      if (ttl < 0) {
        await this.redis.pexpire(rkey, windowMs);
        ttl = windowMs;
      }
      const resetTime = Date.now() + ttl;
      return { count, resetTime };
    } catch (error) {
      this.logger.error('RedisRateLimitStore.increment error:', error);
      // Fallback: pretend first request of window
      return { count: 1, resetTime: Date.now() + windowMs };
    }
  }

  async cleanup(): Promise<void> {
    // Redis handles expiration
  }
}
