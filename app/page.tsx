import Link from "next/link";
import { computeDealEconomics } from "@/src/lib/deal-economics";
import { Money } from "@/src/components/ui/primitives";

/**
 * The front door.
 *
 * A reviewer arriving here has five minutes and no context. By the end of the
 * first screen they should know: who is hurt, what we do about it, and what
 * makes it hard. Everything else in the app is downstream of that.
 */

const EXAMPLE_DEAL = computeDealEconomics({
  faceValuePaise: 15000000, // Rs 1,50,000
  daysEarly: 27,
  discountBps: 120,
});

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-surface-page">
      {/* ------------------------------------------------------------- Hero */}
      <section className="border-b border-line-soft bg-surface-inverse">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <p className="eyebrow text-brand">
            Marketplace working capital · Buildathon prototype
          </p>

          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
            Small suppliers go broke waiting to get paid.
            <span className="block text-brand"> Not because they lack revenue.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
            A supplier delivers goods on Monday and gets paid 30 days later.
            Payroll is on Friday. That gap kills otherwise-healthy businesses —
            and it is the single largest cause of MSME failure in India.
          </p>

          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-300">
            <strong className="font-semibold text-white">Equilibrium</strong>{" "}
            predicts which suppliers are about to run short, offers them their
            own money early at a fair price, and then moves that money with the
            reliability guarantees a bank requires.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard/demo"
              className="focusable rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
            >
              Run the 5-minute demo
            </Link>
            <Link
              href="/dashboard"
              className="focusable rounded-md border border-slate-600 px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800"
            >
              Open the operations console
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ The example */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <p className="eyebrow">A concrete case</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-strong">
          Aarav Industrial Components, Pune
        </h2>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-body">
          They are owed <Money paise={EXAMPLE_DEAL.faceValuePaise} /> on an
          invoice due in {EXAMPLE_DEAL.daysEarly} days. At their current burn
          rate they run out of cash in 2.5 days. They are not insolvent — they
          are illiquid, which is a different and fixable problem.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <ExampleStat
            step="Without Equilibrium"
            headline="Borrow at 24%"
            body="Or delay wages, or default to their own suppliers. The shortfall propagates down the chain."
            tone="danger"
          />
          <ExampleStat
            step="With Equilibrium"
            headline={
              <>
                <Money paise={EXAMPLE_DEAL.supplierReceivesPaise} /> today
              </>
            }
            body={`They take a ${(EXAMPLE_DEAL.discountBps / 100).toFixed(2)}% discount to be paid ${EXAMPLE_DEAL.daysEarly} days early — ${EXAMPLE_DEAL.annualizedRatePercent.toFixed(1)}% annualized, well under their alternative.`}
            tone="ok"
          />
          <ExampleStat
            step="The platform"
            headline={
              <>
                Earns <Money paise={EXAMPLE_DEAL.platformEarnsPaise} />
              </>
            }
            body="A return on idle float, against a receivable it can already see. Both sides are better off than doing nothing."
            tone="brand"
          />
        </div>
      </section>

      {/* --------------------------------------------------- The hard part */}
      <section className="border-y border-line-soft bg-surface-card">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <p className="eyebrow">Why this is not a spreadsheet</p>
          <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight text-ink-strong">
            Deciding to pay is easy. Paying correctly, every time, is the
            engineering problem.
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-body">
            The moment real money moves, the interesting failures start. A
            provider call times out after the money has already left. A webhook
            arrives twice. Our records and the provider&apos;s disagree by two
            rupees. Each of these has to be survivable, and provably so.
          </p>

          <div className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            <Guarantee
              title="Never pay twice"
              body="Every instruction carries an idempotency key and a request fingerprint. Retrying a payment returns the original result instead of sending a second one."
            />
            <Guarantee
              title="Never lose a rupee"
              body="Every movement writes balanced double-entry ledger rows inside the same transaction. A trial balance page proves the books foot at any moment."
            />
            <Guarantee
              title="Survive not knowing"
              body="When a provider call times out we record UNKNOWN rather than guessing. Reconciliation later compares our state against the provider and resolves it."
            />
            <Guarantee
              title="Process each event once"
              body="Webhooks are verified by HMAC signature and deduplicated on the provider event id, so a replayed delivery changes nothing."
            />
            <Guarantee
              title="Explain every decision"
              body="Each recommendation stores its feature snapshot and model version, so months later you can reconstruct exactly why money moved."
            />
            <Guarantee
              title="Bound the blast radius"
              body="Policy caps discount rate, per-transaction size, and daily exposure before a human ever sees an offer. The model proposes; policy disposes."
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Flow */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <p className="eyebrow">End to end</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-strong">
          Six steps, each one inspectable
        </h2>

        <ol className="mt-8 space-y-3">
          {FLOW.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-card border border-line-soft bg-surface-card p-4 shadow-card"
            >
              <span className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-wash text-sm font-semibold text-brand-strong">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-strong">
                  {step.title}
                </p>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-body">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/dashboard/demo"
            className="focusable rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            Watch it run
          </Link>
          <Link
            href="/dashboard/scope"
            className="focusable rounded-md border border-line-strong bg-surface-card px-5 py-2.5 text-sm font-semibold text-ink-strong transition-colors hover:bg-surface-sunken"
          >
            What this prototype does not do
          </Link>
        </div>
      </section>

      {/* ---------------------------------------------------------- Footer */}
      <footer className="border-t border-line-soft bg-surface-card">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Demo build. Runs entirely on synthetic data against a mock payment
            provider — no live payment credentials, no real funds, no personal
            data. Model coefficients are fitted on generated data and are not
            calibrated for production lending decisions.
          </p>
        </div>
      </footer>
    </main>
  );
}

