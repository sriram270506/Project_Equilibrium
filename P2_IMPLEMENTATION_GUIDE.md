# P2 Implementation Guide

Quick patterns for applying the new security middleware to existing routes.

## Pattern 1: Add Error Handling

**Before:**
```typescript
export async function POST(request: NextRequest) {
  try {
    const payment = await prisma.paymentIntent.findUnique({ ... });
    if (!payment) {
      return NextResponse.json(
        errorEnvelope("NOT_FOUND", "Payment not found"),
        { status: 404 }
      );
    }
    // ... more logic
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      errorEnvelope("INTERNAL_ERROR", "Failed"),
      { status: 500 }
    );
  }
}
```

**After:**
```typescript
import { withErrorHandler, handleApiError } from "@/src/lib/api/error-handler";
import { NotFoundError } from "@/src/lib/errors";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const payment = await prisma.paymentIntent.findUnique({ ... });
  if (!payment) {
    throw new NotFoundError("Payment not found");
  }
  // ... more logic - errors automatically caught and formatted
  return NextResponse.json(successEnvelope(result), { status: 200 });
});
```

**Benefits:**
- Shorter code
- Consistent error handling
- No try-catch boilerplate

---

## Pattern 2: Add Authorization

**Before:**
```typescript
export async function POST(request: NextRequest) {
  // No auth check - vulnerability!
  const body = await request.json();
  await prisma.paymentIntent.update({ ... });
}
```

**After:**
```typescript
import { withAuth, getCaller } from "@/src/lib/api/auth-middleware";

export const POST = withAuth("APPROVER", async (request: NextRequest) => {
  const caller = getCaller(request); // { userId, email, role }
  const body = await request.json();
  
  await createAuditEvent({
    actorType: "OPERATOR",
    actorId: caller.userId,
    eventType: "PAYMENT_APPROVED",
    // ...
  });
  
  await prisma.paymentIntent.update({ ... });
  return NextResponse.json(successEnvelope(result), { status: 200 });
});
```

**Combines with error handling:**
```typescript
export const POST = withErrorHandler(
  withAuth("APPROVER", async (request: NextRequest) => {
    const caller = getCaller(request);
    // ... logic, errors caught by handler
  })
);
```

**Role Options:** VIEWER, OPERATOR, APPROVER, ADMIN

---

## Pattern 3: Add Request Validation

**Before:**
```typescript
const limit = parseInt(request.nextUrl.searchParams.get("limit") || "20");
const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0");
// No validation — accepts negative, huge values, non-numbers
```

**After:**
```typescript
import { GetPaymentsQuerySchema } from "@/src/schemas/api";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const result = GetPaymentsQuerySchema.safeParse(query);
  
  if (!result.success) {
    throw new ValidationError("Invalid query parameters", {
      errors: result.error.flatten(),
    });
  }
  
  const { limit, offset } = result.data; // { limit: number, offset: number }
  // Now safe to use
}
```

**Available schemas:**
- `GetPaymentsQuerySchema` - limit, offset, status, supplierId
- `GetOpportunitiesQuerySchema` - limit, offset, status, riskTier
- `GetReconciliationQuerySchema` - limit, offset, status, outcome
- `GetDisputesQuerySchema` - limit, offset, status
- `ApprovePaymentRequestSchema` - { paymentId }
- `ResolveReconciliationRequestSchema` - { caseId, resolution, notes }
- And 15+ others

---

## Pattern 4: Add Idempotency

**Before:**
```typescript
export async function POST(request: NextRequest) {
  const body = await request.json();
  
  // Approval logic - if retry happens, creates duplicate!
  const paymentIntent = await prisma.paymentIntent.update({
    where: { id: body.paymentId },
    data: { status: "CONFIRMED" },
  });
  
  return NextResponse.json(successEnvelope(paymentIntent), { status: 200 });
}
```

