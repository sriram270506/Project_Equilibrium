import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Equilibrium — Early payments for suppliers who cannot wait",
    template: "%s · Equilibrium",
  },
  description:
    "Predicts which marketplace suppliers are about to run out of cash, offers them their receivables early at a fair price, and moves the money with bank-grade reliability: idempotency, double-entry ledger, reconciliation, and a verifiable audit trail.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