const FLOW = [
  {
    title: "Observe",
    body: "Daily cash-flow signals per supplier: balance, inflow, outflow, payment regularity, volatility. Thirty days of history per supplier.",
  },
  {
    title: "Predict",
    body: "A logistic model scores the probability of a cash shortfall within seven days. Because it is additive in log-odds, every prediction decomposes into exact per-feature contributions.",
  },
  {
    title: "Price and bound",
    body: "Policy computes the expected value of the offer, then applies hard caps: maximum discount, per-transaction size, daily exposure. Anything outside the envelope is rejected before a human sees it.",
  },
  {
    title: "Approve",
    body: "An operator reviews the reasoning and the money math, then approves. Above a threshold, a second operator must approve independently.",
  },
  {
    title: "Pay",
    body: "One database transaction writes the payment intent, the balanced ledger entries, the audit record, and the outbox event. Then the instruction goes to the provider with an idempotency key.",
  },
  {
    title: "Prove",
    body: "Webhooks are verified and deduplicated. Reconciliation compares our books against the provider and raises exceptions. The trial balance foots and the audit chain verifies.",
  },
];

function ExampleStat({
  step,
  headline,
  body,
  tone,
}: {
  step: string;
  headline: React.ReactNode;
  body: string;
  tone: "danger" | "ok" | "brand";
}) {
  const toneClasses = {
    danger: "border-danger/25 bg-danger-wash",
    ok: "border-ok/25 bg-ok-wash",
    brand: "border-brand/25 bg-brand-wash",
  }[tone];

  const headlineTone = {
    danger: "text-danger",
    ok: "text-ok",
    brand: "text-brand-strong",
  }[tone];

  return (
    <div className={`rounded-card border p-5 ${toneClasses}`}>
      <p className="text-2xs font-semibold uppercase tracking-wider text-ink-muted">
        {step}
      </p>
      <p className={`mt-2 text-xl font-semibold ${headlineTone}`}>{headline}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-body">{body}</p>
    </div>
  );
}

function Guarantee({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="flex items-baseline gap-2 text-sm font-semibold text-ink-strong">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
        {title}
      </h3>
      <p className="mt-1.5 pl-3.5 text-[14px] leading-relaxed text-ink-body">
        {body}
      </p>
    </div>
  );
}
