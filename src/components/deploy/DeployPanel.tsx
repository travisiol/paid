"use client";

import { useState } from "react";
import { CHAIN, CREATE2_PROXY, LIFI, USDG, explorerAddress, explorerTx } from "@/config/network";
import { DEPLOY_TRANSACTION, SETTLEMENT_ADDRESS } from "@/core/settlement";
import { mined, reader, refreshSettlement, useSettlement } from "@/lib/chain";
import { ensureChain, openWalletDialog, sendTransaction, shortAddress, useWallet, walletErrorMessage } from "@/lib/wallet";

type Phase = "idle" | "wallet" | "mining";

/** One transaction, from any wallet, puts the settlement contract at its predicted address. */
export function DeployPanel() {
  const wallet = useWallet();
  const { deployed } = useSettlement();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const deploy = async () => {
    if (!wallet.address) return openWalletDialog();
    setError(null);
    try {
      setPhase("wallet");
      await ensureChain();
      const tx = await sendTransaction(DEPLOY_TRANSACTION.to, DEPLOY_TRANSACTION.data);
      setHash(tx);
      setPhase("mining");
      await mined(tx);
      const code = await reader().getCode({ address: SETTLEMENT_ADDRESS });
      if (!code || code.length <= 2) throw new Error("The transaction was mined but no contract appeared at the expected address.");
      await fetch("/api/status?fresh=1", { cache: "no-store" });
      await refreshSettlement();
    } catch (e) {
      const code = (e as { code?: number })?.code;
      setError(code === 4001 || code === -32002 ? walletErrorMessage(e) : String((e as Error)?.message ?? "The deployment failed.").slice(0, 220));
    } finally {
      setPhase("idle");
    }
  };

  return (
    <div>
      <dl className="border-b border-line">
        {[
          ["Contract", "PaidSettlement — no owner, no admin, no fee, not upgradeable"],
          ["Address", SETTLEMENT_ADDRESS],
          ["Network", `${CHAIN.name} · chain ID ${CHAIN.id}`],
          ["Pays in", `${USDG.symbol} · ${USDG.address}`],
          ["Swap router", `LI.FI · ${LIFI.diamond}`],
          ["Deployed through", `CREATE2 proxy · ${CREATE2_PROXY}`],
        ].map(([label, value]) => (
          <div key={label} className="grid gap-1 border-t border-line py-3.5 text-[15.5px] sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4">
            <dt className="font-semibold">{label}</dt>
            <dd className={label === "Contract" || label === "Network" ? "" : "mono text-[13.5px] break-all"}>
              {label === "Address" ? (
                <a href={explorerAddress(SETTLEMENT_ADDRESS)} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-ink">
                  {value}
                </a>
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
        <div className="grid gap-1 border-t border-line py-3.5 text-[15.5px] sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4">
          <dt className="font-semibold">State</dt>
          <dd aria-live="polite">
            {deployed === null ? "Reading the chain…" : deployed ? <span className="font-bold">Live. Invoices can be paid.</span> : "Not deployed yet."}
          </dd>
        </div>
      </dl>

      {deployed === false && (
        <>
          <button type="button" className="btn btn-accent mt-8 w-full sm:w-auto" disabled={phase !== "idle"} onClick={deploy}>
            {phase === "wallet" ? (
              <>
                <span className="spinner" aria-hidden="true" /> Confirm in your wallet…
              </>
            ) : phase === "mining" ? (
              <>
                <span className="spinner" aria-hidden="true" /> Deploying…
              </>
            ) : wallet.address ? (
              "Deploy the contract"
            ) : (
              "Connect wallet to deploy"
            )}
          </button>
          <p className="hint mt-3 max-w-[64ch]">
            {wallet.address ? `Sent from ${shortAddress(wallet.address)}. ` : ""}One transaction. You pay the network fee in {CHAIN.nativeCurrency.symbol}; deploying gives
            you no control over the contract, and the address is the same whoever deploys it.
          </p>
        </>
      )}
      {hash && (
        <p className="hint mt-3">
          <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            View the deployment transaction
          </a>
        </p>
      )}
      {error && (
        <p className="note note-bad mt-4" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
