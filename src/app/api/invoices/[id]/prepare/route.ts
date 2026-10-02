import { SETTLEMENT_ADDRESS, payCalldata, paymentTerms } from "@/core/settlement";
import { onchainReceipt, settlementDeployed } from "@/server/chain";
import { isQuoteError, quoteSwaps } from "@/server/quotes";
import { invoices } from "@/server/store";

/**
 * Everything a payer's wallet needs to pay this invoice now: the exact
 * approval and the pay() call, built from the stored invoice and live quotes.
 */
export async function POST(_request: Request, context: RouteContext<"/api/invoices/[id]/prepare">): Promise<Response> {
  const { id } = await context.params;
  const invoice = /^[a-z0-9]{6,20}$/.test(id) ? invoices().get(id) : null;
  if (!invoice) return Response.json({ error: "This invoice does not exist." }, { status: 404 });
  if (!(await settlementDeployed())) return Response.json({ error: "The settlement contract is not deployed yet." }, { status: 503 });

  const terms = paymentTerms(invoice);
  if (invoice.status === "paid" || (await onchainReceipt(terms.terms))) return Response.json({ error: "This invoice is already paid." }, { status: 409 });

  try {
    const swaps = await quoteSwaps(invoice.recipient, terms.swaps);
    return Response.json({ settlement: SETTLEMENT_ADDRESS, total: terms.total.toString(), data: payCalldata(terms, swaps) });
  } catch (error) {
    if (isQuoteError(error)) return Response.json({ error: error.message }, { status: 502 });
    console.error("[paid] prepare failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return Response.json({ error: "Could not prepare the payment. Try again." }, { status: 500 });
  }
}
