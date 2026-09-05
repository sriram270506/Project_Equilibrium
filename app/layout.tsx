import type { Metadata } from "next";
import { Inter_Tight, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/*
 * Three typefaces, each doing one job.
 *
 * The previous build shipped no typeface at all and rendered in the system UI
 * font, which is the single biggest reason an interface reads as generic — it
 * is literally the same face as every other unstyled app on the machine.
 *
 *   Inter Tight     UI and body. Slightly narrower than Inter, which buys back
 *                   density in tables without dropping to a smaller size.
 *   Instrument Serif Display only, 24px and up. A transitional serif is the
 *                   deliberate break from the fintech default: every dashboard
 *                   sets headings in a geometric sans, and a serif at scale
 *                   reads as a financial publication instead of a SaaS panel.
 *   IBM Plex Mono   Every figure and identifier. Tabular by design, and it was
 *                   drawn for technical documents rather than for code, so it
 *                   sits beside prose without shouting.
 *
 * `display: "swap"` on all three: a money console must render its numbers even
 * if a font never arrives.
 */

const sans = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const display = Instrument_Serif({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["400"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Equilibrium — Early payments for suppliers who cannot wait",
    template: "%s · Equilibrium",
  },
  description:
    "An AI finance controller that knows when to act, when to ask, and when not to guess. Predicts which marketplace suppliers are about to run out of cash, offers them their receivables early, and moves the money with idempotency, a double-entry ledger, reconciliation and a verifiable audit trail.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${mono.variable}`}
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
