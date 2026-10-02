"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { PAID_FEE_BPS } from "@/config/integration";
import { DESTINATIONS, USDG } from "@/config/network";
import type { Allocation } from "@/core/split";

interface Line {
  symbol: string;
  amountIn: string;
  feeMicro: string;
  toAmount: string;
  tool: string;
}

type State = { kind: "loading" } | { kind: "ready"; lines: Line[] } | { kind: "error"; message: string };

const dollars = (micro: bigint) => `$${Number(formatUnits(micro, USDG.decimals)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Fees as they are right now, read from a live quote of the swap route.
 * Mount it with a `key` built from the split so a change remounts it.
 */
export function RouteEstimate({ amountCents, stockPercent, allocations, recipient }: { amountCents: number; stockPercent: number; allocations: Allocation[]; recipient: string | null }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amountCents, stockPercent, allocations, recipient }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { lines?: Line[]; error?: string } | null;
        if (!response.ok || !body?.lines) setState({ kind: "error", message: body?.error ?? "No estimate available right now." });
        else setState({ kind: "ready", lines: body.lines });
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setState({ kind: "error", message: "No estimate available right now." });
      });
    return () => controller.abort();
    // Remounted through `key` when the split changes; the inputs are fixed for this instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paidFee = PAID_FEE_BPS === 0 ? "PAID fee: none." : `PAID fee: ${PAID_FEE_BPS / 100}% of the stock part.`;

  if (state.kind === "loading")
    return (
      <span className="text-soft">
        {paidFee} <span aria-live="polite">Reading the swap route’s fee…</span>
      </span>
    );
  if (state.kind === "error")
    return (
      <span className="text-soft">
        {paidFee} The swap route charges its own fee on the stock part; it could not be read just now ({state.message.replace(/\.$/, "")}).
      </span>
    );

  const fee = state.lines.reduce((sum, line) => sum + BigInt(line.feeMicro), BigInt(0));
  return (
    <>
      {paidFee} Swap route fee: <span className="mono font-semibold">{dollars(fee)}</span>, taken from the stock part by the route ({state.lines[0]?.tool ?? "LI.FI"} via LI.FI).
      <span className="mt-2 block text-soft">At current prices the stock part buys about:</span>
      <ul className="mono mt-1 space-y-1 text-[15px]">
        {state.lines.map((line) => (
          <li key={line.symbol}>
            {Number(formatUnits(BigInt(line.toAmount), 18)).toLocaleString("en-US", { maximumFractionDigits: 6 })} {DESTINATIONS[line.symbol].token.symbol}{" "}
            <span className="text-soft">for {dollars(BigInt(line.amountIn))}</span>
          </li>
        ))}
      </ul>
      <span className="mt-2 block text-soft">An estimate, not a guarantee: the quantity is set by the price when your client pays.</span>
    </>
  );
}
