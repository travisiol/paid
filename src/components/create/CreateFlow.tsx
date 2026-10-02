"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { SplitInvoice } from "@/components/SplitInvoice";
import { CHAIN, DESTINATIONS, DESTINATION_KEYS, USDG } from "@/config/network";
import { CLIENT_NAME_MAX, DESCRIPTION_MAX, validateDetails, validateSplit } from "@/core/invoice";
import type { DraftErrors, InvoiceDraft } from "@/core/invoice";
import { allocateStock, evenShares, formatUsd, parseAmount, shareTotal, splitAmount } from "@/core/split";
import type { Allocation } from "@/core/split";
import { CreateLinkError, createLink } from "@/lib/create-link";
import type { CreatedLink } from "@/lib/create-link";
import { RouteEstimate } from "./RouteEstimate";
import { openWalletDialog, shortAddress, useWallet } from "@/lib/wallet";

const STEPS = ["Invoice details", "Payment split", "Review"] as const;
type Step = 0 | 1 | 2;
type Phase = "idle" | "signing" | "saving";

function Field({ id, label, optional, error, hint, children }: { id: string; label: string; optional?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label} {optional && <span className="font-normal text-muted">(optional)</span>}
      </label>
      <div className="mt-2">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="field-error mt-2" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="hint mt-2">{hint}</p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
      <dt className="text-[15px] font-semibold">{label}</dt>
      <dd className="text-[16px] leading-normal">{children}</dd>
    </div>
  );
}

