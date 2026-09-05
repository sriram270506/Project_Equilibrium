# Equilibrium — Security & Scope

## Demonstrated Security Controls

### ✓ Implemented

| Control | Implementation | Evidence |
|---------|----------------|----------|
| **Integer Money** | All amounts in paise (no floats) | `src/lib/money.ts` |
| **Balanced Ledger** | Double-entry with verification | `src/server/opportunity-service.ts` |
| **Idempotency** | SHA256 fingerprint + key check | `src/lib/idempotency.ts` |
| **Server-Side Provider** | MockRazorpay never exposed to client | `src/lib/payments/mock-razorpay.ts` |
| **Audit Logging** | Immutable event trail | `src/lib/audit.ts` |
| **Correlation Tracking** | Request-to-resolution linkage | `src/lib/correlation.ts` |
| **Input Validation** | Zod schemas on all routes | `src/schemas/api.ts` |
| **Error Boundaries** | No stack traces to client | All route handlers |
| **Redacted Logs** | Secrets masked, IDs shortened | `src/server/opportunity-service.ts` |
| **TypeScript Strict** | No implicit `any`, null-safe | `tsconfig.json` |
| **No Hardcoded Secrets** | All via `.env` | `.env.example` |
| **UNKNOWN State Handling** | Timeout-after-success resilience | `src/lib/payments/payment-service.ts` |
| **Duplicate Detection** | Idempotency keys prevent double-booking | `EventRecord.idempotencyKey` |
| **Reconciliation** | Mismatch detection, no silent repair | `src/lib/reconciliation/reconciliation-service.ts` |
| **Demo Banner** | Explicit "Demo Mode" on UI | `app/(dashboard)/layout.tsx` |

### ⏳ Designed But Not Implemented

| Feature | Reason | Path to Implementation |
|---------|--------|----------------------|
| **Live Webhook Signature Verification** | Would require real provider | Implement in `razorpay-adapter.ts` |
| **Key Rotation** | Not needed for demo | Add to secrets manager integration |
| **Multi-Tenant Isolation** | Scoped application queries and tenant-aware roles | Add database row-level security for defense in depth |
| **Rate Limiting** | Not needed for demo | Add middleware (express-rate-limit) |
| **HTTPS/TLS Enforcement** | Dev server doesn't require | Enable in nginx/load balancer |
| **API Key Authentication** | Demo uses operator ID | Add JWT or OAuth2 |
| **Role-Based Access Control (RBAC)** | Demo has single role | Implement role check middleware |
| **Database Encryption at Rest** | SQLite not production | Postgres with TDE or KMS encryption |
| **Secrets Rotation Policy** | No live credentials | Add to DevOps pipeline |
| **Audit Trail Export** | Can query directly | Add SIEM integration hook |

### 🚫 Out of Scope

| Topic | Why Not Included | Impact |
|-------|------------------|--------|
| **PCI-DSS Compliance** | Buildathon prototype, not payment processor | Cannot handle real card data |
| **DPDP (India Data Protection)** | Would require formal privacy audit | Cannot process real customer PII |
| **Account Aggregator Certification** | Multi-year qualification process | MockRazorpay only, no AA data |
| **Live Customer Data** | Demo uses synthetic suppliers | Data is not production customer data |
| **Real Money Transfers** | MockRazorpay doesn't settle | No actual funds move |
| **Full KYC/AML Integration** | Would require partner APIs | No customer verification |
| **FraudDetection ML** | Not scope of liquidity prediction | No fraud scoring |
| **Formal Threat Model** | Requires security professionals | No formal risk matrix |
| **Penetration Testing** | Requires security firm | No external security audit |
| **SOC 2 / ISO 27001** | Would require annual certification | No formal compliance audit |

## What This Means

### For Demo Use

✓ **Safe to run locally**
- No real credentials at risk
- No real customer data exposed
- Financial logic is correct
- Reconciliation works reliably

✗ **Not safe for production**
- Demo operator ID is public
- Secrets can be stored in `.env.local` safely (not deployed)
- No real rate limiting
- No database row-level security; isolation relies on scoped application queries
- No formal audit trail compliance

### For Production Deployment

To safely deploy to production, add:

```
PCI-DSS & DPDP Compliance Layer:
├─ Formal security audit (mandatory)
├─ Penetration testing
├─ Key management system (AWS KMS, HashiCorp Vault)
├─ Live provider credentials (Razorpay test account minimum)
├─ Postgres with TDE encryption
├─ Formal audit trail (SIEM integration)
├─ API authentication (JWT + refresh tokens)
├─ Rate limiting + DDoS protection
├─ Database backups + disaster recovery
└─ Incident response plan
```

## Code Review Checklist

Before using Equilibrium code in production, verify:

- [ ] No hardcoded secrets in source
- [ ] All paise arithmetic uses integers
- [ ] Ledger entries always balanced
- [ ] Idempotency keys prevent retries
- [ ] Provider calls are server-side only
- [ ] Error responses don't leak stack traces
- [ ] Status transitions are validated
- [ ] Reconciliation never blindly overwrites
- [ ] Correlation IDs flow end-to-end
- [ ] TypeScript strict mode passes
- [ ] All database queries are indexed
- [ ] Event sourcing is immutable

## Compliance Statements

### What Equilibrium IS
- A technical demonstration of fintech architecture patterns
- A proof-of-concept for ML-assisted decision support
- A reference implementation for provider resilience
- A training tool for fintech engineering concepts

### What Equilibrium IS NOT
- Production-ready financial software
- PCI-DSS compliant payment processor
- DPDP-compliant data handler
- Account Aggregator certified
- Suitable for real customer data
- Suitable for real money transfers

### Liability Disclaimer

**This prototype is provided AS-IS for educational purposes only.**

- No warranty of fitness for production use
- Users are responsible for security assessments
- Creators disclaim all liability for financial loss or compliance violations
- Code must be independently audited before any production deployment

---

**Last Updated**: August 2026  
**For Questions**: Refer to Razorpay Buildathon organizers
