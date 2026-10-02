// The paying side in a real (headless) browser, against the local fork:
// deploy the settlement contract from /deploy, then pay an invoice from /pay/<id>.
//
// Needs, in this order:
//   1. cd chain && npm run serve                 (fresh fork on :8689, funds the test wallet)
//   2. the app pointed at it with its own data:  RPC_URL=http://127.0.0.1:8689 PAID_DATA_DIR=data-fork npm run dev
//   3. node scripts/browser-pay.mjs
// Quotes are real (LI.FI); every transaction lands on the fork only.
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { DESTINATIONS, USDG } from "../src/config/network.ts";
import { creationMessage } from "../src/core/invoice.ts";
import { SETTLEMENT_ADDRESS } from "../src/core/settlement.ts";
import { launch, sleep } from "./cdp.mjs";

const BASE = process.env.BASE || "http://localhost:3689";
const FORK = process.env.FORK_RPC || "http://127.0.0.1:8689";
const LONG = 300_000; // a fork fetches state lazily: the first transactions are slow

const reader = createPublicClient({ transport: http(FORK, { timeout: 60_000 }) });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const balance = (token, who) => reader.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// The recipient is a throwaway key: it signs the invoice, then only receives.
const recipient = privateKeyToAccount(generatePrivateKey());
const draft = { description: "Brand identity design", amountCents: 30_000, clientName: "Acme Studio", stockPercent: 40, allocations: [{ symbol: "NVDA", share: 50 }, { symbol: "SPY", share: 50 }] };
const issuedAt = new Date().toISOString();
const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const signature = await recipient.signMessage({ message: creationMessage({ draft, recipient: recipient.address, issuedAt, nonce }) });
const created = await fetch(`${BASE}/api/invoices`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ draft, recipient: recipient.address, issuedAt, nonce, signature }) }).then((r) => r.json());
check("an invoice was created for a fresh recipient", typeof created.id === "string", `${BASE}/pay/${created.id}`);

const wallet = readFileSync(new URL("./fork-wallet.js", import.meta.url), "utf8").replace("__FORK_RPC__", FORK);
const page = await launch({ width: 1280, height: 1100, inject: [wallet] });
const has = async (text) => (await page.text()).toLowerCase().includes(text.toLowerCase());
const connect = async (button) => {
  await page.clickText(button, "button");
  await page.waitFor(`!!document.querySelector("dialog[open]")`, "wallet dialog");
  await sleep(300);
  await page.clickText("Fork test wallet", "dialog button");
  await page.waitFor(`!document.querySelector("dialog[open]")`, "wallet connected");
};

try {
  // ── deploy from the site, if this fork does not have the contract yet
  const preDeployed = Boolean(await reader.getCode({ address: SETTLEMENT_ADDRESS }));
  await page.navigate(`${BASE}/deploy`);
  await page.waitFor(`/Not deployed yet|Live\\. Invoices can be paid/.test(document.body.innerText)`, "deploy state", 60_000);
  if (!preDeployed) {
    check("the site reports the contract as missing", await has("Not deployed yet."));
    await page.shot("pay-1-deploy-before");
    await connect("Connect wallet to deploy");
    await sleep(400);
    await page.clickText("Deploy the contract", "button");
    await page.waitFor(`document.body.innerText.includes("Live. Invoices can be paid.")`, "deployment", LONG);
    check("deploying from the page puts the contract at the predicted address", Boolean(await reader.getCode({ address: SETTLEMENT_ADDRESS })), SETTLEMENT_ADDRESS);
  } else console.log("     (contract already on this fork: deploy step skipped)");
  await page.shot("pay-2-deploy-live");

  // ── pay
  await page.navigate(`${BASE}/pay/${created.id}`);
  await page.waitFor(`document.body.innerText.toLowerCase().includes("amount due")`, "payment page");
  await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /to pay|Pay \\$/.test(b.textContent) && !b.disabled)`, "pay button enabled", 60_000);
  check("the payer sees the invoice, not the split", (await has("$300.00")) && (await has("Acme Studio")) && !(await has("NVDA")) && !(await has("SPY")));
  if (!(await has("Pay $300.00 in USDG"))) await connect("Connect wallet to pay");
  await sleep(400);

  // a declined approval leaves the invoice unpaid
  await page.evaluate(`window.__WALLET_REJECT = "eth_sendTransaction"`);
  await page.clickText("Pay $300.00 in USDG", "button");
  await page.waitFor(`document.body.innerText.includes("Request declined in your wallet.")`, "decline message", 60_000);
  check("a declined wallet request is reported and nothing is paid", (await has("Unpaid")) && (await balance(USDG.address, recipient.address)) === 0n);
  await page.evaluate(`window.__WALLET_REJECT = null; window.__WALLET_LOG = []`);
  await page.shot("pay-3-declined");

  const payerBefore = await balance(USDG.address, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  await page.clickText("Pay $300.00 in USDG", "button");
  await page.waitFor(`document.body.innerText.toLowerCase().includes("amount paid") || !!document.querySelector('[role="alert"]')`, "payment result", LONG);
  const error = await page.evaluate(`document.querySelector('[role="alert"]')?.innerText ?? ""`);
  check("the payment went through in the browser", (await has("Amount paid")) && !error, error);
  await sleep(1500);
  check("the page now shows the invoice as paid, with the transaction", (await has("Paid on")) && (await has("View the transaction")) && !(await has("Pay $300.00")));
  await page.shot("pay-4-paid", { fullPage: true });

  // ── what the chain says
  const spent = payerBefore - (await balance(USDG.address, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"));
  check("the payer spent at most $300.00", spent > 0n && spent <= 300_000_000n, `${Number(spent) / 1e6} USDG`);
  check("the recipient holds $180.00 in USDG", (await balance(USDG.address, recipient.address)) === 180_000_000n);
  for (const symbol of ["NVDA", "SPY"]) {
    const got = await balance(DESTINATIONS[symbol].token.address, recipient.address);
    check(`the recipient holds ${symbol}`, got > 0n, `${Number(got) / 1e18}`);
  }
  check("the contract holds nothing", (await balance(USDG.address, SETTLEMENT_ADDRESS)) === 0n);
  const sends = await page.evaluate(`window.__WALLET_LOG.filter((c) => c.method === "eth_sendTransaction").map((c) => c.params[0].to.toLowerCase())`);
  check("the wallet signed one approval and one payment", sends.length === 2 && sends[0] === USDG.address.toLowerCase() && sends[1] === SETTLEMENT_ADDRESS.toLowerCase(), sends.join(","));

  // ── paying again is refused
  const again = await fetch(`${BASE}/api/invoices/${created.id}/prepare`, { method: "POST" });
  check("a paid invoice cannot be prepared again", again.status === 409);
  check("no console errors", page.consoleErrors.length === 0, page.consoleErrors.join(" | ").slice(0, 300));
} catch (error) {
  failures++;
  console.error("FAIL flow stopped:", error.message);
  await page.shot("pay-failure", { fullPage: true }).catch(() => {});
} finally {
  page.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
