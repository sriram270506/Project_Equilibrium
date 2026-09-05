# Runbook

Operational procedures for Equilibrium. Written so someone who did not build it
can deploy, diagnose, and recover it.

**Scope caveat:** the deployment target for this prototype is a single process
with SQLite. Sections marked *(production)* describe what would be required for
a real deployment and are **not implemented** — see [SCOPE.md](SCOPE.md).

---

## Environment variables

| Variable | Required | Default | Effect |
|---|---|---|---|
| `DATABASE_URL` | yes | `file:./prisma/dev.db` | Prisma connection string |
| `APP_MODE` | no | `demo` | `demo` enables reset/inject endpoints. Anything else disables them |
| `RAZORPAY_MODE` | no | `mock` | `mock` uses the simulator. Anything else requires real credentials **and** a webhook secret |
| `RAZORPAY_KEY_ID` | if not mock | — | Test key (`rzp_test_…`) |
| `RAZORPAY_KEY_SECRET` | if not mock | — | Never logged, never sent to the client |
| `RAZORPAY_WEBHOOK_SECRET` | **if not mock** | — | Without it, outside mock mode **every webhook is rejected**. This is intentional |
| `RAZORPAY_API_MODE` | no | `orders` | `orders` works with any test key; `payouts` needs RazorpayX |
| `RAZORPAY_ACCOUNT_NUMBER` | payouts only | — | RazorpayX virtual account |
| `LOG_LEVEL` | no | `info` | `debug` \| `info` \| `warn` \| `error` |
| `SEED_REFERENCE_DATE` | no | today | Fix it (`2026-09-01`) for bit-identical seeds |

Copy `.env.example` to `.env`. The app runs with no changes.

---

## First run

```bash
npm ci                # postinstall generates the Prisma client
npm run db:setup      # generate + push schema + seed
npm run demo:verify   # 49 checks, should all pass
npm run dev
```

`demo:verify` seeds an empty database itself, so `db:setup` is optional before
it — but you need it before `npm run dev` shows any data.

**`npm run dev` deliberately does not run `prisma generate` or `prisma db push`.**
Two reasons:

1. On Windows, any node process holding `query_engine-windows.dll.node` — a
   dev server you forgot was running, or one that did not shut down cleanly —
   makes `prisma generate` fail with `EPERM: operation not permitted, unlink`.
   Regenerating on every start meant a stale process blocked you from starting
   a new one at all.
2. `prisma db push` in `dev` and `build` meant starting the app, or building
   it, silently altered whatever `DATABASE_URL` pointed at. A build must never
   mutate a database.

Run `npm run db:setup` when the schema changes. That is the only time you need
it.

---

## Health

`GET /api/health` returns `200` when healthy and `503` when degraded, with
`degradedReasons` naming each failing check:

- `database` — connectivity
- `provider` — mock or live, and why
- `webhooks` — **misconfigured if not mock and no secret**
- `ledger` — trial balance foots
- `auditChain` — hash chain verifies
- `backlog` — dead-lettered events, open critical exceptions

It also returns counters and timings under `metrics`.

---

## Incident procedures

### Payments are failing

1. `GET /api/health` — check `provider` and `webhooks`.
2. If the cause is unclear or losses may be accumulating, **engage the kill
   switch** at `/dashboard/controls`. This blocks every new payment
   immediately and writes an audit entry. It does not affect payments already
   with the provider.
3. Filter logs by `msg` prefix: `webhook.*`, `payment.*`, `outbox.*`.
4. Check `/dashboard/reconciliation` for `CRITICAL` exceptions.
5. Once fixed, release the kill switch. It requires the `ADMIN` role.

### Webhooks are being rejected

Read the `reason` in the response and the log line:

| Reason | Meaning | Action |
|---|---|---|
| `NOT_CONFIGURED` | Not in mock mode and no `RAZORPAY_WEBHOOK_SECRET` | Set the secret. This is a misconfiguration, not an attack |
| `MISSING_SIGNATURE` | No `X-Razorpay-Signature` header | Check the provider's webhook configuration |
| `INVALID_SIGNATURE` | HMAC mismatch | Secret is wrong, or the body was modified in transit by a proxy |
| `STALE_TIMESTAMP` | Older than the 24h replay window | Usually a genuine replay. Investigate before widening the window |
| `SCHEMA_INVALID` | Payload failed validation | Provider changed its schema, or the request is not from them |

