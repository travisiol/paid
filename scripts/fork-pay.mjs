// Rehearses a real payment on the local fork (cd chain && npm run serve).
// Deploys PaidSettlement through the CREATE2 proxy (the same transaction the /deploy page sends),
// then pays an invoice split over every destination with live LI.FI quotes, and checks the result
// with the app's own code.
// usage: node scripts/fork-pay.mjs
// Nothing is sent to the real chain: the fork signs with an unlocked test account.
import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, toFunctionSelector } from "viem";
import { CHAIN, DESTINATIONS, DESTINATION_KEYS, LIFI, USDG } from "../src/config/network.ts";
import { DEPLOY_TRANSACTION, SETTLEMENT_ABI, SETTLEMENT_ADDRESS, payCalldata, paymentTerms, quoteUrl, validateQuote, verifyPayment } from "../src/core/settlement.ts";
import { evenShares } from "../src/core/split.ts";

const RPC = process.env.FORK_RPC || "http://127.0.0.1:8689";
const PAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const chain = { id: CHAIN.id, name: "fork", nativeCurrency: CHAIN.nativeCurrency, rpcUrls: { default: { http: [RPC] } } };
const reader = createPublicClient({ chain, transport: http(RPC, { timeout: 240_000, retryCount: 0 }) });
const wallet = createWalletClient({ chain, transport: http(RPC, { timeout: 240_000, retryCount: 0 }), account: PAYER });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const balance = (token, who) => reader.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });
const mined = async (hash) => reader.waitForTransactionReceipt({ hash });

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

if ((await reader.getChainId()) !== CHAIN.id) throw new Error("fork is not serving chain 4663");
console.log(`fork block ${await reader.getBlockNumber()} · payer holds ${Number(await balance(USDG.address, PAYER)) / 1e6} USDG`);

// 1. deploy through the proxy, exactly as the site does
if (!(await reader.getCode({ address: SETTLEMENT_ADDRESS }))) {
  const receipt = await mined(await wallet.sendTransaction(DEPLOY_TRANSACTION));
  console.log(`deployed in ${receipt.gasUsed} gas`);
}
const code = await reader.getCode({ address: SETTLEMENT_ADDRESS });
check("the contract is at its predicted address", Boolean(code && code.length > 2), SETTLEMENT_ADDRESS);
const read = (functionName, args = []) => reader.readContract({ address: SETTLEMENT_ADDRESS, abi: SETTLEMENT_ABI, functionName, args });
check("it is wired to USDG and the LI.FI router", (await read("usdg")).toLowerCase() === USDG.address.toLowerCase() && (await read("router")).toLowerCase() === LIFI.diamond.toLowerCase());

// 2. a $400 invoice, half in stock, shared by every destination
const shares = evenShares(DESTINATION_KEYS.length);
const invoice = {
  id: `fork${Date.now().toString(36)}`,
  recipient: RECIPIENT,
  amountCents: Number(process.env.AMOUNT_CENTS || 40_000),
  stockPercent: 50,
  allocations: DESTINATION_KEYS.map((symbol, i) => ({ symbol, share: shares[i] })),
};
const terms = paymentTerms(invoice);
const swaps = [];
for (const swap of terms.swaps) {
  const expected = { settlement: SETTLEMENT_ADDRESS, recipient: RECIPIENT, token: swap.token, amountIn: swap.amountIn };
  const response = await fetch(quoteUrl(expected));
  const body = await response.json();
  if (!response.ok) throw new Error(`quote refused for ${swap.symbol}: ${body.message ?? response.status}`);
  swaps.push(validateQuote(body, expected));
}
check("live quotes pass validation for every destination", swaps.length === terms.swaps.length, swaps.map((s) => s.tool).join(","));

const before = { payer: await balance(USDG.address, PAYER), recipient: await balance(USDG.address, RECIPIENT), tokens: await Promise.all(terms.swaps.map((s) => balance(s.token, RECIPIENT))) };

// Exact approval, never unlimited.
await mined(await wallet.sendTransaction({ to: USDG.address, data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [SETTLEMENT_ADDRESS, terms.total] }) }));
const hash = await wallet.sendTransaction({ to: SETTLEMENT_ADDRESS, data: payCalldata(terms, swaps) });
const receipt = await mined(hash);
check("the payment transaction succeeded", receipt.status === "success", `gas ${receipt.gasUsed}`);

// 3. what actually happened
const verified = verifyPayment(receipt, { settlement: SETTLEMENT_ADDRESS, terms: terms.terms });
check("the app's own check accepts the transaction", verified?.payer === PAYER.toLowerCase() && verified.delivered.length === swaps.length);
check("a transaction is not accepted for other terms", verifyPayment(receipt, { settlement: SETTLEMENT_ADDRESS, terms: paymentTerms({ ...invoice, amountCents: invoice.amountCents + 1 }).terms }) === null);
const spent = before.payer - (await balance(USDG.address, PAYER));
check("the payer spent at most the invoice total", spent > 0n && spent <= terms.total, `${Number(spent) / 1e6} USDG of ${Number(terms.total) / 1e6}`);
check("the recipient received the dollar part in USDG", (await balance(USDG.address, RECIPIENT)) - before.recipient === terms.usdgToRecipient, `${Number(terms.usdgToRecipient) / 1e6} USDG`);
const rows = [];
for (const [i, swap] of terms.swaps.entries()) {
  const got = (await balance(swap.token, RECIPIENT)) - before.tokens[i];
  const logged = BigInt(verified?.delivered.find((d) => d.token === swap.token.toLowerCase())?.amountOut ?? 0);
  check(`the recipient received ${swap.symbol}`, got >= BigInt(swaps[i].minOut) && got === logged, `${Number(got) / 1e18} ${DESTINATIONS[swap.symbol].token.symbol} for ${Number(swap.amountIn) / 1e6} USDG (min ${Number(swaps[i].minOut) / 1e18}, route fee ${Number(swaps[i].feeMicro) / 1e6} USDG)`);
  rows.push({ symbol: swap.symbol, amountIn: swap.amountIn.toString(), received: got.toString(), minOut: swaps[i].minOut, feeMicro: swaps[i].feeMicro, tool: swaps[i].tool });
}
check("the contract kept nothing", (await balance(USDG.address, SETTLEMENT_ADDRESS)) === 0n);
check("no allowance is left on the router", (await reader.readContract({ address: USDG.address, abi: erc20, functionName: "allowance", args: [SETTLEMENT_ADDRESS, LIFI.diamond] })) === 0n);
const [paidBy, paidAt] = await read("receipts", [terms.terms]);
check("the on-chain receipt records the payer", paidBy.toLowerCase() === PAYER.toLowerCase() && paidAt > 0n);

// 4. paying the same invoice again is refused
await mined(await wallet.sendTransaction({ to: USDG.address, data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [SETTLEMENT_ADDRESS, terms.total] }) }));
const again = await fetch(RPC, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ from: PAYER, to: SETTLEMENT_ADDRESS, data: payCalldata(terms, swaps) }, "latest"] }),
}).then((r) => r.json());
check("the same invoice cannot be paid twice", JSON.stringify(again.error ?? "").includes(toFunctionSelector("AlreadyPaid()")), "reverts with AlreadyPaid()");

mkdirSync("research", { recursive: true });
writeFileSync("research/fork-pay.json", JSON.stringify({ at: new Date().toISOString(), block: Number(receipt.blockNumber), settlement: SETTLEMENT_ADDRESS, invoice, gasUsed: receipt.gasUsed.toString(), ok: failures === 0, rows }, null, 2));
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
