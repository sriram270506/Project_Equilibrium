import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Equilibrium - Marketplace Finance Operations",
  description: "Bounded intelligence for safer payment operations",
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
