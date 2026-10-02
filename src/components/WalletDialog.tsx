"use client";

import { useState } from "react";
import { CHAIN } from "@/config/network";
import { closeWalletDialog, connectWallet, disconnectWallet, openWalletDialog, shortAddress, useWallet, walletErrorMessage } from "@/lib/wallet";
import type { DiscoveredWallet } from "@/lib/wallet";
import { Modal } from "./Modal";

export function WalletDialog() {
  const wallet = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    closeWalletDialog();
  };

  const connect = async (candidate: DiscoveredWallet) => {
    setBusy(candidate.id);
    setError(null);
    try {
      await connectWallet(candidate);
      close();
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={wallet.dialogOpen} onClose={close} title={wallet.address ? "Your wallet" : "Connect a wallet"}>
      {wallet.address ? (
        <div className="space-y-5">
          <div className="panel p-5">
            <p className="mono text-lg font-medium">{shortAddress(wallet.address)}</p>
            <p className="hint mt-1">Connected with {wallet.walletName}</p>
          </div>
          <p className="hint">
            Payment links you create name this wallet as the recipient on {CHAIN.name}. Connecting only shares your address.
          </p>
          <button
            type="button"
            className="btn btn-line w-full"
            onClick={() => {
              disconnectWallet();
              close();
            }}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="hint">Your wallet is where the dollars and the stock from each payment are sent. Connecting only shares your address.</p>
          {wallet.wallets.length > 0 ? (
            <ul className="space-y-2.5">
              {wallet.wallets.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => connect(candidate)}
                    className="panel flex w-full cursor-pointer items-center gap-4 p-4 text-left transition-colors hover:border-ink disabled:opacity-60"
                  >
                    {candidate.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element -- wallet-provided data URI
                      <img src={candidate.icon} alt="" className="size-10 rounded-lg" />
                    ) : (
                      <span className="grid size-10 place-items-center rounded-lg bg-accent font-black" aria-hidden="true">
                        {candidate.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="flex-1 text-lg font-bold">{candidate.name}</span>
                    {busy === candidate.id ? <span className="spinner" /> : <span className="hint">Detected</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="note">
              <p className="font-bold text-ink">No wallet detected in this browser</p>
              <p className="mt-1">
                Install a browser wallet that supports {CHAIN.name}, then reopen this window. You can still try the split calculator and the
                form without one.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="note note-bad">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

export function WalletButton({ className = "btn btn-ink btn-sm" }: { className?: string }) {
  const wallet = useWallet();
  return (
    <button type="button" className={className} onClick={openWalletDialog}>
      {wallet.address ? (
        <>
          <span className="size-2 rounded-[2px] bg-accent" aria-hidden="true" />
          <span className="mono text-[14px] font-medium">{shortAddress(wallet.address)}</span>
        </>
      ) : (
        "Connect wallet"
      )}
    </button>
  );
}
