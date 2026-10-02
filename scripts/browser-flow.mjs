// Drives the create flow in headless Chrome with a test wallet, and saves screenshots to shots/.
// usage: node scripts/browser-flow.mjs   (BASE=http://localhost:3689 by default)
// The wallet is scripts/dev-wallet.js backed by a throwaway key held by this script. Nothing touches a chain.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { launch, sleep } from "./cdp.mjs";

const BASE = process.env.BASE || "http://localhost:3689";
const account = privateKeyToAccount(generatePrivateKey());

const signer = createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  if (req.method !== "POST") return res.end();
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", async () => {
    const signature = await account.signMessage({ message: { raw: JSON.parse(raw).hex } });
    res.end(JSON.stringify({ signature }));
  });
});
await new Promise((resolve) => signer.listen(0, "127.0.0.1", resolve));
const wallet = readFileSync(new URL("./dev-wallet.js", import.meta.url), "utf8")
  .replace("__SIGNER_URL__", `http://127.0.0.1:${signer.address().port}`)
  .replace("__ACCOUNT__", account.address);

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const [width, height, mobile] = process.env.MOBILE ? [390, 844, true] : [1440, 900, false];
const tag = mobile ? "m" : "d";
const page = await launch({ width, height, mobile, inject: [wallet] });
const has = async (text) => (await page.text()).toLowerCase().includes(text.toLowerCase());
try {
  await page.navigate(`${BASE}/create`);
  await page.waitFor(`document.readyState === "complete" && !!document.querySelector("form")`, "create page");
  await sleep(1500);
  await page.shot(`flow-${tag}-1-empty`, { fullPage: true });

  // Step 1: validation, then valid details
  await page.clickText("Continue", "button");
  await sleep(300);
  check("empty details show errors", (await has("Describe the work")) && (await has("Enter an amount in dollars")));
  await page.typeInto("Description", "Brand identity design");
  await page.typeInto("Amount in dollars", "1,000");
  await page.typeInto("Client name", "Acme Studio");
  await sleep(300);
  check("preview shows the default 80/20 split", (await has("$800.00")) && (await has("$200.00")) && (await has("Paid in NVDA")));
  await page.shot(`flow-${tag}-1-details`, { fullPage: true });
  await page.clickText("Continue", "button");
  await page.waitFor(`document.body.innerText.includes("How should it be split?")`, "step 2");

  // Step 2: add a second destination, break the total, fix it
  await page.clickText("AAPL", "label");
  await sleep(300);
  check("two destinations split evenly", (await has("100% of 100%")) && (await has("Paid in stock")));
  await page.typeInto("NVDA share", "70");
  await sleep(200);
  await page.clickText("Continue", "button");
  await sleep(300);
  check("shares over 100 are refused", (await has("120% of 100%")) && (await has("Remove 20%")));
  await page.shot(`flow-${tag}-2-error`, { fullPage: true });
  await page.typeInto("AAPL share", "30");
  await sleep(300);
  check("fixed shares clear the error", (await has("100% of 100%")) && !(await has("Remove 20%")) && (await has("$140.00")) && (await has("$60.00")));
  await page.shot(`flow-${tag}-2-split`, { fullPage: true });
  await page.clickText("Continue", "button");
  await page.waitFor(`document.body.innerText.includes("Check it over.")`, "step 3");

  // Step 3: review, no wallet yet
  check("review lists amounts, asset and network", (await has("$800.00")) && (await has("USDG (Global Dollar) on Robinhood Chain")) && (await has("PAID fee: none.")));
  check("review asks for a wallet", (await has("Not connected")) && (await has("Connect wallet to create")));
  await page.shot(`flow-${tag}-3-review`, { fullPage: true });
  await page.clickText("Connect wallet to create", "button");
  await page.waitFor(`!!document.querySelector("dialog[open]")`, "wallet dialog");
  await sleep(300);
  await page.shot(`flow-${tag}-3-wallet`);
  await page.clickText("Test wallet", "dialog button");
  await page.waitFor(`!document.querySelector("dialog[open]")`, "wallet connected");
  check("recipient wallet is shown", await has(`${account.address.slice(0, 6).toLowerCase()}…${account.address.slice(-4).toLowerCase()}`));

  // Wallet declines the signature
  await page.evaluate(`window.__WALLET_REJECT = "personal_sign"`);
  await page.clickText("Create link", "button");
  await page.waitFor(`document.body.innerText.includes("Request declined in your wallet.")`, "decline message");
  check("a declined signature is reported and nothing is created", !(await has("Link saved")));
  await page.evaluate(`window.__WALLET_REJECT = null`);

  // Create for real
  await page.clickText("Create link", "button");
  await page.waitFor(`document.body.innerText.toUpperCase().includes("LINK SAVED")`, "success");
  await sleep(400);
  const url = await page.evaluate(`document.querySelector("p[title]").title`);
  check("a link is returned", /\/pay\/[a-z0-9]+$/.test(url), url);
  check("success state says what happened", await has("Creating the link moved no funds"));
  const methods = await page.evaluate(`window.__WALLET_LOG.map((c) => c.method).join(",")`);
  check("the wallet was only asked for accounts and signatures", !/eth_sendTransaction/.test(methods), methods);
  await page.shot(`flow-${tag}-4-created`, { fullPage: true });

  // Payment page
  await page.navigate(url);
  await page.waitFor(`document.body.innerText.toLowerCase().includes("amount due")`, "payment page");
  await sleep(1200);
  check("payment page shows the invoice", (await has("$1,000.00")) && (await has("Acme Studio")) && (await has("Unpaid")));
  check("payment page hides the split", !(await has("NVDA")) && !(await has("AAPL")));
  check("the page offers to pay, or says why it cannot", (await has("to pay")) || (await has("Pay $1,000.00 in USDG")));
  await page.shot(`flow-${tag}-5-pay`, { fullPage: true });
  const overflow = await page.evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check("no horizontal overflow", overflow <= 0, `${overflow}px`);
  check("no console errors", page.consoleErrors.length === 0, page.consoleErrors.join(" | ").slice(0, 300));
} catch (error) {
  failures++;
  console.error("FAIL flow stopped:", error.message);
  await page.shot(`flow-${tag}-failure`, { fullPage: true }).catch(() => {});
} finally {
  page.close();
  signer.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
