/**
 * What is wired to real services, and what is not. Screens read their
 * integration state from here, so nothing can claim more than this file does.
 *
 * Working, with no configuration:
 * - wallet connection (EIP-6963 browser wallets);
 * - link creation: the recipient signs the invoice, the server verifies the
 *   signature and stores it, and /pay/<id> is a shareable page;
 * - payment: PaidSettlement (chain/contracts) takes the payer's USDG, sends
 *   the dollar part to the recipient and converts the stock part through
 *   LI.FI, in one transaction. Its address is deterministic
 *   (src/core/settlement.ts); whether it is live is read from the chain
 *   (/api/status), and anyone can deploy it from /deploy.
 *
 * Fees, as they really are:
 * - PAID_FEE_BPS: the settlement contract takes nothing. This is a property
 *   of the deployed code, not a promise.
 * - The swap route (LI.FI) charges its own fee on the stock part. It is
 *   never hard-coded: the review step and the server read it from live quotes.
 *
 * Not available:
 * - PAID_TOKEN: the $PAID token and holder fee tiers. With no PAID fee there
 *   is nothing for a tier to lower yet.
 */

export interface PaidTokenConfig {
  address: `0x${string}`;
  /** Fee tiers for holders, lowest balance first. */
  tiers: { minBalance: string; conversionBps: number }[];
}

export const PAID_FEE_BPS = 0;
export const PAID_TOKEN: PaidTokenConfig | null = null;
