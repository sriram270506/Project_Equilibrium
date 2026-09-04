import { describe, expect, it, afterEach, vi } from "vitest";
import { isDemoMode } from "./guard";

describe("demo auth fallback", () => {
  const originalMode = process.env.APP_MODE;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    vi.stubEnv("APP_MODE", originalMode ?? "");
    vi.stubEnv("NODE_ENV", originalNodeEnv ?? "");
  });

  it("requires explicit demo mode and is disabled in production", () => {
    vi.stubEnv("APP_MODE", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(isDemoMode()).toBe(false);

    vi.stubEnv("APP_MODE", "demo");
    vi.stubEnv("NODE_ENV", "production");
    expect(isDemoMode()).toBe(false);
  });
});