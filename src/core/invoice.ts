/**
 * The invoice a recipient creates, its validation, and the message their
 * wallet signs. Shared by the form (instant feedback) and the server (the
 * rules that actually count). Framework-free.
 */
import { CHAIN, DESTINATIONS } from "../config/network.ts";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, allocateStock, formatUsd, shareTotal, splitAmount } from "./split.ts";
import type { Allocation } from "./split.ts";

export const DESCRIPTION_MAX = 120;
export const CLIENT_NAME_MAX = 80;
/** A signed request is accepted for this long after it was issued. */
export const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

export interface InvoiceDraft {
  description: string;
  amountCents: number;
  /** Empty string when not given. */
  clientName: string;
  /** Whole percent of the invoice converted to tokenized stock. */
  stockPercent: number;
  allocations: Allocation[];
}

export interface SignedInvoiceRequest {
  draft: InvoiceDraft;
  recipient: string;
  issuedAt: string;
  nonce: string;
  signature: string;
}

export type DraftField = "description" | "amount" | "clientName" | "stockPercent" | "allocations";
export type DraftErrors = Partial<Record<DraftField, string>>;

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

export function validateDetails(draft: Pick<InvoiceDraft, "description" | "amountCents" | "clientName">): DraftErrors {
  const errors: DraftErrors = {};
  const description = typeof draft.description === "string" ? draft.description.trim() : "";
  if (!description) errors.description = "Describe the work this invoice is for.";
  else if (description.length > DESCRIPTION_MAX) errors.description = `Keep the description under ${DESCRIPTION_MAX} characters.`;
  if (!isInteger(draft.amountCents)) errors.amount = "Enter an amount in dollars, like 1,000 or 249.50.";
  else if (draft.amountCents < MIN_AMOUNT_CENTS) errors.amount = `The smallest invoice is ${formatUsd(MIN_AMOUNT_CENTS)}.`;
  else if (draft.amountCents > MAX_AMOUNT_CENTS) errors.amount = `The largest invoice is ${formatUsd(MAX_AMOUNT_CENTS)}.`;
  if (typeof draft.clientName !== "string" || draft.clientName.trim().length > CLIENT_NAME_MAX)
    errors.clientName = `Keep the client name under ${CLIENT_NAME_MAX} characters.`;
  return errors;
}

export function validateSplit(draft: Pick<InvoiceDraft, "amountCents" | "stockPercent" | "allocations">): DraftErrors {
  const errors: DraftErrors = {};
  if (!isInteger(draft.stockPercent) || draft.stockPercent < 1 || draft.stockPercent > 100) {
    errors.stockPercent = "Choose a stock allocation between 1% and 100%.";
    return errors;
  }
  const list = Array.isArray(draft.allocations) ? draft.allocations : [];
  if (list.length === 0) {
    errors.allocations = "Pick at least one stock destination.";
    return errors;
  }
  const symbols = new Set(list.map((a) => a.symbol));
  if (symbols.size !== list.length || list.some((a) => !Object.hasOwn(DESTINATIONS, a.symbol))) {
    errors.allocations = "One of the destinations is not available.";
    return errors;
  }
  if (list.some((a) => !isInteger(a.share) || a.share < 1)) {
    errors.allocations = "Give every selected destination a share of at least 1%.";
    return errors;
  }
  const total = shareTotal(list);
  if (total !== 100) {
    errors.allocations =
      total < 100
        ? `Shares add up to ${total}%. Allocate the remaining ${100 - total}%.`
        : `Shares add up to ${total}%. Remove ${total - 100}% to reach 100%.`;
    return errors;
  }
  if (isInteger(draft.amountCents)) {
    const { stockCents } = splitAmount(draft.amountCents, draft.stockPercent);
    if (allocateStock(stockCents, list).some((a) => a.cents < 1))
      errors.allocations = "This split leaves a destination with less than $0.01. Raise the stock allocation or use fewer destinations.";
  }
  return errors;
}

export function validateDraft(draft: InvoiceDraft): DraftErrors {
  return { ...validateDetails(draft), ...validateSplit(draft) };
}

/** Trimmed copy with allocations in a stable order — what is signed and stored. */
export function normalizeDraft(draft: InvoiceDraft): InvoiceDraft {
  return {
    description: draft.description.trim().replace(/\s+/g, " "),
    amountCents: draft.amountCents,
    clientName: draft.clientName.trim().replace(/\s+/g, " "),
    stockPercent: draft.stockPercent,
    allocations: draft.allocations.map((a) => ({ symbol: a.symbol, share: a.share })),
  };
}

/**
 * The human-readable message the recipient signs. The server rebuilds it
 * from the request and checks the signature against it, so a stored invoice
 * is exactly what the wallet owner approved.
 */
export function creationMessage(input: { draft: InvoiceDraft; recipient: string; issuedAt: string; nonce: string }): string {
  const draft = normalizeDraft(input.draft);
  return [
    "PAID: create a payment link",
    "",
    `Amount: ${formatUsd(draft.amountCents)}, paid in USDG`,
    `For: ${draft.description}`,
    `Client: ${draft.clientName || "not specified"}`,
    `Split: ${100 - draft.stockPercent}% USDG, ${draft.stockPercent}% tokenized stock`,
    `Stock: ${draft.allocations.map((a) => `${a.symbol} ${a.share}%`).join(", ")}`,
    `Recipient: ${input.recipient.toLowerCase()}`,
    `Network: ${CHAIN.name} (${CHAIN.id})`,
    `Issued: ${input.issuedAt}`,
    `Nonce: ${input.nonce}`,
    "",
    "Signing creates the link. It does not move funds or cost gas.",
  ].join("\n");
}

export function invoiceNumber(sequence: number): string {
  return `#${String(sequence).padStart(4, "0")}`;
}
