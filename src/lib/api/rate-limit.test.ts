import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, RATE_LIMITS, rateLimitStore } from "./rate-limit";
import { RateLimitError } from "../errors";

describe("Rate Limiting", () => {
  beforeEach(() => {
    rateLimitStore.reset("rl:inv-upload:test-user");
    rateLimitStore.reset("rl:extraction:test-user");
    rateLimitStore.reset("rl:anomaly:test-user");
  });

  it("should allow invoice uploads up to the limit and throw on exceeding", () => {
    const config = RATE_LIMITS.invoiceUpload;
    for (let i = 0; i < config.maxRequests; i++) {
      expect(() => checkRateLimit("test-user", config)).not.toThrow();
    }
    expect(() => checkRateLimit("test-user", config)).toThrow(RateLimitError);
  });

  it("should allow extraction requests up to the limit and throw on exceeding", () => {
    const config = RATE_LIMITS.extraction;
    for (let i = 0; i < config.maxRequests; i++) {
      expect(() => checkRateLimit("test-user", config)).not.toThrow();
    }
    expect(() => checkRateLimit("test-user", config)).toThrow(RateLimitError);
  });

  it("should allow anomaly score requests up to the limit and throw on exceeding", () => {
    const config = RATE_LIMITS.anomalyScore;
    for (let i = 0; i < config.maxRequests; i++) {
      expect(() => checkRateLimit("test-user", config)).not.toThrow();
    }
    expect(() => checkRateLimit("test-user", config)).toThrow(RateLimitError);
  });
});
