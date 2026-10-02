// Unit tests for PaidSettlement against mock tokens and a mock router.
// usage: cd chain && npm test        (in-process chain, no fork, nothing real)
const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync } = require("node:fs");
const { artifacts, network } = require("hardhat");
const { createPublicClient, createWalletClient, custom, decodeEventLog, encodeFunctionData, stringToHex } = require("viem");

const chain = { id: 4663, name: "hardhat", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } } };
const transport = custom(network.provider);
const reader = createPublicClient({ chain, transport });

async function main() {
  const [payer, recipient, stranger] = await network.provider.request({ method: "eth_accounts" });
  const wallet = (account) => createWalletClient({ chain, transport, account });
  const art = { settlement: await artifacts.readArtifact("PaidSettlement"), token: await artifacts.readArtifact("MockToken"), router: await artifacts.readArtifact("MockRouter") };

  const deploy = async (artifact, args = []) => {
    const hash = await wallet(payer).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args });
    return (await reader.waitForTransactionReceipt({ hash })).contractAddress;
  };
  const send = async (from, address, abi, functionName, args) => {
    const hash = await wallet(from).writeContract({ address, abi, functionName, args });
    return reader.waitForTransactionReceipt({ hash });
  };
  const read = (address, abi, functionName, args = []) => reader.readContract({ address, abi, functionName, args });
  const balance = (token, who) => read(token, art.token.abi, "balanceOf", [who]);
  const rejects = async (promise, name) => {
    await assert.rejects(promise, (error) => {
      const text = `${error.shortMessage ?? ""} ${error.message ?? ""} ${JSON.stringify(error.cause?.data ?? "")}`;
      assert.ok(text.includes(name), `expected ${name}, got: ${text.slice(0, 300)}`);
      return true;
    });
  };

  const usdg = await deploy(art.token);
  const nvda = await deploy(art.token);
  const spy = await deploy(art.token);
  const router = await deploy(art.router);
  const settlement = await deploy(art.settlement, [usdg, router]);
  const route = (spend, tokenOut, out, to = recipient) =>
    encodeFunctionData({ abi: art.router.abi, functionName: "swap", args: [usdg, spend, tokenOut, out, to] });
  const pay = (from, id, to, usdgPart, swaps) => send(from, settlement, art.settlement.abi, "pay", [stringToHex(id, { size: 32 }), to, usdgPart, swaps]);
  const check = (name) => console.log("ok  ", name);

  await send(payer, usdg, art.token.abi, "mint", [payer, 10_000_000_000n]);
  await send(payer, usdg, art.token.abi, "approve", [settlement, 1_000_000_000n]);

  // 1. $1,000 at 20% over two destinations
  const swaps = [
    { token: nvda, amountIn: 140_000_000n, minOut: 900n, data: route(140_000_000n, nvda, 1000n) },
    { token: spy, amountIn: 60_000_000n, minOut: 290n, data: route(60_000_000n, spy, 300n) },
  ];
  const before = await balance(usdg, payer);
  const receipt = await pay(payer, "inv-1", recipient, 800_000_000n, swaps);
  assert.equal(before - (await balance(usdg, payer)), 1_000_000_000n);
  assert.equal(await balance(usdg, recipient), 800_000_000n);
  assert.equal(await balance(nvda, recipient), 1000n);
  assert.equal(await balance(spy, recipient), 300n);
  assert.equal(await balance(usdg, settlement), 0n);
  assert.equal(await read(usdg, art.token.abi, "allowance", [settlement, router]), 0n);
  check("a payment sends the dollar part and converts the rest, keeping nothing");

  const terms = await read(settlement, art.settlement.abi, "termsHash", [stringToHex("inv-1", { size: 32 }), recipient, 800_000_000n, [nvda, spy], [140_000_000n, 60_000_000n]]);
  const [paidBy, paidAt] = await read(settlement, art.settlement.abi, "receipts", [terms]);
  assert.equal(paidBy.toLowerCase(), payer.toLowerCase());
  assert.ok(paidAt > 0n);
  const events = receipt.logs.filter((l) => l.address.toLowerCase() === settlement.toLowerCase()).map((l) => decodeEventLog({ abi: art.settlement.abi, ...l }));
  assert.deepEqual(events.map((e) => e.eventName), ["StockDelivered", "StockDelivered", "InvoicePaid"]);
  assert.equal(events[2].args.terms, terms);
  assert.equal(events[2].args.total, 1_000_000_000n);
  assert.equal(events[0].args.amountOut, 1000n);
  check("the receipt and events record the terms that were paid");

  // The site computes the same hash off chain; tests/settlement.test.ts checks it against this vector.
  mkdirSync("../research", { recursive: true });
  writeFileSync(
    "../research/terms-vector.json",
    JSON.stringify({ chainId: 4663, settlement, invoiceId: "inv-1", recipient, usdgToRecipient: "800000000", tokens: [nvda, spy], amountsIn: ["140000000", "60000000"], terms }, null, 2) + "\n",
  );

  // 2. same terms twice
  await send(payer, usdg, art.token.abi, "approve", [settlement, 1_000_000_000n]);
  await rejects(pay(payer, "inv-1", recipient, 800_000_000n, swaps), "AlreadyPaid");
  check("the same terms cannot be paid twice");

  // 3. delivery under the minimum reverts everything
  const short = [{ token: nvda, amountIn: 200_000_000n, minOut: 1000n, data: route(200_000_000n, nvda, 999n) }];
  const payerBefore = await balance(usdg, payer);
  await rejects(pay(payer, "inv-2", recipient, 800_000_000n, short), "DeliveredTooLittle");
  assert.equal(await balance(usdg, payer), payerBefore);
  assert.equal(await balance(usdg, recipient), 800_000_000n);
  check("a route that delivers less than the minimum reverts the whole payment");

  // 4. tokens delivered to someone else do not count
  const elsewhere = [{ token: nvda, amountIn: 200_000_000n, minOut: 1000n, data: route(200_000_000n, nvda, 1000n, stranger) }];
  await rejects(pay(payer, "inv-2", recipient, 800_000_000n, elsewhere), "DeliveredTooLittle");
  check("stock sent to another address does not settle the invoice");

  // 5. unspent USDG returns to the payer
  const partial = [{ token: nvda, amountIn: 200_000_000n, minOut: 1000n, data: route(150_000_000n, nvda, 1000n) }];
  await pay(payer, "inv-2", recipient, 800_000_000n, partial);
  assert.equal(payerBefore - (await balance(usdg, payer)), 950_000_000n);
  assert.equal(await balance(usdg, settlement), 0n);
  check("what a route does not spend goes back to the payer");

  // 6. failing and re-entering routes
  await send(payer, usdg, art.token.abi, "approve", [settlement, 1_000_000_000n]);
  const failing = [{ token: nvda, amountIn: 200_000_000n, minOut: 1n, data: encodeFunctionData({ abi: art.router.abi, functionName: "fail" }) }];
  await rejects(pay(payer, "inv-3", recipient, 800_000_000n, failing), "route failed");
  const reentering = [{ token: nvda, amountIn: 200_000_000n, minOut: 1n, data: encodeFunctionData({ abi: art.router.abi, functionName: "reenter", args: [settlement] }) }];
  await rejects(pay(payer, "inv-3", recipient, 800_000_000n, reentering), "Reentered");
  check("a failing route reverts with its reason, and a route cannot re-enter");

  // 7. malformed calls
  await rejects(pay(payer, "inv-3", "0x0000000000000000000000000000000000000000", 800_000_000n, []), "BadRecipient");
  await rejects(pay(payer, "inv-3", recipient, 0n, []), "NothingToPay");
  await rejects(pay(payer, "inv-3", recipient, 1n, [{ token: usdg, amountIn: 1n, minOut: 1n, data: "0x" }]), "BadSwap");
  await rejects(pay(payer, "inv-3", recipient, 1n, [{ token: nvda, amountIn: 1n, minOut: 0n, data: "0x" }]), "BadSwap");
  check("zero recipient, empty payment, USDG as a destination and a zero minimum are refused");

  // 8. no allowance, and a dollars-only invoice
  await rejects(pay(stranger, "inv-3", recipient, 5n, []), "TransferFailed");
  const recipientBefore = await balance(usdg, recipient);
  await pay(payer, "inv-3", recipient, 250_000_000n, []);
  assert.equal((await balance(usdg, recipient)) - recipientBefore, 250_000_000n);
  check("a payer without allowance is refused; a dollars-only payment works");

  console.log("\nall contract checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