export function CreateFlow() {
  const id = useId();
  const wallet = useWallet();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const [step, setStep] = useState<Step>(0);
  const [description, setDescription] = useState("");
  const [amountText, setAmountText] = useState("");
  const [clientName, setClientName] = useState("");
  const [stockPercent, setStockPercent] = useState(20);
  const [shares, setShares] = useState<Record<string, string>>({ NVDA: "100" });
  /** Errors appear once a step was submitted, then update live. */
  const [touched, setTouched] = useState<Record<number, boolean>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [copied, setCopied] = useState(false);

  // Move focus to the step heading when the step changes (not on first render).
  useEffect(() => {
    if (moved.current) headingRef.current?.focus();
  }, [step, created]);

  const amountCents = parseAmount(amountText);
  const allocations: Allocation[] = DESTINATION_KEYS.filter((key) => key in shares).map((key) => ({
    symbol: key,
    share: /^\d{1,3}$/.test(shares[key]) ? Number(shares[key]) : NaN,
  }));
  const draft: InvoiceDraft = { description, amountCents: amountCents ?? NaN, clientName, stockPercent, allocations };

  const detailErrors = validateDetails(draft);
  const splitErrors = validateSplit(draft);
  const errors: DraftErrors = { ...(touched[0] ? detailErrors : {}), ...(touched[1] ? splitErrors : {}) };

  const amountValid = !detailErrors.amount && amountCents !== null;
  const split = amountValid ? splitAmount(amountCents, stockPercent) : null;
  const total = shareTotal(allocations);
  const amounts = split && !splitErrors.allocations ? allocateStock(split.stockCents, allocations) : null;
  const stockLabel = allocations.length === 1 ? DESTINATIONS[allocations[0].symbol].label : "stock";

  const go = (next: Step) => {
    moved.current = true;
    setSubmitError(null);
    setStep(next);
  };

  const next = () => {
    setTouched((t) => ({ ...t, [step]: true }));
    if (step === 0 && Object.keys(detailErrors).length === 0) go(1);
    if (step === 1 && Object.keys(splitErrors).length === 0) go(2);
  };

  const toggle = (key: string) => {
    const selected = DESTINATION_KEYS.filter((k) => (k === key ? !(k in shares) : k in shares));
    const even = evenShares(selected.length);
    setShares(Object.fromEntries(selected.map((k, i) => [k, String(even[i])])));
  };

  const splitEvenly = () => {
    const selected = DESTINATION_KEYS.filter((k) => k in shares);
    const even = evenShares(selected.length);
    setShares(Object.fromEntries(selected.map((k, i) => [k, String(even[i])])));
  };

  const submit = async () => {
    if (!wallet.address) return openWalletDialog();
    setSubmitError(null);
    try {
      const link = await createLink(draft, wallet.address, setPhase);
      moved.current = true;
      setCreated(link);
    } catch (error) {
      setSubmitError(error instanceof CreateLinkError ? error.message : "The link could not be created.");
    } finally {
      setPhase("idle");
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const reset = () => {
    moved.current = true;
    setCreated(null);
    setDescription("");
    setAmountText("");
    setClientName("");
    setTouched({});
    setStep(0);
  };

  const preview = (
    <aside aria-label="Invoice preview" className="lg:sticky lg:top-8">
      <p className="eyebrow mb-5">Your invoice · before fees</p>
      {split ? (
        <SplitInvoice
          layout="stacked"
          number={created ? `#${String(created.sequence).padStart(4, "0")}` : "draft"}
          description={description.trim() || "Your work"}
          totalCents={amountCents!}
          usdgCents={split.usdgCents}
          stockCents={split.stockCents}
          stockPercent={stockPercent}
          stockLabel={stockLabel}
          breakdown={amounts?.map((a) => ({ label: DESTINATIONS[a.symbol].label, cents: a.cents }))}
        />
      ) : (
        <div className="grid min-h-[280px] place-items-center rounded-[14px] border border-dashed border-edge px-8 text-center">
          <p className="hint max-w-[28ch]">Enter an invoice amount to see how a payment would be split.</p>
        </div>
      )}
    </aside>
  );

  if (created) {
    return (
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-20">
        <div>
          <p className="eyebrow">Link saved</p>
          <h1 ref={headingRef} tabIndex={-1} className="heading mt-3 outline-none">
            Your payment link is ready to share.
          </h1>
          <div className="panel mt-8 flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <p className="mono min-w-0 flex-1 truncate px-2 text-[15px]" title={created.url}>
              {created.url}
            </p>
            <button type="button" className="btn btn-ink btn-sm" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="sr-only" aria-live="polite">
            {copied ? "Link copied to clipboard" : ""}
          </p>
          <p className="hint mt-5 max-w-[60ch]">
            Send it to your client. They pay {formatUsd(amountCents ?? 0)} in {USDG.symbol} from a wallet on {CHAIN.name}; the dollars and the
            stock arrive in your wallet in the same transaction. Creating the link moved no funds.
          </p>
          {!created.persistent && (
            <p className="note note-bad mt-3">This server keeps links in temporary storage. The link will stop working when the server restarts.</p>
          )}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={`/pay/${created.id}`} className="btn btn-accent">
              Open the payment page
            </Link>
            <button type="button" className="btn btn-line" onClick={reset}>
              Create another link
            </button>
          </div>
        </div>
        {preview}
      </div>
    );
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-20">
      <div className="min-w-0">
        <ol className="grid grid-cols-3 border-b border-line" aria-label="Steps">
          {STEPS.map((name, i) => {
            const state = i === step ? "current" : i < step ? "done" : "todo";
            const inner = (
              <>
                <span className="mono text-[13px]">0{i + 1}</span>
                <span className="mt-1 block text-[14px] leading-tight font-semibold sm:text-[16px]">{name}</span>
              </>
            );
            return (
              <li
                key={name}
                aria-current={state === "current" ? "step" : undefined}
                className={`-mb-px border-b-2 pb-3 ${state === "current" ? "border-ink" : "border-transparent"} ${state === "todo" ? "text-muted" : ""}`}
              >
                {state === "done" ? (
                  <button type="button" className="cursor-pointer text-left underline-offset-4 hover:underline" onClick={() => go(i as Step)}>
                    {inner}
                    <span className="sr-only"> — edit</span>
                  </button>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ol>

        <form
          noValidate
          className="mt-10"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === 2) void submit();
            else next();
          }}
        >
          {step === 0 && (
            <div className="space-y-6">
              <h1 ref={headingRef} tabIndex={-1} className="heading outline-none">
                What is the invoice for?
              </h1>
              <Field id={`${id}-description`} label="Description" error={errors.description}>
                <input
                  id={`${id}-description`}
                  className="field"
                  placeholder="Brand identity design"
                  maxLength={DESCRIPTION_MAX + 20}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  aria-invalid={Boolean(errors.description)}
                  aria-describedby={errors.description ? `${id}-description-error` : undefined}
                />
              </Field>
              <Field
                id={`${id}-amount`}
                label="Amount in dollars"
                error={errors.amount}
                hint="Your client pays this amount in USDG, a dollar stablecoin."
              >
                <div className="relative">
                  <span className="mono pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[17px] text-muted" aria-hidden="true">
                    $
                  </span>
                  <input
                    id={`${id}-amount`}
                    className="field mono pl-8"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="1,000.00"
                    value={amountText}
                    onChange={(event) => setAmountText(event.target.value)}
                    aria-invalid={Boolean(errors.amount)}
                    aria-describedby={errors.amount ? `${id}-amount-error` : undefined}
                  />
                </div>
              </Field>
              <Field id={`${id}-client`} label="Client name" optional error={errors.clientName} hint="Shown on the payment page.">
                <input
                  id={`${id}-client`}
                  className="field"
                  autoComplete="off"
                  maxLength={CLIENT_NAME_MAX + 20}
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                  aria-invalid={Boolean(errors.clientName)}
                  aria-describedby={errors.clientName ? `${id}-client-error` : undefined}
                />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div>
              <h1 ref={headingRef} tabIndex={-1} className="heading outline-none">
                How should it be split?
              </h1>

              <div className="mt-8">
                <div className="flex items-baseline justify-between">
                  <label htmlFor={`${id}-percent`} className="label">
                    Allocated to tokenized stock
                  </label>
                  <output htmlFor={`${id}-percent`} className="mono text-[20px] font-medium">
                    {stockPercent}%
                  </output>
                </div>
                <input
                  id={`${id}-percent`}
                  type="range"
                  className="range mt-1"
                  min={1}
                  max={100}
                  step={1}
                  value={stockPercent}
                  onChange={(event) => setStockPercent(Number(event.target.value))}
                  style={{ "--fill": `${stockPercent - 1}%` } as CSSProperties}
                />
                <div className="bar mt-4" role="img" aria-label={`${100 - stockPercent}% kept in USDG, ${stockPercent}% to stock`}>
                  <div className="flex-1" />
                  <div className="bar-stock" style={{ width: `${stockPercent}%` }} />
                </div>
                <div className="mono mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1 text-[16px]" aria-live="polite">
                  <p>
                    {100 - stockPercent}% USDG{split && <span className="font-semibold"> · {formatUsd(split.usdgCents)}</span>}
                  </p>
                  <p>
                    {stockPercent}% stock{split && <span className="font-semibold"> · {formatUsd(split.stockCents)}</span>}
                  </p>
                </div>
              </div>

              <fieldset className="mt-10" aria-describedby={errors.allocations ? `${id}-alloc-error` : undefined}>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <legend className="label float-left">Stock destinations</legend>
                  {allocations.length > 1 && (
                    <button type="button" className="link-u cursor-pointer text-[14px]" onClick={splitEvenly}>
                      Split evenly
                    </button>
                  )}
                </div>
                <p className="hint clear-both mt-1">Choose one or more. Shares divide the stock part and must add up to 100%.</p>
                <ul className="mt-4 border-b border-line">
                  {DESTINATION_KEYS.map((key) => {
                    const destination = DESTINATIONS[key];
                    const selected = key in shares;
                    const amount = amounts?.find((a) => a.symbol === key);
                    return (
                      <li key={key} className="flex min-h-[72px] items-center gap-4 border-t border-line py-3">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-4">
                          <input type="checkbox" className="size-5 shrink-0 accent-ink" checked={selected} onChange={() => toggle(key)} />
                          <span className="min-w-0">
                            <span className="mono block text-[18px] font-medium">{destination.label}</span>
                            <span className="hint block truncate">{destination.kind === "index" ? "Index fund token (SPY)" : `${destination.name} stock token`}</span>
                          </span>
                        </label>
                        {selected && (
                          <>
                            <span className="mono hidden w-[104px] text-right text-[15px] text-soft sm:block">{amount ? formatUsd(amount.cents) : "—"}</span>
                            <div className="relative w-[92px] shrink-0">
                              <input
                                className="field mono h-12 pr-8 text-right"
                                inputMode="numeric"
                                aria-label={`${destination.label} share of the stock part, in percent`}
                                value={shares[key]}
                                onChange={(event) => setShares((s) => ({ ...s, [key]: event.target.value.replace(/[^\d]/g, "").slice(0, 3) }))}
                                aria-invalid={Boolean(errors.allocations) && total !== 100}
                              />
                              <span className="mono pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" aria-hidden="true">
                                %
                              </span>
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="mono mt-3 flex justify-between text-[15px]" aria-live="polite">
                  <span>Total allocated</span>
                  <span className={`font-semibold ${allocations.length > 0 && total !== 100 ? "text-bad" : ""}`}>
                    {allocations.length === 0 ? "—" : `${total}% of 100%`}
                  </span>
                </div>
                {errors.allocations && (
                  <p id={`${id}-alloc-error`} className="field-error mt-3" role="alert">
                    {errors.allocations}
                  </p>
                )}
              </fieldset>
              <p className="hint mt-6">
                Amounts are before the swap route’s fee, shown on the next step. The quantity of each token depends on the price when the payment is executed. Destinations are
                subject to availability.
              </p>
            </div>
          )}

          {step === 2 && split && (
            <div>
              <h1 ref={headingRef} tabIndex={-1} className="heading outline-none">
                Check it over.
              </h1>
              <dl className="mt-8 border-b border-line">
                <Row label="Invoice">
                  <span className="mono font-semibold">{formatUsd(amountCents!)}</span> · {description.trim()}
                  {clientName.trim() && <span className="block text-soft">For {clientName.trim()}</span>}
                </Row>
                <Row label="Kept in USDG">
                  <span className="mono font-semibold">{formatUsd(split.usdgCents)}</span> <span className="text-soft">· {100 - stockPercent}%</span>
                </Row>
                <Row label="Converted to stock">
                  <span className="mono font-semibold">{formatUsd(split.stockCents)}</span> <span className="text-soft">· {stockPercent}%</span>
                  <ul className="mono mt-2 space-y-1 text-[15px]">
                    {amounts?.map((a) => (
                      <li key={a.symbol} className="flex max-w-[300px] justify-between gap-4">
                        <span>
                          {DESTINATIONS[a.symbol].label} <span className="text-soft">{a.share}%</span>
                        </span>
                        <span>{formatUsd(a.cents)}</span>
                      </li>
                    ))}
                  </ul>
                </Row>
                <Row label="Client pays with">
                  {USDG.symbol} ({USDG.onchainName}) on {CHAIN.name}
                </Row>
                <Row label="Fees">
                  <RouteEstimate
                    key={[amountCents, stockPercent, wallet.address ?? "", ...allocations.map((a) => a.symbol + a.share)].join(":")}
                    amountCents={amountCents!}
                    stockPercent={stockPercent}
                    allocations={allocations}
                    recipient={wallet.address}
                  />
                </Row>
                <Row label="Recipient wallet">
                  {wallet.address ? (
                    <>
                      <span className="mono font-semibold">{shortAddress(wallet.address)}</span>{" "}
                      <span className="text-soft">· {wallet.walletName}</span>{" "}
                      <button type="button" className="link-u ml-2 cursor-pointer text-[14px]" onClick={openWalletDialog}>
                        Change
                      </button>
                    </>
                  ) : (
                    <span className="text-soft">Not connected. Connect the wallet that should receive the dollars and the stock.</span>
                  )}
                </Row>
              </dl>
              <p className="note mt-6">
                Creating the link asks your wallet to sign the invoice. It is free: no transaction, no gas, no funds moved.
              </p>
              {submitError && (
                <p className="note note-bad mt-4" role="alert">
                  {submitError}
                </p>
              )}
            </div>
          )}

          <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            {step > 0 ? (
              <button type="button" className="btn btn-line" disabled={phase !== "idle"} onClick={() => go((step - 1) as Step)}>
                Back
              </button>
            ) : (
              <Link href="/" className="btn btn-line">
                Cancel
              </Link>
            )}
            {step < 2 ? (
              <button type="submit" className="btn btn-accent sm:min-w-[200px]">
                Continue
              </button>
            ) : (
              <button type="submit" className="btn btn-accent sm:min-w-[240px]" disabled={phase !== "idle"}>
                {phase === "signing" ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Waiting for your signature…
                  </>
                ) : phase === "saving" ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Saving the link…
                  </>
                ) : wallet.address ? (
                  "Create link"
                ) : (
                  "Connect wallet to create"
                )}
              </button>
            )}
          </div>
        </form>
      </div>
      {preview}
    </div>
  );
}
