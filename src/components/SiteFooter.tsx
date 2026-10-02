import Link from "next/link";
import { CHAIN } from "@/config/network";
import { Wordmark } from "./Wordmark";

export function SiteFooter() {
  return (
    <footer className="shell mt-auto">
      <div className="grid gap-8 border-t border-ink/25 py-10 md:grid-cols-[auto_minmax(0,1fr)] md:gap-20">
        <div>
          <Wordmark className="text-[30px]" />
          <nav aria-label="Footer" className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[15px] font-medium">
            <Link href="/#how-it-works" className="underline-offset-[6px] hover:underline">
              How it works
            </Link>
            <Link href="/#stocks" className="underline-offset-[6px] hover:underline">
              Stocks
            </Link>
            <Link href="/#faq" className="underline-offset-[6px] hover:underline">
              FAQ
            </Link>
            <Link href="/create" className="underline-offset-[6px] hover:underline">
              Create a link
            </Link>
          </nav>
        </div>
        <p className="hint max-w-[78ch] md:justify-self-end">
          Tokenized stock is a token on {CHAIN.name} that tracks a stock or fund. It is not a bank deposit or cash savings: its value moves
          with the market and you can lose money. It may not be available where you live. PAID is not affiliated with, sponsored by or
          endorsed by any company or index provider named on this site; tickers are shown only to identify destinations. Nothing here is
          investment advice.
        </p>
      </div>
    </footer>
  );
}
