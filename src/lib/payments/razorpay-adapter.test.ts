import { describe, it, expect, vi, afterEach } from "vitest";
import { RazorpayAdapter, RazorpayError } from "./razorpay-adapter";

/**
 * How the adapter distinguishes "the provider has no such object" from "we
 * asked a bad question".
 *
 * These exist because the live check found the adapter had it wrong. It
 * treated a 404 as the absent case, which is what REST convention says and
 * what the mock provider returns — but Razorpay answers a well-formed but
 * absent order id with `400 BAD_REQUEST_ERROR "The id provided does not
 * exist"`. Reconciliation would have thrown on precisely the case it exists to
 * detect.
 *
 * The mock could not have caught this: it was written to the same wrong
 * assumption as the adapter. Only talking to the real API did.
 */

function adapterWithResponse(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    })
  );

  return new RazorpayAdapter({
    keyId: "rzp_test_fake",
    keySecret: "fake-secret",
    mode: "orders",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getOperation — absent versus malformed", () => {
  it("returns null for Razorpay's 400 'does not exist'", async () => {
    const adapter = adapterWithResponse(400, {
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "The id provided does not exist",
      },
    });

    // The real shape of a missing object on the Orders API.
    await expect(
      adapter.getOperation("order_ZZZZZZZZZZZZZZ")
    ).resolves.toBeNull();
  });

  it("still returns null for a conventional 404", async () => {
    const adapter = adapterWithResponse(404, {
      error: { code: "NOT_FOUND", description: "not found" },
    });

    await expect(adapter.getOperation("order_ZZZZZZZZZZZZZZ")).resolves.toBeNull();
  });

  it("throws for a malformed id, which is our bug and not a finding", async () => {
    const adapter = adapterWithResponse(400, {
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "order_DoesNotExist000 is not a valid id",
      },
    });

    /*
     * Reporting a mistyped reference as "the provider has no record" would
     * turn our own error into a finding about someone else, and a
     * reconciliation case would be opened against a payment that was never
     * really looked up.
     */
    await expect(
      adapter.getOperation("order_DoesNotExist000")
    ).rejects.toThrow(RazorpayError);
  });

  it("propagates a server error rather than reporting the object missing", async () => {
    const adapter = adapterWithResponse(500, {
      error: { code: "SERVER_ERROR", description: "we are having trouble" },
    });

    // A 500 means we do not know. Returning null would record "the provider
    // has no record of this payment" on no evidence at all.
    await expect(
      adapter.getOperation("order_ZZZZZZZZZZZZZZ")
    ).rejects.toThrow(RazorpayError);
  });

  it("marks 5xx retryable and 4xx not", async () => {
    const server = adapterWithResponse(503, {
      error: { code: "SERVER_ERROR", description: "unavailable" },
    });
    await server.getOperation("order_ZZZZZZZZZZZZZZ").catch((e) => {
      expect(e).toBeInstanceOf(RazorpayError);
      expect((e as RazorpayError).retryable).toBe(true);
    });

    vi.unstubAllGlobals();

    const client = adapterWithResponse(400, {
      error: { code: "BAD_REQUEST_ERROR", description: "not a valid id" },
    });
    await client.getOperation("order_bad").catch((e) => {
      expect((e as RazorpayError).retryable).toBe(false);
    });
  });
});
