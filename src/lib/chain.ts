"use client";

import { useSyncExternalStore } from "react";
import { createPublicClient, http, parseAbi } from "viem";
import { CHAIN, USDG } from "@/config/network";

/**
 * Browser-side chain reads. They go through this site's own /api/rpc relay
 * (see that route for why); wallets send the transactions themselves.
 */
const chain = { id: CHAIN.id, name: CHAIN.name, nativeCurrency: CHAIN.nativeCurrency, rpcUrls: { default: { http: ["/api/rpc"] } } };
let client: ReturnType<typeof createPublicClient> | null = null;
export function reader() {
  client ??= createPublicClient({ chain, transport: http("/api/rpc", { timeout: 30_000 }) });
  return client;
}

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
export const ERC20_ABI = erc20;

export async function payerFunds(payer: string, spender: string): Promise<{ usdg: bigint; allowance: bigint; eth: bigint }> {
  const [usdg, allowance, eth] = await Promise.all([
    reader().readContract({ address: USDG.address, abi: erc20, functionName: "balanceOf", args: [payer as `0x${string}`] }),
    reader().readContract({ address: USDG.address, abi: erc20, functionName: "allowance", args: [payer as `0x${string}`, spender as `0x${string}`] }),
    reader().getBalance({ address: payer as `0x${string}` }),
  ]);
  return { usdg, allowance, eth };
}

/** Wait for a transaction to be mined; throws if it reverted. */
export async function mined(hash: string) {
  const receipt = await reader().waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 180_000, pollingInterval: 1500 });
  if (receipt.status !== "success") throw new Error("The transaction reverted. Nothing was paid.");
  return receipt;
}

// ───────────────────────────── is the settlement contract live?

export interface SettlementStatus {
  /** null while the first answer is on its way. */
  deployed: boolean | null;
}

const UNKNOWN: SettlementStatus = { deployed: null };
let status: SettlementStatus = UNKNOWN;
let requested = false;
const listeners = new Set<() => void>();

export async function refreshSettlement(): Promise<boolean> {
  try {
    const body = (await fetch("/api/status", { cache: "no-store" }).then((r) => r.json())) as { deployed?: boolean };
    status = { deployed: body.deployed === true };
  } catch {
    status = { deployed: false };
  }
  listeners.forEach((l) => l());
  return status.deployed === true;
}

export function useSettlement(): SettlementStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (!requested) {
        requested = true;
        void refreshSettlement();
      }
      return () => listeners.delete(listener);
    },
    () => status,
    () => UNKNOWN,
  );
}
