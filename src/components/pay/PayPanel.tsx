"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { encodeFunctionData, formatUnits } from "viem";
import { CHAIN, DESTINATIONS, USDG, explorerTx } from "@/config/network";
import { SETTLEMENT_ADDRESS } from "@/core/settlement";
import { ERC20_ABI, mined, payerFunds, useSettlement } from "@/lib/chain";
import { ensureChain, openWalletDialog, sendTransaction, shortAddress, useWallet, walletErrorMessage } from "@/lib/wallet";

type Phase = "idle" | "checking" | "approve" | "approve-mining" | "quote" | "pay" | "pay-mining" | "confirm";

const PHASE_TEXT: Record<Exclude<Phase, "idle">, string> = {
  checking: "Checking your wallet…",
  approve: "Approve the amount in your wallet…",
  "approve-mining": "Approval sent. Waiting for the network…",
  quote: "Preparing the payment…",
  pay: "Confirm the payment in your wallet…",
  "pay-mining": "Payment sent. Waiting for the network…",
  confirm: "Recording the payment…",
};

class PayError extends Error {}

function describe(error: unknown): string {
  if (error instanceof PayError) return error.message;
  const code = (error as { code?: number })?.code;
  if (code === 4001 || code === -32002) return walletErrorMessage(error);
  const text = String((error as { shortMessage?: string; message?: string })?.shortMessage ?? (error as Error)?.message ?? "");
  if (/reverted/i.test(text)) return "The transaction reverted. Nothing was paid.";
  if (/timed out|timeout/i.test(text)) return "The network took too long to answer. Check your wallet's activity before trying again.";
  return text ? text.slice(0, 200) : "The payment could not be completed.";
}

const usd = (micro: bigint) => `${Number(formatUnits(micro, USDG.decimals)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${USDG.symbol}`;

/** The payer's side: an exact USDG approval, then one transaction that settles the invoice. */
export function PayPanel({ id, amountLabel, totalMicro }: { id: string; amountLabel: string; totalMicro: string }) {
  const router = useRouter();
  const wallet = useWallet();
  const { deployed } = useSettlement();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const total = BigInt(totalMicro);
  const busy = phase !== "idle";

  const pay = async () => {
    if (!wallet.address) return openWalletDialog();
    setError(null);
    setSent(null);
    if (deployed === false) return setError("This invoice cannot be paid right now. Nothing has been charged.");
    try {
      setPhase("checking");
      await ensureChain();
      const funds = await payerFunds(wallet.address, SETTLEMENT_ADDRESS);
      if (funds.usdg < total) throw new PayError(`This wallet holds ${usd(funds.usdg)}. The invoice is ${usd(total)}.`);
      if (funds.eth === BigInt(0)) throw new PayError(`This wallet has no ${CHAIN.nativeCurrency.symbol} on ${CHAIN.name} to pay the network fee.`);

      if (funds.allowance < total) {
        setPhase("approve");
        // Exact approval, never unlimited.
        const approval = await sendTransaction(USDG.address, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [SETTLEMENT_ADDRESS, total] }));
        setPhase("approve-mining");
        await mined(approval);
      }

      setPhase("quote");
      const response = await fetch(`/api/invoices/${id}/prepare`, { method: "POST" });
      const prepared = (await response.json().catch(() => null)) as { settlement?: string; data?: string; error?: string } | null;
      if (response.status === 409) {
        router.refresh();
        throw new PayError("This invoice has already been paid.");
      }
      if (!response.ok || !prepared?.data || prepared.settlement?.toLowerCase() !== SETTLEMENT_ADDRESS.toLowerCase())
        throw new PayError(prepared?.error ?? "Could not prepare the payment. Try again.");

      setPhase("pay");
      const hash = await sendTransaction(SETTLEMENT_ADDRESS, prepared.data);
      setSent(hash);
      setPhase("pay-mining");
      await mined(hash);

      setPhase("confirm");
      // The page also reads the contract's receipt on load, so a failed report here loses nothing.
      await fetch(`/api/invoices/${id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: hash }) }).catch(() => null);
      router.refresh();
    } catch (e) {
      setError(describe(e));
    } finally {
      setPhase("idle");
    }
  };

  return (
    <>
      <button type="button" className="btn btn-accent mt-8 w-full" disabled={busy || deployed === null} onClick={pay}>
        {busy ? (
          <>
            <span className="spinner" aria-hidden="true" /> Working…
          </>
        ) : wallet.address ? (
          `Pay ${amountLabel} in ${USDG.symbol}`
        ) : (
          "Connect wallet to pay"
        )}
      </button>
      <p className="hint mt-3 text-center" aria-live="polite">
        {busy
          ? PHASE_TEXT[phase as Exclude<Phase, "idle">]
          : wallet.address
            ? `Paying from ${shortAddress(wallet.address)}. Two confirmations: an approval for exactly ${amountLabel}, then the payment.`
            : `You need a wallet on ${CHAIN.name} holding ${USDG.symbol}, and a little ${CHAIN.nativeCurrency.symbol} for the network fee.`}
      </p>
      {sent && busy && (
        <p className="hint mt-1 text-center">
          <a href={explorerTx(sent)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            View the transaction
          </a>
        </p>
      )}
      {error && (
        <p className="note note-bad mt-4" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Shown only to the connected recipient: what the payment delivered to their wallet. */
export function RecipientReceipt({ recipient, usdgMicro, delivered, shortfall }: { recipient: string; usdgMicro: string; delivered: { token: string; amountOut: string }[]; shortfall: boolean | null }) {
  const wallet = useWallet();
  if (wallet.address !== recipient.toLowerCase()) return null;
  const symbolOf = (token: string) => Object.values(DESTINATIONS).find((d) => d.token.address.toLowerCase() === token)?.token.symbol ?? shortAddress(token);
  return (
    <div className="note mt-6">
      <p className="font-bold text-ink">Delivered to your wallet</p>
      <ul className="mono mt-2 space-y-1 text-[14px] text-ink">
        <li>{usd(BigInt(usdgMicro))}</li>
        {delivered.map((line) => (
          <li key={line.token}>
            {Number(formatUnits(BigInt(line.amountOut), 18)).toLocaleString("en-US", { maximumFractionDigits: 6 })} {symbolOf(line.token)}
          </li>
        ))}
      </ul>
      {delivered.length === 0 && BigInt(usdgMicro) > BigInt(0) && <p className="mt-2">The stock amounts are in the payment transaction.</p>}
      {shortfall === true && <p className="mt-2 text-bad">The stock delivered was noticeably below the market quote at the time. Check the transaction.</p>}
      <p className="mt-2">Only you see this box. It appears because your wallet is the recipient.</p>
    </div>
  );
}