**After:**
```typescript
import { 
  extractIdempotencyKey, 
  checkIdempotency, 
  markIdempotencyPending,
  markIdempotencySuccess,
  hashRequestBody,
} from "@/src/lib/api/idempotency-middleware";

export const POST = withAuth("APPROVER", async (request: NextRequest) => {
  const idempotencyKey = extractIdempotencyKey(request); // Required header
  const body = await request.json();
  const requestHash = hashRequestBody(body);
  
  // Check if already processed
  const cached = await checkIdempotency(
    idempotencyKey,
    "APPROVE_PAYMENT",
    requestHash
  );
  if (cached) {
    // Return cached result
    return NextResponse.json(
      successEnvelope({ paymentId: cached.operationId }),
      { status: 200 }
    );
  }
  
  // Mark as pending
  await markIdempotencyPending(
    idempotencyKey,
    "APPROVE_PAYMENT",
    requestHash,
    body.paymentId
  );
  
  try {
    // Approval logic
    const paymentIntent = await prisma.paymentIntent.update({
      where: { id: body.paymentId },
      data: { status: "CONFIRMED" },
    });
    
    // Mark successful
    await markIdempotencySuccess(idempotencyKey, hashRequestBody(paymentIntent));
    
    return NextResponse.json(successEnvelope(paymentIntent), { status: 200 });
  } catch (error) {
    // Mark failed
    await markIdempotencyFailed(idempotencyKey, String(error));
    throw error;
  }
});
```

**Client usage:**
```typescript
// Must include Idempotency-Key header on retry
fetch("/api/payments/123/approve", {
  method: "POST",
  headers: {
    "Idempotency-Key": "my-approval-001", // Must be same on retry
  },
  body: JSON.stringify({ paymentId: "123" }),
});

// Retry with same key returns cached result
fetch("/api/payments/123/approve", {
  method: "POST",
  headers: {
    "Idempotency-Key": "my-approval-001", // Same key
  },
  body: JSON.stringify({ paymentId: "123" }),
});
```

---

## Pattern 5: Combine All Patterns

**Complete Example: POST /api/payments/:id/approve**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withAuth, getCaller } from "@/src/lib/api/auth-middleware";
import { withErrorHandler } from "@/src/lib/api/error-handler";
import {
  extractIdempotencyKey,
  checkIdempotency,
  markIdempotencyPending,
  markIdempotencySuccess,
  markIdempotencyFailed,
  hashRequestBody,
} from "@/src/lib/api/idempotency-middleware";
import { ApprovePaymentRequestSchema } from "@/src/schemas/api";
import { UnauthorizedError, ValidationError } from "@/src/lib/errors";
import { successEnvelope } from "@/src/lib/api-envelope";
import { prisma } from "@/src/lib/prisma";
import { createAuditEvent } from "@/src/lib/audit";
import { assertPaymentTransition } from "@/src/lib/state-machine";

