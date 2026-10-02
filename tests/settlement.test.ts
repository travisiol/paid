import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DESTINATIONS, LIFI, USDG } from "../src/config/network.ts";
import { DEPLOY_TRANSACTION, SETTLEMENT_ADDRESS, hashTerms, paymentTerms, quoteUrl, validateQuote } from "../src/core/settlement.ts";

const RECIPIENT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const invoice = {
  id: "18t8ker4brqnog",
  recipient: RECIPIENT,
  amountCents: 100_000,
  stockPercent: 20,
  allocations: [
    { symbol: "NVDA", share: 70 },
    { symbol: "AAPL", share: 30 },
  ],
};

test("the off-chain terms hash equals the contract's (vector written by chain/test.cjs)", () => {
  const v = JSON.parse(readFileSync(new URL("../research/terms-vector.json", import.meta.url), "utf8"));
  const invoiceId = `0x${Buffer.from(v.invoiceId).toString("hex").padEnd(64, "0")}` as `0x${string}`;
  assert.equal(
    hashTerms({ chainId: v.chainId, settlement: v.settlement, invoiceId, recipient: v.recipient, usdgToRecipient: BigInt(v.usdgToRecipient), tokens: v.tokens, amountsIn: v.amountsIn.map(BigInt) }),
    v.terms,
  );
});

test("an invoice becomes USDG amounts that add up to its total", () => {
  const terms = paymentTerms(invoice);
  assert.equal(terms.total, BigInt(1_000_000_000));
  assert.equal(terms.usdgToRecipient, BigInt(800_000_000));
  assert.deepEqual(terms.swaps.map((s) => [s.symbol, s.amountIn]), [["NVDA", BigInt(140_000_000)], ["AAPL", BigInt(60_000_000)]]);
  assert.equal(terms.swaps[0].token, DESTINATIONS.NVDA.token.address);
  assert.equal(terms.usdgToRecipient + terms.swaps.reduce((sum, s) => sum + s.amountIn, BigInt(0)), terms.total);
});

test("any change to the invoice changes the terms", () => {
  const base = paymentTerms(invoice).terms;
  assert.notEqual(paymentTerms({ ...invoice, amountCents: 100_001 }).terms, base);
  assert.notEqual(paymentTerms({ ...invoice, stockPercent: 21 }).terms, base);
  assert.notEqual(paymentTerms({ ...invoice, id: "18t8ker4brqnoh" }).terms, base);
  assert.notEqual(paymentTerms({ ...invoice, recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }).terms, base);
  assert.notEqual(paymentTerms({ ...invoice, allocations: [{ symbol: "NVDA", share: 100 }] }).terms, base);
});

test("the deployment is deterministic", () => {
  assert.match(SETTLEMENT_ADDRESS, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(DEPLOY_TRANSACTION.to, "0x4e59b44847b379578588920cA78FbF26c0B4956C");
  assert.ok(DEPLOY_TRANSACTION.data.length > 2 + 64 + 1000);
});

const expected = { settlement: SETTLEMENT_ADDRESS, recipient: RECIPIENT, token: DESTINATIONS.NVDA.token.address, amountIn: BigInt(140_000_000) };
const quote = (patch: (q: ReturnType<typeof good>) => void = () => {}) => {
  const q = good();
  patch(q);
  return q;
};
function good() {
  return {
    tool: "kyberswap",
    action: { fromToken: { address: USDG.address }, toToken: { address: expected.token as string }, fromAmount: "140000000", fromChainId: 4663, toChainId: 4663, fromAddress: SETTLEMENT_ADDRESS as string, toAddress: RECIPIENT },
    estimate: { approvalAddress: LIFI.diamond as string, toAmount: "1000000", toAmountMin: "990000", feeCosts: [{ amount: "350000", included: true, token: { address: USDG.address } }] },
    transactionRequest: { to: LIFI.diamond as string, data: "0xabcdef0123", value: "0x0", chainId: 4663, from: SETTLEMENT_ADDRESS as string },
  };
}

test("a quote that does exactly what was asked is accepted", () => {
  const swap = validateQuote(quote(), expected);
  assert.deepEqual([swap.minOut, swap.toAmount, swap.feeMicro, swap.tool], ["990000", "1000000", "350000", "kyberswap"]);
  assert.match(quoteUrl(expected), /toAddress=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC/);
  assert.match(quoteUrl(expected), new RegExp(`fromAddress=${SETTLEMENT_ADDRESS}`));
});

test("a quote that deviates in any way is refused", () => {
  const refused: [string, (q: ReturnType<typeof good>) => void][] = [
    ["another receiver", (q) => (q.action.toAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8")],
    ["another spender", (q) => (q.action.fromAddress = RECIPIENT)],
    ["another token", (q) => (q.action.toToken.address = DESTINATIONS.AAPL.token.address)],
    ["another amount", (q) => (q.action.fromAmount = "140000001")],
    ["another network", (q) => (q.transactionRequest.chainId = 1)],
    ["an unknown router", (q) => (q.transactionRequest.to = RECIPIENT)],
    ["an unknown approval target", (q) => (q.estimate.approvalAddress = RECIPIENT)],
    ["ETH attached", (q) => (q.transactionRequest.value = "0x1")],
    ["a venue that settles later", (q) => (q.tool = "lifiIntentsDex")],
    ["too much slippage", (q) => (q.estimate.toAmountMin = "900000")],
    ["nothing delivered", (q) => (q.estimate.toAmountMin = "0")],
    ["no calldata", (q) => (q.transactionRequest.data = "0x")],
  ];
  for (const [name, patch] of refused) assert.throws(() => validateQuote(quote(patch), expected), { name: "QuoteError" }, name);
});
