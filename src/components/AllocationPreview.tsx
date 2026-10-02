"use client";

import { useId, useState } from "react";
import type { CSSProperties } from "react";
import { DESTINATIONS, DESTINATION_KEYS } from "@/config/network";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, formatUsd, parseAmount, splitAmount } from "@/core/split";

/** The homepage calculator: an invoice amount, a stock allocation, a destination. Arithmetic only. */
export function AllocationPreview() {
  const id = useId();
  const [amountText, setAmountText] = useState("1,000");
  const [percent, setPercent] = useState(20);
  const [symbol, setSymbol] = useState("NVDA");

  const cents = parseAmount(amountText);
  const valid = cents !== null && cents >= MIN_AMOUNT_CENTS && cents <= MAX_AMOUNT_CENTS;
  const split = valid ? splitAmount(cents, percent) : null;
  const label = DESTINATIONS[symbol].label;

  return (
    <div>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div>
          <label htmlFor={`${id}-amount`} className="label">
            Invoice amount
          </label>
          <div className="relative mt-2">
            <span className="mono pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[17px] text-muted" aria-hidden="true">
              $
            </span>
            <input
              id={`${id}-amount`}
              className="field mono pl-8"
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              aria-invalid={!valid}
              aria-describedby={!valid ? `${id}-amount-error` : undefined}
            />
          </div>
        </div>
        <fieldset>
          <legend className="label">Stock</legend>
          <div className="seg mt-2">
            {DESTINATION_KEYS.map((key) => (
              <label key={key}>
                <input type="radio" name={`${id}-stock`} className="sr-only" checked={symbol === key} onChange={() => setSymbol(key)} />
                {DESTINATIONS[key].label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {!valid && (
        <p id={`${id}-amount-error`} className="field-error mt-2" role="alert">
          Enter an amount between {formatUsd(MIN_AMOUNT_CENTS)} and {formatUsd(MAX_AMOUNT_CENTS)}.
        </p>
      )}

      <div className="mt-6">
        <div className="flex items-baseline justify-between">
          <label htmlFor={`${id}-percent`} className="label">
            Stock allocation
          </label>
          <output htmlFor={`${id}-percent`} className="mono text-[17px] font-medium">
            {percent}%
          </output>
        </div>
        <input
          id={`${id}-percent`}
          type="range"
          className="range mt-1"
          min={0}
          max={100}
          step={1}
          value={percent}
          onChange={(event) => setPercent(Number(event.target.value))}
          style={{ "--fill": `${percent}%` } as CSSProperties}
        />
      </div>

      <div className="bar mt-5" role="img" aria-label={`${100 - percent}% in dollars, ${percent}% in ${label}`}>
        <div className="flex-1" />
        <div className="bar-stock" data-empty={percent === 0} style={{ width: `${percent}%` }} />
      </div>
      <div className="mono mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-[17px]" aria-live="polite">
        <p>
          <span className="font-semibold">{split ? formatUsd(split.usdgCents) : "—"}</span> in dollars
        </p>
        <p>
          <span className="font-semibold">{split ? formatUsd(split.stockCents) : "—"}</span> in {label}
        </p>
      </div>

      <p className="hint mt-6 border-t border-line pt-4">
        Amounts are before fees. Dollars arrive as USDG. The stock part is converted at the market price when the payment is made, so the
        quantity of {label === "S&P 500" ? "the index fund token" : `${label} token`} you receive depends on the execution price.
      </p>
    </div>
  );
}
