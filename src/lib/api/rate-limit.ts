/**
 * Rate limiting middleware for expensive and sensitive operations
 * Prevents abuse of webhooks, auth, approvals, and dispute handling
 */

import { RateLimitError } from "../errors";

export interface RateLimitConfig {
  maxRequests: number; // Max requests allowed
  windowMs: number;    // Time window in milliseconds
  keyPrefix: string;   // Redis/storage key prefix
}

/**
 * In-memory rate limit store (for development)
 * Production should use Redis or similar
 */
class InMemoryRateLimitStore {
  private requests: Map<string, number[]> = new Map();

  isAllowed(key: string, config: RateLimitConfig): boolean {
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Get or create request timestamps for this key
    let timestamps = this.requests.get(key) || [];

    // Remove expired requests
    timestamps = timestamps.filter((ts) => ts > windowStart);

    // Check if limit exceeded
    if (timestamps.length >= config.maxRequests) {
      // Calculate retry-after in seconds
      const oldestRequest = timestamps[0];
      const retryAfterMs = oldestRequest + config.windowMs - now;
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);

      throw new RateLimitError(
        `Rate limit exceeded. Try again in ${retryAfterSec} seconds`,
        {
          retryAfter: retryAfterSec,
          limit: config.maxRequests,
          window: Math.round(config.windowMs / 1000),
        }
      );
    }

    // Add current request
    timestamps.push(now);
    this.requests.set(key, timestamps);

    return true;
  }

  reset(key: string): void {
    this.requests.delete(key);
  }

  getStats(key: string, config: RateLimitConfig): { remaining: number; resetAt: Date } {
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const timestamps = this.requests.get(key) || [];
    const validRequests = timestamps.filter((ts) => ts > windowStart);

    const remaining = Math.max(0, config.maxRequests - validRequests.length);
    const resetAt = new Date(
      validRequests.length > 0
        ? validRequests[0] + config.windowMs
        : now + config.windowMs
    );

    return { remaining, resetAt };
  }
}

export const rateLimitStore = new InMemoryRateLimitStore();

/**
 * Rate limit configurations for different operation types
 */
export const RATE_LIMITS = {
  // Webhook processing: 100 per minute (distributed system handling)
  webhook: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: "rl:webhook",
  } as RateLimitConfig,

  // Auth failures: 5 failures per 15 minutes per user/IP
  authFailure: {
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    keyPrefix: "rl:auth-fail",
  } as RateLimitConfig,

  // Dispute operations: 10 per hour per user
  dispute: {
    maxRequests: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyPrefix: "rl:dispute",
  } as RateLimitConfig,

  // Approval operations: 100 per hour per user
  approval: {
    maxRequests: 100,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyPrefix: "rl:approval",
  } as RateLimitConfig,

  // API key validation: 100 per minute per key
  apiKeyValidation: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: "rl:api-key",
  } as RateLimitConfig,
};

/**
 * Check rate limit for an operation
 * Throws RateLimitError if exceeded
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): void {
  const key = `${config.keyPrefix}:${identifier}`;
  rateLimitStore.isAllowed(key, config);
}

/**
 * Get rate limit stats for monitoring
 */
export function getRateLimitStats(
  identifier: string,
  config: RateLimitConfig
): { remaining: number; resetAt: Date } {
  const key = `${config.keyPrefix}:${identifier}`;
  return rateLimitStore.getStats(key, config);
}

/**
 * Reset rate limit for an identifier (admin function)
 */
export function resetRateLimit(
  identifier: string,
  config: RateLimitConfig
): void {
  const key = `${config.keyPrefix}:${identifier}`;
  rateLimitStore.reset(key);
}

