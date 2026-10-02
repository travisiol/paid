"use client";

import { creationMessage, normalizeDraft } from "@/core/invoice";
import type { DraftErrors, InvoiceDraft } from "@/core/invoice";
import { signMessage, walletErrorMessage } from "./wallet";

export interface CreatedLink {
  id: string;
  sequence: number;
  url: string;
  /** False when the server keeps links in temporary storage. */
  persistent: boolean;
}

export class CreateLinkError extends Error {
  constructor(
    message: string,
    public fields?: DraftErrors,
  ) {
    super(message);
  }
}

function randomNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The whole creation boundary: the wallet signs the invoice, the server
 * verifies and stores it. Nothing touches the chain and no funds move.
 */
export async function createLink(input: InvoiceDraft, recipient: string, onPhase: (phase: "signing" | "saving") => void): Promise<CreatedLink> {
  const draft = normalizeDraft(input);
  const issuedAt = new Date().toISOString();
  const nonce = randomNonce();

  onPhase("signing");
  let signature: string;
  try {
    signature = await signMessage(creationMessage({ draft, recipient, issuedAt, nonce }));
  } catch (error) {
    throw new CreateLinkError(walletErrorMessage(error));
  }

  onPhase("saving");
  let response: Response;
  try {
    response = await fetch("/api/invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft, recipient, issuedAt, nonce, signature }),
    });
  } catch {
    throw new CreateLinkError("Could not reach the server. Check your connection and try again.");
  }
  const body = (await response.json().catch(() => null)) as { id?: string; sequence?: number; persistent?: boolean; error?: string; fields?: DraftErrors } | null;
  if (!response.ok || !body?.id) throw new CreateLinkError(body?.error ?? "The link could not be created.", body?.fields);
  return { id: body.id, sequence: body.sequence ?? 0, url: `${window.location.origin}/pay/${body.id}`, persistent: body.persistent !== false };
}
