/**
 * Everything about settling an invoice on chain: the contract's address, the
 * terms a stored invoice turns into, the swap quotes for its stock part, and
 * the check that a transaction really paid it. Framework-free, so the tests
 * and the fork rehearsal run the same code as the server.
 */
import { concat, decodeEventLog, encodeAbiParameters, encodeDeployData, encodeFunctionData, getContractAddress, keccak256, stringToHex } from "viem";
import artifact from "../lib/abi/PaidSettlement.json" with { type: "json" };
import { CHAIN, CREATE2_PROXY, DESTINATIONS, LIFI, MAX_SLIPPAGE_BPS, USDG } from "../config/network.ts";
import { allocateStock, splitAmount } from "./split.ts";
import type { Allocation } from "./split.ts";

type Hex = `0x${string}`;

export const SETTLEMENT_ABI = artifact.abi;

/** One cent in USDG base units (6 decimals). */
const MICRO_PER_CENT = BigInt(10_000);

// ───────────────────────────── the contract

const SALT = keccak256(stringToHex("paid:settlement:v1"));
const INIT_CODE = encodeDeployData({ abi: SETTLEMENT_ABI, bytecode: artifact.bytecode as Hex, args: [USDG.address, LIFI.diamond] });

/** Where the settlement contract lives once deployed. Changes only if its code or constructor arguments change. */
export const SETTLEMENT_ADDRESS: Hex = getContractAddress({ opcode: "CREATE2", from: CREATE2_PROXY, salt: SALT, bytecode: INIT_CODE });

/** The transaction that deploys it. Anyone can send it; a second attempt does nothing. */
export const DEPLOY_TRANSACTION = { to: CREATE2_PROXY, data: concat([SALT, INIT_CODE]) };

// ───────────────────────────── terms

export interface TermsInput {
  id: string;
  recipient: string;
  amountCents: number;
  stockPercent: number;
  allocations: Allocation[];
}

export interface PaymentTerms {
  invoiceId: Hex;
  recipient: Hex;
  /** USDG base units. */
  usdgToRecipient: bigint;
  total: bigint;
  swaps: { symbol: string; token: Hex; amountIn: bigint }[];
  /** The hash the contract records a payment under. */
  terms: Hex;
}

export function hashTerms(input: { chainId: number; settlement: string; invoiceId: Hex; recipient: string; usdgToRecipient: bigint; tokens: string[]; amountsIn: bigint[] }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "address[]" }, { type: "uint256[]" }],
      [BigInt(input.chainId), input.settlement as Hex, input.invoiceId, input.recipient as Hex, input.usdgToRecipient, input.tokens as Hex[], input.amountsIn],
    ),
  );
}

/** What the contract must be asked to do for this invoice: the same integer split the recipient saw. */
export function paymentTerms(invoice: TermsInput, settlement: string = SETTLEMENT_ADDRESS): PaymentTerms {
  const { usdgCents, stockCents } = splitAmount(invoice.amountCents, invoice.stockPercent);
  const swaps = allocateStock(stockCents, invoice.allocations).map((a) => ({
    symbol: a.symbol,
    token: DESTINATIONS[a.symbol].token.address,
    amountIn: BigInt(a.cents) * MICRO_PER_CENT,
  }));
  const invoiceId = stringToHex(invoice.id, { size: 32 });
  const usdgToRecipient = BigInt(usdgCents) * MICRO_PER_CENT;
  return {
    invoiceId,
    recipient: invoice.recipient as Hex,
    usdgToRecipient,
    total: BigInt(invoice.amountCents) * MICRO_PER_CENT,
    swaps,
    terms: hashTerms({
      chainId: CHAIN.id,
      settlement,
      invoiceId,
      recipient: invoice.recipient,
      usdgToRecipient,
      tokens: swaps.map((s) => s.token),
      amountsIn: swaps.map((s) => s.amountIn),
    }),
  };
}

// ───────────────────────────── quotes

export class QuoteError extends Error {
  name = "QuoteError";
}

export interface PreparedSwap {
  token: Hex;
  amountIn: string;
  /** Estimated tokens out, base units. */
  toAmount: string;
  /** The least the recipient can receive without the payment reverting. */
  minOut: string;
  data: Hex;
  /** Route fees taken from the USDG converted, base units. */
  feeMicro: string;
  tool: string;
}

const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/** The settlement contract spends the USDG; the recipient receives the token. */
export function quoteUrl(input: { settlement: string; recipient: string; token: string; amountIn: bigint }): string {
  const url = new URL(`${LIFI.apiUrl}/quote`);
  url.search = new URLSearchParams({
    fromChain: String(CHAIN.id),
    toChain: String(CHAIN.id),
    fromToken: USDG.address,
    toToken: input.token,
    fromAmount: input.amountIn.toString(),
    fromAddress: input.settlement,
    toAddress: input.recipient,
    slippage: String(MAX_SLIPPAGE_BPS / 10_000),
    integrator: LIFI.integrator,
    allowExchanges: LIFI.exchanges.join(","),
  }).toString();
  return url.toString();
}

