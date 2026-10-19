const Redis = require('ioredis');

let redisClient = null;
let isRedisConnected = false;

// In-Memory Fallback Adapter if Redis server is not locally running
class InMemoryRedisFallback {
  constructor() {
    this.store = new Map();
    this.expirations = new Map();
    console.warn('[Redis Alert] Running with In-Memory Redis fallback adapter. For distributed clustering, start Redis and set REDIS_URL or REDIS_HOST/REDIS_PORT in .env.');
  }

  async get(key) {
    if (this._isExpired(key)) return null;
    return this.store.get(key) || null;
  }

  async set(key, value, ...args) {
    this.store.set(key, value);
    if (args.includes('EX') || args.includes('ex')) {
      const exIdx = Math.max(args.indexOf('EX'), args.indexOf('ex'));
      const seconds = Number(args[exIdx + 1]);
      if (seconds) {
        this.expirations.set(key, Date.now() + seconds * 1000);
      }
    } else if (args.includes('PX') || args.includes('px')) {
      const pxIdx = Math.max(args.indexOf('PX'), args.indexOf('px'));
      const ms = Number(args[pxIdx + 1]);
      if (ms) {
        this.expirations.set(key, Date.now() + ms);
      }
    }
    return 'OK';
  }

  async del(...keys) {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) deleted++;
      this.expirations.delete(key);
    }
    return deleted;
  }

  async setnx(key, value) {
    if (this._isExpired(key) || !this.store.has(key)) {
      this.store.set(key, value);
      return 1;
    }
    return 0;
  }

  _isExpired(key) {
    const exp = this.expirations.get(key);
    if (exp && Date.now() > exp) {
      this.store.delete(key);
      this.expirations.delete(key);
      return true;
    }
    return false;
  }

  // Sliding window mock implementation
  async slidingLimit(key, now, windowMs, limit, nonce) {
    const raw = this.store.get(key) || '[]';
    let timestamps = JSON.parse(raw);
    const clearBefore = now - windowMs;
    timestamps = timestamps.filter(t => t > clearBefore);

    if (timestamps.length < limit) {
      timestamps.push(now);
      this.store.set(key, JSON.stringify(timestamps));
      this.expirations.set(key, now + windowMs);
      return [1, limit - timestamps.length];
    }
    return [0, 0];
  }

  defineCommand(name, definition) {
    // Custom commands handled via fallback methods
  }

  async quit() {
    this.store.clear();
    this.expirations.clear();
  }
}

const initializeRedis = () => {
  const redisUrl = process.env.REDIS_URL || (process.env.REDIS_HOST ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}` : null);

  if (!redisUrl) {
    redisClient = new InMemoryRedisFallback();
    console.warn(
      '[Redis] Redis is not configured; using an instance-local fallback (rate limits are not shared across instances).'
    );
    return redisClient;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy(times) {
        if (times > 2) {
          console.warn('[Redis] Reconnect limit reached. Switching to in-memory fallback.');
          return null; // Stop retrying
        }
        return 500;
      },
      lazyConnect: false,
    });

    redisClient.on('connect', () => {
      isRedisConnected = true;
      console.log('[Redis] Connection established');
    });

    redisClient.on('error', (err) => {
      const errorName = /^[A-Za-z0-9]+$/.test(err?.name || '') ? err.name : 'Error';
      console.warn(`[Redis] Connection warning (type=${errorName})`);
      if (!isRedisConnected) {
        redisClient = new InMemoryRedisFallback();
      }
    });

    return redisClient;
  } catch (error) {
    const errorName = /^[A-Za-z0-9]+$/.test(error?.name || '') ? error.name : 'Error';
    console.warn(`[Redis] Initialization failed (type=${errorName}); using in-memory fallback.`);
    redisClient = new InMemoryRedisFallback();
    return redisClient;
  }
};

const getRedisClient = () => {
  if (!redisClient) {
    return initializeRedis();
  }
  return redisClient;
};

module.exports = {
  getRedisClient,
  initializeRedis,
};
