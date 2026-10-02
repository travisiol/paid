import type { Metadata, Viewport } from "next";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import { WalletDialog } from "@/components/WalletDialog";
import "./globals.css";

// Both families are downloaded at build time and served from this origin.
// latin-ext carries the dotless "ı" the wordmark is set with.
const sans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin", "latin-ext"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "paid — Invoice in dollars. Get paid in stock.", template: "%s · paid" },
  description: "A payment link that turns part of your income into tokenized stock. Your client pays in USDG; you receive dollars and stock.",
};

export const viewport: Viewport = { themeColor: "#f6f2e9" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        {children}
        <WalletDialog />
      </body>
    </html>
  );
}