export const POST = withErrorHandler(
  withAuth("APPROVER", async (request: NextRequest) => {
    const caller = getCaller(request);
    const idempotencyKey = extractIdempotencyKey(request);
    
    // Validate request body
    const bodyText = await request.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new ValidationError("Invalid JSON");
    }
    
    const validated = ApprovePaymentRequestSchema.safeParse(body);
    if (!validated.success) {
      throw new ValidationError("Invalid request", {
        errors: validated.error.flatten(),
      });
    }
    
    const requestHash = hashRequestBody(body);
    
    // Check idempotency
    const cached = await checkIdempotency(
      idempotencyKey,
      "APPROVE_PAYMENT",
      requestHash
    );
    if (cached) {
      return NextResponse.json(
        successEnvelope({
          paymentId: cached.operationId,
          cached: true,
          message: "This payment was already approved",
        }),
        { status: 200 }
      );
    }
    
    // Mark as pending
    await markIdempotencyPending(
      idempotencyKey,
      "APPROVE_PAYMENT",
      requestHash,
      validated.data.paymentId
    );
    
    try {
      // Get payment
      const payment = await prisma.paymentIntent.findUnique({
        where: { id: validated.data.paymentId },
      });
      
      if (!payment) {
        throw new NotFoundError("Payment not found");
      }
      
      // Prevent self-approval (maker-checker)
      const creator = await prisma.auditEvent.findFirst({
        where: {
          aggregateId: payment.id,
          eventType: "PAYMENT_SUBMITTED",
        },
        orderBy: { createdAt: "asc" },
      });
      
      if (creator?.actorId === caller.userId) {
        throw new UnauthorizedError(
          "Cannot approve your own payment (maker-checker required)"
        );
      }
      
      // Validate state transition
      assertPaymentTransition(payment.status as any, "CONFIRMED");
      
      // Approve
      const approved = await prisma.paymentIntent.update({
        where: { id: payment.id },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
      });
      
      // Audit
      await createAuditEvent({
        eventType: "PAYMENT_APPROVED",
        actorType: "OPERATOR",
        actorId: caller.userId,
        aggregateType: "PAYMENT_INTENT",
        aggregateId: payment.id,
        payload: { approvedBy: caller.email },
        correlationId: payment.correlationId,
      });
      
      // Mark successful
      await markIdempotencySuccess(idempotencyKey, hashRequestBody(approved));
      
      return NextResponse.json(
        successEnvelope({
          paymentId: approved.id,
          status: approved.status,
          checkedBy: caller.email,
          checkedAt: new Date(),
          message: "Payment approved successfully",
        }),
        { status: 200 }
      );
    } catch (error) {
      await markIdempotencyFailed(idempotencyKey, String(error));
      throw error;
    }
  })
);
```

**This single route now has:**
- ✅ Authorization check (APPROVER role)
- ✅ Error handling (all errors caught + formatted)
- ✅ Request validation (Zod schema)
- ✅ Idempotency (safe retries)
- ✅ State machine validation (correct transitions only)
- ✅ Maker-checker enforcement (prevent self-approval)
- ✅ Audit trail (who, when, what)

---

## Applying to Your Codebase

**6 Unprotected Routes (Priority 1):**

1. POST `/api/disputes/:id/draft`
   - Add `withAuth("OPERATOR", ...)`

2. POST `/api/reconciliation/run`
   - Add `withAuth("OPERATOR", ...)`
   - Add idempotency

3. POST `/api/demo/reset`
   - Demo-only, add `withAuth("ADMIN", ...)`

4. POST `/api/demo/scenario`
   - Demo-only, add `withAuth("OPERATOR", ...)`

5. POST `/api/internal/events/publish`
   - Internal only, add special internal-auth check

6. POST `/api/webhooks/razorpay`
   - Already has HMAC check, add idempotency + error handler

**Already Protected (Update to Use Patterns):**
- POST `/api/opportunities/:id/approve` - has auth, add idempotency + error handler
- POST `/api/payments/:id/approve` - has auth, add idempotency + error handler
- POST `/api/reconciliation/:id/resolve` - has auth, add idempotency + error handler
- GET endpoints - add error handler + validation

---

## Testing Checklist

For each updated route, add tests:

```typescript
describe("POST /api/payments/:id/approve", () => {
  it("should require APPROVER role", async () => {
    const response = await fetch(".../approve", {
      method: "POST",
      headers: { "Authorization": "Bearer viewer-key" },
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should return cached result on idempotency key retry", async () => {
    const key = "test-" + Date.now();
    
    const res1 = await fetch(".../approve", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ paymentId: "123" }),
    });
    expect(res1.status).toBe(200);
    const result1 = await res1.json();

    const res2 = await fetch(".../approve", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ paymentId: "123" }),
    });
    expect(res2.status).toBe(200);
    const result2 = await res2.json();
    
    expect(result2.cached).toBe(true);
  });

  it("should reject invalid request body", async () => {
    const response = await fetch(".../approve", {
      method: "POST",
      body: JSON.stringify({ wrongField: "value" }),
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should prevent self-approval (maker-checker)", async () => {
    // Create payment with operator1
    // Try to approve with operator1
    // Should fail with UNAUTHORIZED
  });
});
```

---

## Rollout Order

1. **Error handler** - Apply to all routes (safe, non-breaking)
2. **Request validation** - Add schema checks (safe, non-breaking)
3. **Authorization** - Wrap unprotected routes (may break if no auth header)
4. **Idempotency** - Add to approval/financial routes (safe, adds header requirement)

Each step can be deployed independently.
