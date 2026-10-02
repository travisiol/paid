import "server-only";
import { QuoteError, SETTLEMENT_ADDRESS, quoteUrl, validateQuote } from "@/core/settlement";
import type { PreparedSwap } from "@/core/settlement";

/**
 * Live LI.FI quotes for the stock part of a payment. Without LIFI_API_KEY the
 * public API is rate-limited per IP (roughly a hundred quotes an hour).
 */
export async function quoteSwaps(recipient: string, swaps: { token: string; amountIn: bigint }[]): Promise<PreparedSwap[]> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
  return Promise.all(
    swaps.map(async (swap) => {
      const expected = { settlement: SETTLEMENT_ADDRESS, recipient, token: swap.token, amountIn: swap.amountIn };
      let response: Response;
      try {
        response = await fetch(quoteUrl(expected), { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
      } catch {
        throw new QuoteError("The swap route did not answer. Try again in a moment.");
      }
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (response.status === 429) throw new QuoteError("The swap route is rate-limiting requests. Try again in a few minutes.");
      if (!response.ok) throw new QuoteError(`The swap route has no quote right now${body?.message ? `: ${String(body.message).slice(0, 120)}` : "."}`);
      return validateQuote(body, expected);
    }),
  );
}

export function isQuoteError(error: unknown): error is QuoteError {
  return error instanceof QuoteError || (error instanceof Error && error.name === "QuoteError");
}
