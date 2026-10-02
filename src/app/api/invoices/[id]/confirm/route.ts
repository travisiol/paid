import { SETTLEMENT_ADDRESS, paymentTerms, verifyPayment } from "@/core/settlement";
import { onchainReceipt, publicClient } from "@/server/chain";
import { quoteSwaps } from "@/server/quotes";
import { invoices } from "@/server/store";

/** A delivered amount this far under a fresh quote is flagged for the recipient. */
const SHORTFALL_BPS = 500;

/**
 * The payer's browser reports its transaction. Nothing is taken on trust:
 * the receipt is read from the chain and must contain the contract's
 * InvoicePaid event for this invoice's exact terms.
 */
export async function POST(request: Request, context: RouteContext<"/api/invoices/[id]/confirm">): Promise<Response> {
  const { id } = await context.params;
  const invoice = /^[a-z0-9]{6,20}$/.test(id) ? invoices().get(id) : null;
  if (!invoice) return Response.json({ error: "This invoice does not exist." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { txHash?: unknown } | null;
  const txHash = body?.txHash;
  if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) return Response.json({ error: "Invalid transaction hash." }, { status: 400 });
  if (invoice.payment?.txHash) return Response.json({ status: "paid" });

  const terms = paymentTerms(invoice);
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    return Response.json({ error: "That transaction is not confirmed yet." }, { status: 404 });
  }
  const verified = verifyPayment(receipt, { settlement: SETTLEMENT_ADDRESS, terms: terms.terms });
  if (!verified) return Response.json({ error: "That transaction did not pay this invoice." }, { status: 422 });

  // Compare what arrived with a fresh quote, so an unusually poor conversion is visible to the recipient.
  let shortfall: boolean | null = terms.swaps.length === 0 ? false : null;
  if (terms.swaps.length > 0) {
    try {
      const fresh = await quoteSwaps(invoice.recipient, terms.swaps);
      shortfall = terms.swaps.some((swap, i) => {
        const got = BigInt(verified.delivered.find((d) => d.token === swap.token.toLowerCase())?.amountOut ?? "0");
        return got * BigInt(10_000) < BigInt(fresh[i].minOut) * BigInt(10_000 - SHORTFALL_BPS);
      });
    } catch {
      shortfall = null;
    }
  }

  const onchain = await onchainReceipt(terms.terms);
  invoices().markPaid(invoice.id, {
    payer: verified.payer,
    paidAt: onchain?.paidAt ?? Math.floor(Date.now() / 1000),
    txHash: txHash.toLowerCase(),
    delivered: verified.delivered,
    shortfall,
  });
  return Response.json({ status: "paid" });
}
