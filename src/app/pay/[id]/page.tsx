import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PayPanel, RecipientReceipt } from "@/components/pay/PayPanel";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { CHAIN, USDG, explorerAddress, explorerToken, explorerTx } from "@/config/network";
import { invoiceNumber } from "@/core/invoice";
import { paymentTerms } from "@/core/settlement";
import { formatUsd } from "@/core/split";
import { onchainReceipt } from "@/server/chain";
import { invoices } from "@/server/store";

export const metadata: Metadata = { title: "Invoice", robots: { index: false } };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-4 border-t border-line py-3.5 text-[15.5px] sm:grid-cols-[170px_minmax(0,1fr)]">
      <dt className="font-semibold">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const day = (value: number | string) => new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/**
 * What the payer sees. It shows the invoice and how to pay it — never the
 * recipient's split, which is theirs alone.
 */
export default async function PayPage({ params }: PageProps<"/pay/[id]">) {
  const { id } = await params;
  let invoice = /^[a-z0-9]{6,20}$/.test(id) ? invoices().get(id) : null;
  if (!invoice) notFound();

  const terms = paymentTerms(invoice);
  // The contract is the source of truth: a payment counts even if the payer's browser never reported it.
  if (invoice.status === "open") {
    const receipt = await onchainReceipt(terms.terms);
    if (receipt) {
      invoices().markPaid(invoice.id, { payer: receipt.payer, paidAt: receipt.paidAt, txHash: null, delivered: [], shortfall: null });
      invoice = invoices().get(id)!;
    }
  }

  const amount = formatUsd(invoice.amountCents);
  const payment = invoice.payment;

  return (
    <>
      <SiteHeader />
      <main className="shell pt-10 pb-20 lg:pt-14 lg:pb-28">
        <div className="mx-auto max-w-[640px]">
          <article className="panel px-6 py-8 shadow-[6px_12px_24px_-12px_rgb(72_43_56/0.25)] sm:px-10 sm:py-10">
            <div className="mono flex items-start justify-between gap-6 text-[14px]">
              <div>
                <p className="text-[17px] font-medium">Invoice {invoiceNumber(invoice.sequence)}</p>
                <p className="text-soft">{day(invoice.createdAt)}</p>
              </div>
              <p className={`tag ${payment ? "border-ink bg-ink text-paper" : ""}`}>
                <span className={`size-2 rounded-[2px] ${payment ? "bg-accent" : "bg-accent-deep"}`} aria-hidden="true" />
                {payment ? "Paid" : "Unpaid"}
              </p>
            </div>

            <div className="mt-8 border-t border-ink/60 pt-8 text-center">
              <p className="eyebrow">{payment ? "Amount paid" : "Amount due"}</p>
              <h1 className="mt-2 text-[clamp(44px,11vw,68px)] leading-none font-black tracking-[-0.045em]">{amount}</h1>
              <p className="mono mt-3 text-[16px]">{payment ? `paid in ${USDG.symbol}` : `payable in ${USDG.symbol}`}</p>
            </div>

            <dl className="mt-9 border-b border-line">
              <Row label="For">{invoice.description}</Row>
              {invoice.clientName && <Row label="Billed to">{invoice.clientName}</Row>}
              <Row label="Pay to">
                <a
                  href={explorerAddress(invoice.recipient)}
                  target="_blank"
                  rel="noreferrer"
                  className="mono text-[14px] break-all underline decoration-line underline-offset-4 hover:decoration-ink"
                >
                  {invoice.recipient}
                </a>
              </Row>
              <Row label="Accepted asset">
                {USDG.symbol} ({USDG.onchainName}), a dollar stablecoin.{" "}
                <a href={explorerToken(USDG.address)} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-ink">
                  Token contract
                </a>
              </Row>
              <Row label="Network">
                {CHAIN.name} <span className="text-soft">· chain ID {CHAIN.id}</span>
              </Row>
              <Row label="Status">
                {payment ? (
                  <>
                    Paid on {day(payment.paidAt * 1000)} from{" "}
                    <a href={explorerAddress(payment.payer)} target="_blank" rel="noreferrer" className="mono text-[14px] underline decoration-line underline-offset-4 hover:decoration-ink">
                      {payment.payer.slice(0, 6)}…{payment.payer.slice(-4)}
                    </a>
                    .{" "}
                    {payment.txHash && (
                      <a href={explorerTx(payment.txHash)} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-ink">
                        View the transaction
                      </a>
                    )}
                  </>
                ) : (
                  "Unpaid. No payment has been recorded for this invoice."
                )}
              </Row>
              {!payment && (
                <Row label="Fees">
                  You pay exactly {amount}, plus the network fee in {CHAIN.nativeCurrency.symbol}. PAID adds nothing on top.
                </Row>
              )}
            </dl>

            {payment ? (
              <RecipientReceipt recipient={invoice.recipient} usdgMicro={terms.usdgToRecipient.toString()} delivered={payment.delivered} shortfall={payment.shortfall} />
            ) : (
              <PayPanel id={invoice.id} amountLabel={amount} totalMicro={terms.total.toString()} />
            )}
          </article>
          {!payment && (
            <p className="hint mt-6 text-center">
              You pay the invoice amount in {USDG.symbol}. How the recipient receives it is set by them; there is nothing else for you to choose.
              Cards and bank transfers are not supported.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
