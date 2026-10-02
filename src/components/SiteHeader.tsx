import Link from "next/link";
import { WalletButton } from "./WalletDialog";
import { Wordmark } from "./Wordmark";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#stocks", label: "Stocks" },
];

export function SiteHeader() {
  return (
    <header className="shell">
      <div className="flex h-[76px] items-center justify-between gap-6 border-b border-ink/25">
        <Link href="/" aria-label="paid — home" className="-mt-1">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-8">
          <nav aria-label="Main" className="hidden items-center gap-8 text-[15px] font-medium sm:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="underline-offset-[6px] hover:underline">
                {item.label}
              </Link>
            ))}
          </nav>
          <WalletButton />
        </div>
      </div>
      {/* Phones: the same links on their own row, so nothing hides behind a menu. */}
      <nav aria-label="Main" className="flex h-11 items-center gap-6 border-b border-line text-[15px] font-medium sm:hidden">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
