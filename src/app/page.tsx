import Link from "next/link";
import { AllocationPreview } from "@/components/AllocationPreview";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SplitInvoice } from "@/components/SplitInvoice";
import { CHAIN, DESTINATIONS, DESTINATION_KEYS, explorerToken } from "@/config/network";
import { splitAmount } from "@/core/split";

const STEPS = [
  { title: ["Create", "your link"], text: "Set an amount and describe your work." },
  { title: ["Choose", "your split"], text: "Choose how much goes to dollars and stock." },
  { title: ["Get paid", "in stock"], text: "Each payment arrives already split." },
];

const BENEFITS = [
  {
    title: "Keep your usual invoicing flow.",
    text: "Price your work in dollars, the way you already do. The link takes the place of the payment details at the bottom of your invoice.",
  },
  {
    title: "Set your split once.",
    text: "Pick the percentage and the destinations when you create a link. Every payment made through that link follows it.",
  },
  {
    title: "Receive dollars and stock together.",
    text: "The dollar part arrives as USDG and the rest as stock tokens, in the same wallet. Your client never sees or chooses the split.",
  },
];

const FAQ = [
  {
    q: "What does my client pay with?",
    a: `USDG, a dollar stablecoin, sent from a crypto wallet on ${CHAIN.name}. Invoices are written in dollars, but PAID does not take card payments or bank transfers.`,
  },
  {
    q: "What do I receive?",
    a: "USDG for the dollar part and the stock tokens you chose for the rest, both in your wallet. On a $1,000 invoice with 20% allocated to NVDA, that is $800 in USDG and $200 converted to tokenized NVDA, before applicable fees.",
  },
  {
    q: "Can I change my split?",
    a: "Each link carries its own split. To use a different one, create a new link. Links you already shared keep the split they were created with.",
  },
  {
    q: "What is tokenized stock?",
    a: `A token on ${CHAIN.name} that tracks a company’s stock or a fund. It gives you exposure to the price; it is not the same as holding the share at a broker, and it is not cash. Its value rises and falls with the market.`,
  },
  {
    q: "How are conversion fees shown?",
    a: "On the review step before you create a link, read from a live quote. PAID’s settlement contract takes no fee. The swap route that converts USDG into stock tokens charges its own fee on the stock part. Your client pays exactly the invoice amount, plus the network fee.",
  },
  {
    q: "Are the listed companies affiliated with PAID?",
    a: "No. NVIDIA, Apple, Tesla and the providers of the S&P 500 index and its funds are not partners or sponsors of PAID and do not endorse it. Their tickers only identify what a stock token tracks.",
  },
];

const example = { totalCents: 100_000, stockPercent: 20 };

