import "server-only";
import { DatabaseSync } from "node:sqlite";
import { accessSync, constants, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvoiceDraft } from "@/core/invoice";
import type { Allocation } from "@/core/split";

/**
 * Stored invoices. `./data` when the disk is writable; otherwise the OS temp
 * directory, which is EPHEMERAL (serverless hosts) — links created there
 * disappear on the next cold start.
 */
function resolveDataDir(): { dir: string; persistent: boolean } {
  const explicit = process.env.PAID_DATA_DIR;
  const candidates = explicit ? [explicit] : [join(process.cwd(), "data")];
  for (const dir of candidates) {
    try {
      mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
      accessSync(/* turbopackIgnore: true */ dir, constants.W_OK);
      return { dir, persistent: true };
    } catch {
      // fall through
    }
  }
  const dir = join(tmpdir(), "paid");
  mkdirSync(dir, { recursive: true });
  console.warn("[paid] data directory is not writable; using ephemeral temp storage");
  return { dir, persistent: false };
}

/** "paid" is only ever set from the settlement contract: its receipt, or a verified transaction. */
export type InvoiceStatus = "open" | "paid";

export interface PaymentRecord {
  payer: string;
  /** Unix seconds, from the contract. */
  paidAt: number;
  /** Known when the payer's browser reported the transaction. */
  txHash: string | null;
  /** Stock tokens the recipient received, base units. Empty when only the on-chain receipt was read. */
  delivered: { token: string; amountOut: string }[];
  /** True when a delivered amount was well under a fresh quote at confirmation; null when it could not be compared. */
  shortfall: boolean | null;
}

export interface StoredInvoice extends InvoiceDraft {
  id: string;
  sequence: number;
  recipient: string;
  status: InvoiceStatus;
  createdAt: string;
  payment: PaymentRecord | null;
}

interface Row {
  id: string;
  sequence: number;
  recipient: string;
  description: string;
  client_name: string;
  amount_cents: number;
  stock_percent: number;
  allocations: string;
  status: InvoiceStatus;
  created_at: string;
  payment: string | null;
}

const MAX_LINKS_PER_RECIPIENT = 500;

export class StoreError extends Error {
  name = "StoreError";
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

class InvoiceStore {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        recipient TEXT NOT NULL,
        description TEXT NOT NULL,
        client_name TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        stock_percent INTEGER NOT NULL,
        allocations TEXT NOT NULL,
        signature TEXT NOT NULL UNIQUE,
        issued_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS invoices_recipient ON invoices (recipient);
    `);
    const columns = (db.prepare("PRAGMA table_info(invoices)").all() as { name: string }[]).map((column) => column.name);
    if (!columns.includes("payment")) db.exec("ALTER TABLE invoices ADD COLUMN payment TEXT");
  }

  /** Idempotent: the same signed request always maps to the same invoice. */
  create(input: { id: string; draft: InvoiceDraft; recipient: string; signature: string; issuedAt: string }): StoredInvoice {
    const existing = this.get(input.id);
    if (existing) return existing;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const { count } = this.db.prepare("SELECT COUNT(*) AS count FROM invoices WHERE recipient = ?").get(input.recipient) as { count: number };
      if (count >= MAX_LINKS_PER_RECIPIENT) throw new StoreError(429, "This wallet has reached the limit of payment links.");
      this.db
        .prepare(
          `INSERT INTO invoices (id, sequence, recipient, description, client_name, amount_cents, stock_percent, allocations, signature, issued_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          count + 1,
          input.recipient,
          input.draft.description,
          input.draft.clientName,
          input.draft.amountCents,
          input.draft.stockPercent,
          JSON.stringify(input.draft.allocations),
          input.signature,
          input.issuedAt,
          new Date().toISOString(),
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.get(input.id)!;
  }

  get(id: string): StoredInvoice | null {
    const row = this.db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as Row | undefined;
    if (!row) return null;
    return {
      id: row.id,
      sequence: row.sequence,
      recipient: row.recipient,
      description: row.description,
      clientName: row.client_name,
      amountCents: row.amount_cents,
      stockPercent: row.stock_percent,
      allocations: JSON.parse(row.allocations) as Allocation[],
      status: row.status,
      createdAt: row.created_at,
      payment: row.payment ? (JSON.parse(row.payment) as PaymentRecord) : null,
    };
  }

  /** Record a payment the chain has confirmed. A later call may add the transaction hash and delivered amounts. */
  markPaid(id: string, payment: PaymentRecord): void {
    const current = this.get(id);
    if (!current) return;
    const merged: PaymentRecord = current.payment
      ? { ...current.payment, txHash: current.payment.txHash ?? payment.txHash, delivered: current.payment.delivered.length ? current.payment.delivered : payment.delivered, shortfall: current.payment.shortfall ?? payment.shortfall }
      : payment;
    this.db.prepare("UPDATE invoices SET status = 'paid', payment = ? WHERE id = ?").run(JSON.stringify(merged), id);
  }
}

interface Runtime {
  store: InvoiceStore;
  persistent: boolean;
}

const globalRuntime = globalThis as unknown as { __paid?: Runtime };

function runtime(): Runtime {
  if (!globalRuntime.__paid) {
    const { dir, persistent } = resolveDataDir();
    const db = new DatabaseSync(join(dir, "paid.db"));
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    globalRuntime.__paid = { store: new InvoiceStore(db), persistent };
  }
  return globalRuntime.__paid;
}

export function invoices(): InvoiceStore {
  return runtime().store;
}

/** False when links live in temp storage and will not survive a restart. */
export function storageIsPersistent(): boolean {
  return runtime().persistent;
}
