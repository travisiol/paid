# paid

Invoice in dollars. Get paid in stock. A payment link that splits each payment between USDG and tokenized stock on Robinhood Chain.

```bash
npm install
npm run dev        # http://localhost:3689
```

## How a payment works

1. The freelancer builds an invoice at `/create` and signs it with their wallet (free, no transaction). The server verifies the signature and stores it.
2. The client opens `/pay/<id>`, connects a wallet, approves the exact invoice amount in USDG and confirms one payment.
3. `PaidSettlement` (`chain/contracts`) pulls the USDG, sends the dollar part to the freelancer and converts the rest into their stock tokens through LI.FI, delivered straight to their wallet. If any conversion delivers less than its quoted minimum, the whole payment reverts.
4. The page reads the contract's receipt and shows the invoice as paid.

The contract has no owner, no admin, no fee and no upgrade path, and never keeps funds.

## One thing to do once: deploy the contract

The contract's address is deterministic (CREATE2 through the Arachnid proxy): `src/core/settlement.ts` computes it, and the site checks the chain for code there. Until it exists, a banner says so and the pay button is disabled.

Open `/deploy`, connect a wallet holding a little ETH on Robinhood Chain, and press **Deploy the contract**. One transaction; the deployer gets no control. Nothing to configure afterwards.

Any change to `chain/contracts/PaidSettlement.sol` (then `cd chain && npm run build`) changes the address.

## What is real, what is not

| Part | State |
| --- | --- |
| Landing, calculator, create flow, wallet connection, link creation | Working. |
| Paying an invoice | Working once the contract is deployed. Proven end to end on a fork of Robinhood Chain with live LI.FI quotes (see below). Not yet run on the real chain. |
| Fees | PAID takes none (property of the contract). The swap route charges its own fee on the stock part; the review step reads it from a live quote. |
| $PAID fee tiers | Not built. `PAID_TOKEN` is `null` in `src/config/integration.ts`. |

Known limits: a payer who bypasses the site and calls the contract with their own route can deliver the stock part at a poor rate (the contract enforces the route's minimum, not a market price). The server compares what was delivered with a fresh quote when a payment is reported and flags a shortfall to the recipient. Smart-contract wallets cannot create links (signature check is for regular accounts). Without `LIFI_API_KEY`, LI.FI limits quotes to roughly a hundred an hour per IP.

## Checks

```bash
npm test                       # split arithmetic, validation, terms hash, quote validation
cd chain && npm test           # the contract against mocks: refunds, minimums, replay, re-entrancy
npm run check:api              # HTTP rules against a running server
npm run check:tokens           # official asset list + on-chain name/symbol/decimals
node scripts/browser-flow.mjs  # create flow in headless Chrome (MOBILE=1 for 390px)
npm run lint && npm run build
```

Rehearsing real payments on a fork (nothing touches the real chain):

```bash
cd chain && npm run serve      # fork on :8689, funds a test wallet with USDG
RPC_URL=http://127.0.0.1:8689 PAID_DATA_DIR=data-fork npm run dev
node scripts/fork-pay.mjs      # deploy + pay an invoice across all four destinations
node scripts/browser-pay.mjs   # the same through /deploy and /pay in headless Chrome
```

## Hosting

Invoices live in SQLite (`./data/paid.db`). On serverless hosts the disk is read-only and links fall back to temporary storage, which the create flow reports. Use a host with a disk (`PAID_DATA_DIR`) or swap `src/server/store.ts` for a hosted database.
