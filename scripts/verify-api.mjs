// HTTP checks against a running server: link creation rules and the payment page.
// usage: npm run check:api   (BASE=http://localhost:3689 by default)
// Signs with a throwaway key generated for the run. Nothing touches the chain.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { creationMessage } from "../src/core/invoice.ts";

const BASE = process.env.BASE || "http://localhost:3689";
const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

const baseDraft = { description: "Brand identity design", amountCents: 100_000, clientName: "Acme Studio", stockPercent: 20, allocations: [{ symbol: "NVDA", share: 100 }] };

async function signed(draft, { signer = account, recipient = account.address, issuedAt = new Date().toISOString() } = {}) {
  const n = nonce();
  const signature = await signer.signMessage({ message: creationMessage({ draft, recipient, issuedAt, nonce: n }) });
  return { draft, recipient, issuedAt, nonce: n, signature };
}
const post = (body, headers = { origin: BASE }) =>
  fetch(`${BASE}/api/invoices`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 1. happy path
const request = await signed(baseDraft);
let r = await post(request);
let body = await r.json();
check("valid signed invoice is stored", r.status === 201 && typeof body.id === "string", `status ${r.status} id ${body.id}`);
const id = body.id;

// 2. replay returns the same link
r = await post(request);
body = await r.json();
check("replayed request returns the same link", r.status === 201 && body.id === id);

// 3. payment page
r = await fetch(`${BASE}/pay/${id}`);
const html = await r.text();
check("payment page renders the invoice", r.status === 200 && html.includes("$1,000.00") && html.includes("Brand identity design") && html.includes("Acme Studio"));
check("payment page names USDG and the network", html.includes("USDG") && html.includes("Robinhood Chain"));
check("payment page says unpaid", html.includes("Unpaid") && html.includes("No payment has been recorded"));
check("payment page does not reveal the split", !html.includes("NVDA") && !html.includes("20%") && !html.includes("$200.00") && !html.includes("$800.00"));

// 4. refusals
r = await post(request, {});
check("request without Origin is refused", r.status === 403);
r = await post(request, { origin: "https://evil.example" });
check("cross-site request is refused", r.status === 403);
r = await post("{not json");
check("malformed body is refused", r.status === 400);
r = await post(await signed(baseDraft, { signer: other }));
check("signature from another wallet is refused", r.status === 401);
const tampered = await signed(baseDraft);
r = await post({ ...tampered, draft: { ...baseDraft, amountCents: 5_000_000 } });
check("amount changed after signing is refused", r.status === 401);
r = await post({ ...tampered, draft: { ...baseDraft, stockPercent: 90 } });
check("split changed after signing is refused", r.status === 401);
r = await post(await signed(baseDraft, { issuedAt: new Date(Date.now() - 3_600_000).toISOString() }));
check("expired request is refused", r.status === 400);
r = await post(await signed({ ...baseDraft, allocations: [{ symbol: "NVDA", share: 60 }, { symbol: "AAPL", share: 30 }] }));
body = await r.json();
check("shares that do not sum to 100 are refused", r.status === 400 && /90%/.test(body.fields?.allocations ?? ""));
r = await post(await signed({ ...baseDraft, allocations: [{ symbol: "GME", share: 100 }] }));
check("unknown destination is refused", r.status === 400);
r = await post(await signed({ ...baseDraft, amountCents: 50 }));
check("amount under the minimum is refused", r.status === 400);
r = await post(await signed({ ...baseDraft, amountCents: 1000.5 }));
check("fractional cents are refused", r.status === 400);
r = await post(await signed({ ...baseDraft, description: "" }));
check("empty description is refused", r.status === 400);

// 5. multi-destination link and sequence
r = await post(await signed({ ...baseDraft, clientName: "", allocations: [{ symbol: "NVDA", share: 50 }, { symbol: "SPY", share: 50 }] }));
body = await r.json();
check("multi-destination invoice is stored with the next number", r.status === 201 && body.sequence === 2, `sequence ${body.sequence}`);

// 6. payment endpoints
r = await fetch(`${BASE}/api/status`);
body = await r.json();
check("status reports the settlement address and whether it is live", r.status === 200 && /^0x[0-9a-fA-F]{40}$/.test(body.settlement) && typeof body.deployed === "boolean", `deployed: ${body.deployed}`);
const live = body.deployed;
r = await fetch(`${BASE}/api/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
body = await r.json();
check("the RPC relay answers reads", r.status === 200 && Number(body.result) === 4663);
r = await fetch(`${BASE}/api/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0x00"] }) });
check("the RPC relay refuses anything that is not a read", r.status === 403);
r = await fetch(`${BASE}/api/invoices/${id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: `0x${"ab".repeat(32)}` }) });
check("a transaction that does not exist cannot mark an invoice paid", r.status === 404 || r.status === 422, `status ${r.status}`);
r = await fetch(`${BASE}/api/invoices/${id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: "paid" }) });
check("a malformed transaction hash is refused", r.status === 400);
r = await fetch(`${BASE}/pay/${id}`);
check("the invoice is still unpaid afterwards", (await r.text()).includes("Unpaid"));
r = await fetch(`${BASE}/api/invoices/doesnotexist1/prepare`, { method: "POST" });
check("preparing an unknown invoice is a 404", r.status === 404);
r = await fetch(`${BASE}/api/invoices/${id}/prepare`, { method: "POST" });
body = await r.json();
if (live) check("preparing a payment returns the pay() call from live quotes", r.status === 200 && /^0x[0-9a-f]{200,}$/i.test(body.data) && body.total === "1000000000", `status ${r.status} ${body.error ?? ""}`);
else check("preparing a payment is refused while the contract is not deployed", r.status === 503);
r = await fetch(`${BASE}/api/estimate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountCents: 100000, stockPercent: 20, allocations: [{ symbol: "NVDA", share: 60 }] }) });
check("an estimate for an invalid split is refused", r.status === 400);
r = await fetch(`${BASE}/api/estimate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountCents: 100000, stockPercent: 20, allocations: [{ symbol: "NVDA", share: 100 }] }) });
body = await r.json();
check("an estimate returns the route fee from a live quote", r.status === 200 && body.lines?.[0]?.symbol === "NVDA" && BigInt(body.lines[0].toAmount) > 0n, `fee ${Number(body.lines?.[0]?.feeMicro) / 1e6} USDG on 200 · ${body.error ?? ""}`);

// 7. unknown links
r = await fetch(`${BASE}/pay/doesnotexist1`);
check("unknown link is a 404", r.status === 404);
r = await fetch(`${BASE}/pay/${encodeURIComponent("../etc")}`);
check("malformed link id is a 404", r.status === 404);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