/**
 * Accept a quote only if it does exactly what was asked: the contract's USDG,
 * this exact amount, this token, to this recipient, through the known router
 * and an allowed venue, with no ETH attached.
 */
export function validateQuote(body: unknown, expected: { settlement: string; recipient: string; token: string; amountIn: bigint }): PreparedSwap {
  const quote = body as {
    tool?: string;
    action?: { fromToken?: { address?: string }; toToken?: { address?: string }; fromAmount?: string; fromChainId?: number; toChainId?: number; fromAddress?: string; toAddress?: string };
    estimate?: { approvalAddress?: string; toAmount?: string; toAmountMin?: string; feeCosts?: { amount?: string; included?: boolean; token?: { address?: string } }[] };
    transactionRequest?: { to?: string; data?: string; value?: string; chainId?: number; from?: string };
  };
  const { action, estimate, transactionRequest: tx } = quote ?? {};
  if (!action || !estimate || !tx) throw new QuoteError("The route returned an incomplete quote.");
  if (action.fromChainId !== CHAIN.id || action.toChainId !== CHAIN.id || tx.chainId !== CHAIN.id) throw new QuoteError("The quote is for another network.");
  if (!same(action.fromToken?.address, USDG.address)) throw new QuoteError("The quote does not spend USDG.");
  if (!same(action.toToken?.address, expected.token)) throw new QuoteError("The quote buys a different token.");
  if (action.fromAmount !== expected.amountIn.toString()) throw new QuoteError("The quote is for a different amount.");
  if (!same(action.fromAddress, expected.settlement) || !same(tx.from, expected.settlement)) throw new QuoteError("The quote spends from a different address.");
  if (!same(action.toAddress, expected.recipient)) throw new QuoteError("The quote delivers to a different address.");
  if (!same(tx.to, LIFI.diamond) || !same(estimate.approvalAddress, LIFI.diamond)) throw new QuoteError("The quote points at an unknown contract.");
  if (typeof tx.data !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(tx.data)) throw new QuoteError("The quote has no transaction data.");
  if (BigInt(tx.value ?? "0x0") !== BigInt(0)) throw new QuoteError("The quote attaches ETH.");
  if (!LIFI.exchanges.includes(String(quote.tool))) throw new QuoteError("The quote routes through a venue that is not allowed.");

  const toAmount = BigInt(estimate.toAmount ?? "0");
  const minOut = BigInt(estimate.toAmountMin ?? "0");
  if (minOut <= BigInt(0) || toAmount < minOut) throw new QuoteError("The quote delivers nothing.");
  if (minOut * BigInt(10_000) < toAmount * BigInt(10_000 - MAX_SLIPPAGE_BPS) - BigInt(10_000)) throw new QuoteError("The quote allows more slippage than the limit.");

  let fee = BigInt(0);
  for (const cost of estimate.feeCosts ?? []) if (cost.included && same(cost.token?.address, USDG.address)) fee += BigInt(cost.amount ?? "0");

  return { token: expected.token as Hex, amountIn: expected.amountIn.toString(), toAmount: toAmount.toString(), minOut: minOut.toString(), data: tx.data as Hex, feeMicro: fee.toString(), tool: String(quote.tool) };
}

/** Calldata for PaidSettlement.pay with the prepared swaps. */
export function payCalldata(terms: PaymentTerms, swaps: PreparedSwap[]): Hex {
  return encodeFunctionData({
    abi: SETTLEMENT_ABI,
    functionName: "pay",
    args: [terms.invoiceId, terms.recipient, terms.usdgToRecipient, swaps.map((s) => ({ token: s.token, amountIn: BigInt(s.amountIn), minOut: BigInt(s.minOut), data: s.data }))],
  });
}

// ───────────────────────────── after the transaction

export interface LogLike {
  address: string;
  topics: readonly string[];
  data: string;
}

export interface VerifiedPayment {
  payer: string;
  delivered: { token: string; amountOut: string }[];
}

/**
 * Did this transaction pay these terms? True only for an InvoicePaid event
 * emitted by the settlement contract under the exact terms hash — which binds
 * the invoice id, the recipient and every amount.
 */
export function verifyPayment(receipt: { status: string; logs: LogLike[] }, expected: { settlement: string; terms: string }): VerifiedPayment | null {
  if (receipt.status !== "success") return null;
  let payer: string | null = null;
  const delivered: VerifiedPayment["delivered"] = [];
  for (const log of receipt.logs) {
    if (!same(log.address, expected.settlement)) continue;
    let event;
    try {
      event = decodeEventLog({ abi: SETTLEMENT_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data as Hex });
    } catch {
      continue;
    }
    const args = event.args as unknown as Record<string, unknown>;
    if (!same(args.terms, expected.terms)) continue;
    if (event.eventName === "InvoicePaid") payer = String(args.payer).toLowerCase();
    if (event.eventName === "StockDelivered") delivered.push({ token: String(args.token).toLowerCase(), amountOut: String(args.amountOut) });
  }
  return payer ? { payer, delivered } : null;
}