### A payment is stuck in UNKNOWN

This is the designed behaviour after a provider timeout, not a bug.

1. Run reconciliation (`/dashboard/reconciliation` → Run reconciliation).
2. If the provider confirms it, the state is repaired automatically.
3. If the provider has no record, a `MISSING_EXTERNAL` case is raised for an
   operator. **Do not manually mark it confirmed** — resolve the case with a
   reason so the judgement is auditable.

### A payment is stuck in PENDING_APPROVAL

It is above the dual-approval threshold. A second operator with the `APPROVER`
role must approve it, and it cannot be the person who raised it. There is
currently **no automatic expiry** on these — a known gap.

### Events are dead-lettered

```bash
curl -H "X-API-Key: <viewer key>" localhost:3000/api/internal/events/publish
```

Shows pending, published, and failed counts plus each dead letter's last error.
To replay one after fixing the cause:

```bash
curl -X POST localhost:3000/api/internal/events/publish \
  -H "Content-Type: application/json" -H "X-API-Key: <operator key>" \
  -d '{"replayEventId":"<id>","reason":"Downstream schema fixed in #123"}'
```

A reason is mandatory and is written to the audit chain.

### The ledger does not balance

Treat this as a stop-the-line event.

1. Engage the kill switch.
2. `/dashboard/ledger` shows the per-account breakdown and the difference.
3. This should be impossible: `assertJournalBalanced` rejects unbalanced
   journals before they are written. If it has happened, either a write path
   bypassed that guard or the database was modified directly.
4. **Never** "fix" it by editing rows. Post a correcting journal — see
   `buildReversalJournal`.

### The audit chain is broken

`GET /api/health` reports the first broken entry and why:

- `CONTENT_ALTERED` — a row was edited after it was written
- `CHAIN_BROKEN` — an entry points at the wrong predecessor
- `SEQUENCE_GAP` — a row was deleted

All three mean someone or something wrote to the database outside the
application. Preserve the database before investigating.

Note the trust boundary: the chain anchor lives in the same database, so an
attacker with write access could recompute it. This detects accidental and
casual modification, not a determined insider.

### Empty database / demo not working

```bash
npx prisma db push --force-reset
npm run db:seed
npm run demo:verify
```

Destroys all data. Safe for the demo — everything is synthetic.

---

## Deployment *(production — not implemented)*

What would be required, stated so the gap is explicit:

1. **Database.** Replace SQLite with PostgreSQL and adopt
   `prisma migrate deploy` with a committed migration history. `db push` has no
   history and cannot be rolled back.
2. **Migrations.** Expand-contract only: add columns nullable, backfill, then
   make them required in a later release, so the previous version keeps running
   during a deploy.
3. **Rollback.** Application rollback is a redeploy of the previous image.
   Database rollback is *not* generally possible — this is why migrations must
   be backward-compatible for at least one release.
4. **Outbox worker.** Run the publisher as a scheduled process, not via an
   HTTP endpoint. A request-triggered drain stops when nobody calls it.
5. **Backups.** Point-in-time recovery with a tested restore. Untested backups
   are not backups.
6. **Secrets.** A managed store with rotation. Never in `.env` on a server.
7. **Demo endpoints.** `/api/demo/*` are gated on `APP_MODE=demo`. Verify that
   gate before any non-demo deployment.

---

## Five-minute recovery

| Symptom | Fix |
|---|---|
| `npm ci` fails | Node ≥18.18 required; delete `node_modules` and retry |
| `PrismaClientInitializationError` | `npx prisma generate` |
| Empty dashboard | `npm run db:seed` |
| `EPERM: ... unlink query_engine-windows.dll.node` | A node process holds the Prisma engine. `npm run dev` no longer regenerates, so this only affects `db:setup` and `build` — stop the dev server first (see below) |
| Every webhook rejected | Set `RAZORPAY_WEBHOOK_SECRET`, or set `RAZORPAY_MODE=mock` |
| `demo:verify` fails | Read the failing check name; it names the invariant that broke |
| Port 3000 in use | `npm run dev -- -p 3001`, or stop the holder (below) |
| Schema changed but types are stale | `npm run db:setup` |

### Stopping a stuck dev server (Windows)

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  Select-Object -ExpandProperty OwningProcess |
  ForEach-Object { Stop-Process -Id $_ -Force }
```
