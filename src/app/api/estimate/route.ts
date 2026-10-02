import { validateSplit } from "@/core/invoice";
import { paymentTerms } from "@/core/settlement";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS } from "@/core/split";
import type { Allocation } from "@/core/split";
import { isQuoteError, quoteSwaps } from "@/server/quotes";

/** A stand-in receiver for estimates made before a wallet is connected. Quotes do not depend on it. */
const PLACEHOLDER = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";

/**
 * Live route figures for a split that has not been created yet: what the
 * swap route charges and roughly how many tokens the stock part buys now.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { amountCents?: number; stockPercent?: number; allocations?: Allocation[]; recipient?: string } | null;
  if (!body || !Number.isInteger(body.amountCents) || !Array.isArray(body.allocations) || body.allocations.length > 16)
    return Response.json({ error: "Invalid split." }, { status: 400 });
  const draft = {
    amountCents: body.amountCents as number,
    stockPercent: body.stockPercent as number,
    allocations: body.allocations.map((a) => ({ symbol: String(a?.symbol), share: a?.share })),
  };
  if (draft.amountCents < MIN_AMOUNT_CENTS || draft.amountCents > MAX_AMOUNT_CENTS || Object.keys(validateSplit(draft)).length > 0)
    return Response.json({ error: "Invalid split." }, { status: 400 });
  const recipient = typeof body.recipient === "string" && /^0x[a-fA-F0-9]{40}$/.test(body.recipient) ? body.recipient : PLACEHOLDER;

  const terms = paymentTerms({ id: "estimate", recipient, ...draft });
  try {
    const swaps = await quoteSwaps(recipient, terms.swaps);
    return Response.json({
      lines: terms.swaps.map((swap, i) => ({ symbol: swap.symbol, amountIn: swaps[i].amountIn, feeMicro: swaps[i].feeMicro, toAmount: swaps[i].toAmount, tool: swaps[i].tool })),
    });
  } catch (error) {
    return Response.json({ error: isQuoteError(error) ? error.message : "No estimate available right now." }, { status: 502 });
  }
}
