import { PaymentProvider } from "./provider-types";
import { mockRazorpay } from "./mock-razorpay";
import { razorpayFromEnv, RazorpayAdapter } from "./razorpay-adapter";

/**
 * Provider selection.
 *
 * `RAZORPAY_MODE=live` with credentials present uses the real Razorpay HTTP
 * API; anything else uses the deterministic mock. Business logic never sees the
 * difference — that is the point of the `PaymentProvider` interface.
 *
 * The selection is deliberately explicit and logged at startup. Silently
 * falling back from live to mock is how a demo ends up claiming a real
 * integration it is not actually exercising.
 */

let cached: PaymentProvider | null = null;
let cachedDescription = "";

export interface ProviderSelection {
  provider: PaymentProvider;
  isLive: boolean;
  description: string;
  /** Why the mock was chosen, when it was. */
  fallbackReason?: string;
}

export function selectProvider(): ProviderSelection {
  const requested = (process.env.RAZORPAY_MODE ?? "mock").toLowerCase();

  if (requested !== "live") {
    return {
      provider: mockRazorpay,
      isLive: false,
      description: "MockRazorpay (deterministic simulator)",
      fallbackReason:
        "RAZORPAY_MODE is not 'live'. Set RAZORPAY_MODE=live with test credentials to use the real API.",
    };
  }

  const adapter = razorpayFromEnv();

  if (!adapter) {
    return {
      provider: mockRazorpay,
      isLive: false,
      description: "MockRazorpay (deterministic simulator)",
      fallbackReason:
        "RAZORPAY_MODE=live was requested but RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.",
    };
  }

  return {
    provider: adapter,
    isLive: true,
    description: adapter.getProviderName(),
  };
}

/** Memoised provider for request handlers. */
export function getProvider(): PaymentProvider {
  if (!cached) {
    const selection = selectProvider();
    cached = selection.provider;
    cachedDescription = selection.description;

    if (selection.isLive) {
      const adapter = selection.provider as RazorpayAdapter;
      if (!adapter.isTestMode()) {
        console.warn(
          "WARNING: Razorpay LIVE credentials detected. This application is a " +
            "prototype and must not be pointed at a live account."
        );
      }
      console.log(`Payment provider: ${selection.description}`);
    } else {
      console.log(
        `Payment provider: ${selection.description} - ${selection.fallbackReason}`
      );
    }
  }
  return cached;
}

export function getProviderDescription(): string {
  if (!cachedDescription) getProvider();
  return cachedDescription;
}

/** Test hook. */
export function resetProviderCache(): void {
  cached = null;
  cachedDescription = "";
}
