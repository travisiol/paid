import { isAddress, keccak256, verifyMessage } from "viem";
import { SIGNATURE_WINDOW_MS, creationMessage, normalizeDraft, validateDraft } from "@/core/invoice";
import type { InvoiceDraft, SignedInvoiceRequest } from "@/core/invoice";
import { StoreError, invoices, storageIsPersistent } from "@/server/store";

function fail(status: number, error: string, fields?: Record<string, string>): Response {
  return Response.json({ error, ...(fields ? { fields } : {}) }, { status });
}

/** Mutations must come from this site's own pages. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function readDraft(value: unknown): InvoiceDraft | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.description !== "string" || typeof v.clientName !== "string" || !Array.isArray(v.allocations)) return null;
  if (v.allocations.length > 16) return null;
  const allocations = v.allocations.map((a) => {
    const entry = (a ?? {}) as Record<string, unknown>;
    return { symbol: String(entry.symbol ?? ""), share: entry.share as number };
  });
  return {
    description: v.description,
    clientName: v.clientName,
    amountCents: v.amountCents as number,
    stockPercent: v.stockPercent as number,
    allocations,
  };
}

/** Create a payment link from a request signed by the recipient's wallet. */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return fail(403, "Cross-site request refused.");

  let body: Partial<SignedInvoiceRequest>;
  try {
    body = (await request.json()) as Partial<SignedInvoiceRequest>;
  } catch {
    return fail(400, "Invalid request body.");
  }

  const draft = readDraft(body.draft);
  if (!draft) return fail(400, "Invalid invoice.");
  const errors = validateDraft(draft);
  if (Object.keys(errors).length > 0) return fail(400, "Some invoice details need fixing.", errors);

  const { recipient, issuedAt, nonce, signature } = body;
  if (typeof recipient !== "string" || !isAddress(recipient)) return fail(400, "Invalid recipient wallet.");
  if (typeof nonce !== "string" || !/^[a-f0-9]{16,64}$/.test(nonce)) return fail(400, "Invalid request.");
  if (typeof signature !== "string" || !/^0x[a-fA-F0-9]{130}$/.test(signature)) return fail(400, "Invalid signature.");
  const issued = typeof issuedAt === "string" ? Date.parse(issuedAt) : NaN;
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > SIGNATURE_WINDOW_MS)
    return fail(400, "This request has expired. Review the invoice and sign again.");

  const normalized = normalizeDraft(draft);
  const message = creationMessage({ draft: normalized, recipient, issuedAt: issuedAt as string, nonce });
  let valid = false;
  try {
    valid = await verifyMessage({ address: recipient as `0x${string}`, message, signature: signature as `0x${string}` });
  } catch {
    valid = false;
  }
  if (!valid) return fail(401, "The signature does not match this invoice and wallet.");

  // The id is derived from the signature, so a replayed request returns the same link.
  const id = BigInt(keccak256(signature as `0x${string}`)).toString(36).slice(0, 14);
  try {
    const invoice = invoices().create({ id, draft: normalized, recipient: recipient.toLowerCase(), signature: signature.toLowerCase(), issuedAt: issuedAt as string });
    return Response.json({ id: invoice.id, sequence: invoice.sequence, persistent: storageIsPersistent() }, { status: 201 });
  } catch (error) {
    // Matched by name as well: after a dev hot reload the long-lived store can throw an older copy of the class.
    if (error instanceof StoreError || (error instanceof Error && error.name === "StoreError")) {
      const known = error as StoreError;
      return fail(known.status, known.message);
    }
    console.error("[paid] could not store invoice:", error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown");
    return fail(500, "Something went wrong on our side. The link was not created.");
  }
}
