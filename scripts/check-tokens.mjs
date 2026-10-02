// Re-reads every configured token: Robinhood's official asset list, then name() / symbol() / decimals() on chain.
// usage: npm run check:tokens            (writes research/token-check.json)
// Nothing is sent: HTTP GET and eth_call only.
import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { CHAIN, DESTINATIONS, USDG } from "../src/config/network.ts";

const client = createPublicClient({ transport: http(process.env.RPC_URL || CHAIN.rpcUrl) });
const abi = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const read = (address, functionName) => client.readContract({ address, abi, functionName });

const official = await fetch("https://api.robinhood.com/rhj/assets", { headers: { "user-agent": "paid-check" } })
  .then((r) => r.json())
  .then((j) => j.assets);

const chainId = await client.getChainId();
const block = await client.getBlockNumber();
const out = { chainId, block: Number(block), checkedAt: new Date().toISOString(), usdg: null, tokens: {} };
let failed = chainId !== CHAIN.id;
if (failed) console.error(`RPC answers chain ${chainId}, expected ${CHAIN.id}`);

out.usdg = { address: USDG.address, name: await read(USDG.address, "name"), symbol: await read(USDG.address, "symbol"), decimals: await read(USDG.address, "decimals") };
if (out.usdg.symbol !== USDG.symbol || out.usdg.decimals !== USDG.decimals) failed = true;
console.log("USDG", out.usdg);

for (const [key, { token }] of Object.entries(DESTINATIONS)) {
  const listed = official.find((a) => a.tokenSymbol === token.symbol);
  const listedAddress = listed?.deployments.find((d) => d.chainId === CHAIN.id)?.contractAddress;
  const entry = {
    address: token.address,
    inOfficialList: listedAddress?.toLowerCase() === token.address.toLowerCase(),
    listStatus: listed?.status ?? null,
    name: await read(token.address, "name"),
    symbol: await read(token.address, "symbol"),
    decimals: await read(token.address, "decimals"),
  };
  entry.ok = entry.inOfficialList && entry.listStatus === "ASSET_STATUS_ACTIVE" && entry.symbol === token.symbol && entry.name === token.onchainName && entry.decimals === token.decimals;
  if (!entry.ok) failed = true;
  out.tokens[key] = entry;
  console.log(entry.ok ? "ok  " : "FAIL", key, entry);
}

mkdirSync("research", { recursive: true });
writeFileSync("research/token-check.json", JSON.stringify(out, null, 2));
process.exit(failed ? 1 : 0);
