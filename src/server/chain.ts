import "server-only";
import { createPublicClient, http } from "viem";
import { CHAIN } from "@/config/network";
import { SETTLEMENT_ABI, SETTLEMENT_ADDRESS } from "@/core/settlement";

/** Server-side RPC. RPC_URL can point at a local fork for rehearsals. */
export const RPC_URL = process.env.RPC_URL || CHAIN.rpcUrl;

const chain = { id: CHAIN.id, name: CHAIN.name, nativeCurrency: CHAIN.nativeCurrency, rpcUrls: { default: { http: [RPC_URL] } } };
export const publicClient = createPublicClient({ chain, transport: http(RPC_URL, { timeout: 20_000 }) });

let deployed = false;
let checkedAt = 0;

/** Is the settlement contract live at its predicted address? Cached: forever once true, 15 s while false. */
export async function settlementDeployed(fresh = false): Promise<boolean> {
  if (deployed) return true;
  if (!fresh && Date.now() - checkedAt < 15_000) return false;
  checkedAt = Date.now();
  try {
    const code = await publicClient.getCode({ address: SETTLEMENT_ADDRESS });
    deployed = Boolean(code && code.length > 2);
  } catch {
    deployed = false;
  }
  return deployed;
}

/** The contract's own record for a set of terms, or null if nothing was paid (or the chain cannot be read). */
export async function onchainReceipt(terms: `0x${string}`): Promise<{ payer: string; paidAt: number } | null> {
  if (!(await settlementDeployed())) return null;
  try {
    const [payer, paidAt] = (await publicClient.readContract({ address: SETTLEMENT_ADDRESS, abi: SETTLEMENT_ABI, functionName: "receipts", args: [terms] })) as [string, bigint];
    return paidAt > BigInt(0) ? { payer: payer.toLowerCase(), paidAt: Number(paidAt) } : null;
  } catch {
    return null;
  }
}