export default function Home() {
  const split = splitAmount(example.totalCents, example.stockPercent);
  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero: centered headline, the split invoice underneath. */}
        <section className="shell pt-8 text-center sm:pt-9">
          <h1 className="display">
            Invoice in dollars. <br />
            Get paid in <span className="hl">Nvidia.</span>
          </h1>
          <p className="lede mx-auto mt-4 max-w-[40ch] sm:max-w-none">A payment link that turns your income into tokenized stock.</p>
          <div className="mt-6 flex flex-col items-center justify-center gap-x-7 gap-y-4 sm:flex-row">
            <Link href="/create" className="btn btn-accent w-full sm:w-auto">
              Create a payment link
            </Link>
            <Link href="#how-it-works" className="link-u text-[15px]">
              See how it works
            </Link>
          </div>
        </section>

        <section className="shell mt-8 pb-10 sm:mt-6 lg:pb-6" aria-label="How a payment is split">
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,3.05fr)_minmax(0,1fr)] lg:gap-9">
            <SplitInvoice
              number="#0142"
              description="Brand identity design"
              totalCents={example.totalCents}
              usdgCents={split.usdgCents}
              stockCents={split.stockCents}
              stockPercent={example.stockPercent}
              stockLabel="NVDA"
              stamp
              animate
            />
            <ol className="grid gap-x-8 sm:grid-cols-3 lg:grid-cols-1 lg:border-l lg:border-line lg:pl-7">
              {STEPS.map((step, i) => (
                <li
                  key={step.text}
                  className={`grid grid-cols-[52px_minmax(0,1fr)] py-6 lg:py-7 ${i > 0 ? "border-t border-line sm:border-t-0 lg:border-t" : ""} ${i === 0 ? "lg:pt-2" : ""}`}
                >
                  <span className="mono pt-1.5 text-[15px] text-soft">0{i + 1}</span>
                  <div>
                    <h2 className="subheading">
                      {step.title[0]} <br className="hidden lg:block" />
                      {step.title[1]}
                    </h2>
                    <p className="mt-2 text-[15.5px] leading-snug text-balance text-soft">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Your work. Your stake. */}
        <section id="how-it-works" className="shell">
          <div className="grid gap-10 border-t border-ink/25 py-16 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)] lg:gap-20 lg:py-24">
            <div>
              <h2 className="heading">
                Your work. <br />
                Your stake.
              </h2>
              <p className="lede mt-6 max-w-[34ch]">
                Move the slider to decide how much of an invoice becomes stock. The rest stays in dollars.
              </p>
            </div>
            <AllocationPreview />
          </div>
        </section>

        {/* Stocks */}
        <section id="stocks" className="shell">
          <div className="border-t border-ink/25 py-16 lg:py-24">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)] lg:items-end lg:gap-20">
              <h2 className="heading max-w-[13ch]">Choose what you build a stake in.</h2>
              <p className="lede">
                These are tokenized stock destinations on {CHAIN.name}, subject to availability. Three track a single company. One is a
                tokenized index fund.
              </p>
            </div>
            <ul className="mt-12 border-b border-line">
              {DESTINATION_KEYS.map((key) => {
                const destination = DESTINATIONS[key];
                return (
                  <li
                    key={key}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-8 gap-y-2 border-t border-line py-6 md:grid-cols-[220px_minmax(0,1fr)_190px_auto]"
                  >
                    <p className="mono text-[30px] leading-none font-medium tracking-[-0.03em] md:text-[34px]">{destination.label}</p>
                    <p className="copy order-3 col-span-2 max-w-[56ch] md:order-none md:col-span-1">{destination.description}</p>
                    <p className="eyebrow order-2 justify-self-end md:order-none md:justify-self-start">
                      {destination.kind === "index" ? "Index fund token" : "Company stock token"}
                    </p>
                    <a
                      href={explorerToken(destination.token.address)}
                      target="_blank"
                      rel="noreferrer"
                      className="mono order-4 col-span-2 text-[13px] text-soft underline decoration-line underline-offset-4 hover:decoration-ink md:order-none md:col-span-1"
                    >
                      {destination.token.address.slice(0, 6)}…{destination.token.address.slice(-4)}
                      <span className="sr-only"> — {destination.token.symbol} token contract on the block explorer</span>
                    </a>
                  </li>
                );
              })}
            </ul>
            <p className="hint mt-5 max-w-[80ch]">
              The listed companies and index providers are not partners or sponsors of PAID. A stock token tracks a price; its value can
              fall as well as rise.
            </p>
          </div>
        </section>

        {/* Practical benefits */}
        <section className="shell" aria-label="Why use PAID">
          <div className="grid border-t border-ink/25 py-16 md:grid-cols-3 lg:py-20">
            {BENEFITS.map((benefit, i) => (
              <div
                key={benefit.title}
                className={`py-7 md:py-0 ${i > 0 ? "border-t border-line md:border-t-0 md:border-l md:pl-9" : ""} ${i < 2 ? "md:pr-9" : ""}`}
              >
                <p className="mono text-[13px] text-muted">0{i + 1}</p>
                <h3 className="subheading mt-4 max-w-[14ch]">{benefit.title}</h3>
                <p className="copy mt-3">{benefit.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* $PAID — deliberately small */}
        <section id="paid-token" className="shell">
          <div className="grid gap-4 border-t border-ink/25 py-12 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] md:gap-20">
            <h2 className="subheading">Lower conversion fees with $PAID.</h2>
            <div className="copy max-w-[62ch]">
              <p>
                $PAID is PAID’s own token. It is intended to give holders a lower conversion fee on the stock part of each payment.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="shell">
          <div className="grid gap-8 border-t border-ink/25 py-16 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)] lg:gap-20 lg:py-24">
            <h2 className="heading">Questions.</h2>
            <div className="faq border-b border-line">
              {FAQ.map((item) => (
                <details key={item.q} className="border-t border-line">
                  <summary>{item.q}</summary>
                  <p className="copy max-w-[68ch] pb-6">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="shell">
          <div className="flex flex-col items-start justify-between gap-6 border-t border-ink/25 py-14 sm:flex-row sm:items-center">
            <p className="subheading max-w-[22ch]">Turn your next invoice into a stake.</p>
            <Link href="/create" className="btn btn-accent w-full sm:w-auto">
              Create a payment link
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
