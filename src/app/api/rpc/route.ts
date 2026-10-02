import { RPC_URL } from "@/server/chain";

/**
 * Same-origin relay for the browser's chain reads. The public RPC's
 * rate-limit responses carry a malformed CORS header that browsers refuse,
 * so pages read through here. Read-only methods only; wallets send transactions themselves.
 */
const ALLOWED = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_getBalance",
  "eth_getCode",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_getBlockByNumber",
]);

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 20) return Response.json({ error: "Invalid batch." }, { status: 400 });
  for (const call of calls) {
    const method = (call as { method?: unknown })?.method;
    if (typeof method !== "string" || !ALLOWED.has(method)) return Response.json({ error: "Method not allowed." }, { status: 403 });
  }
  try {
    const upstream = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "The network did not answer." }, { status: 502 });
  }
}
