import assert from "node:assert/strict";
import { test } from "node:test";
import { creationMessage, validateDetails, validateDraft, validateSplit } from "../src/core/invoice.ts";
import type { InvoiceDraft } from "../src/core/invoice.ts";
import { allocateStock, evenShares, formatUsd, parseAmount, splitAmount } from "../src/core/split.ts";

const draft = (patch: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  description: "Brand identity design",
  amountCents: 100_000,
  clientName: "",
  stockPercent: 20,
  allocations: [{ symbol: "NVDA", share: 100 }],
  ...patch,
});

test("the brief's example: $1,000 at 20% is $800 USDG and $200 stock", () => {
  assert.deepEqual(splitAmount(100_000, 20), { usdgCents: 80_000, stockCents: 20_000 });
});

test("parts always add up to the invoice, for every percent and awkward amounts", () => {
  for (const amount of [100, 101, 333, 999, 12_345, 100_001, 99_999_999]) {
    for (let percent = 0; percent <= 100; percent++) {
      const { usdgCents, stockCents } = splitAmount(amount, percent);
      assert.equal(usdgCents + stockCents, amount);
      assert.ok(usdgCents >= 0 && stockCents >= 0);
    }
  }
});

test("stock portion rounds to the nearest cent", () => {
  assert.equal(splitAmount(333, 50).stockCents, 167); // 166.5 rounds up
  assert.equal(splitAmount(101, 33).stockCents, 33); // 33.33 rounds down
});

test("destinations share the stock portion exactly", () => {
  const three = allocateStock(10_000, evenShares(3).map((share, i) => ({ symbol: ["NVDA", "AAPL", "TSLA"][i], share })));
  assert.deepEqual(three.map((a) => a.cents), [3400, 3300, 3300]);
  const odd = allocateStock(1001, [
    { symbol: "NVDA", share: 50 },
    { symbol: "SPY", share: 50 },
  ]);
  assert.deepEqual(odd.map((a) => a.cents), [501, 500]);
  for (const cents of [1, 7, 99, 1001, 20_000, 3_333_333]) {
    const parts = allocateStock(cents, [
      { symbol: "NVDA", share: 37 },
      { symbol: "AAPL", share: 29 },
      { symbol: "TSLA", share: 21 },
      { symbol: "SPY", share: 13 },
    ]);
    assert.equal(parts.reduce((sum, a) => sum + a.cents, 0), cents);
  }
});

test("even shares add up to 100", () => {
  assert.deepEqual(evenShares(1), [100]);
  assert.deepEqual(evenShares(3), [34, 33, 33]);
  assert.deepEqual(evenShares(4), [25, 25, 25, 25]);
});

test("amounts parse from what people type", () => {
  assert.equal(parseAmount("1,000"), 100_000);
  assert.equal(parseAmount("$249.5"), 24_950);
  assert.equal(parseAmount(" 80.00 "), 8000);
  assert.equal(parseAmount("0.07"), 7);
  for (const bad of ["", "abc", "10.999", "-5", "1e3", "1.2.3", "."]) assert.equal(parseAmount(bad), null, bad);
  assert.equal(formatUsd(100_000), "$1,000.00");
  assert.equal(formatUsd(7), "$0.07");
});

test("details validation", () => {
  assert.deepEqual(validateDetails(draft()), {});
  assert.ok(validateDetails(draft({ description: "  " })).description);
  assert.ok(validateDetails(draft({ amountCents: 99 })).amount);
  assert.ok(validateDetails(draft({ amountCents: 100_000_001 })).amount);
  assert.ok(validateDetails(draft({ amountCents: NaN })).amount);
  assert.ok(validateDetails(draft({ clientName: "x".repeat(81) })).clientName);
});

test("split validation: shares must be whole, known, unique and sum to 100", () => {
  assert.deepEqual(validateSplit(draft()), {});
  assert.ok(validateSplit(draft({ stockPercent: 0 })).stockPercent);
  assert.ok(validateSplit(draft({ stockPercent: 101 })).stockPercent);
  assert.ok(validateSplit(draft({ stockPercent: 12.5 })).stockPercent);
  assert.ok(validateSplit(draft({ allocations: [] })).allocations);
  assert.ok(validateSplit(draft({ allocations: [{ symbol: "GME", share: 100 }] })).allocations);
  assert.ok(validateSplit(draft({ allocations: [{ symbol: "__proto__", share: 100 }] })).allocations);
  assert.match(
    validateSplit(draft({ allocations: [{ symbol: "NVDA", share: 60 }, { symbol: "AAPL", share: 30 }] })).allocations!,
    /remaining 10%/,
  );
  assert.match(
    validateSplit(draft({ allocations: [{ symbol: "NVDA", share: 60 }, { symbol: "AAPL", share: 50 }] })).allocations!,
    /Remove 10%/,
  );
  assert.ok(validateSplit(draft({ allocations: [{ symbol: "NVDA", share: 50 }, { symbol: "NVDA", share: 50 }] })).allocations);
  assert.ok(validateSplit(draft({ allocations: [{ symbol: "NVDA", share: NaN }] })).allocations);
  // $1.00 at 1% is one cent: it cannot be shared between two destinations.
  assert.ok(
    validateSplit(draft({ amountCents: 100, stockPercent: 1, allocations: [{ symbol: "NVDA", share: 50 }, { symbol: "AAPL", share: 50 }] })).allocations,
  );
  assert.deepEqual(validateDraft(draft({ allocations: [{ symbol: "NVDA", share: 70 }, { symbol: "SPY", share: 30 }] })), {});
});

test("the signed message states the whole invoice", () => {
  const message = creationMessage({
    draft: draft({ clientName: " Acme  Studio " }),
    recipient: "0xABCDEF0000000000000000000000000000000001",
    issuedAt: "2026-10-02T10:00:00.000Z",
    nonce: "00ff",
  });
  assert.match(message, /Amount: \$1,000\.00, paid in USDG/);
  assert.match(message, /Client: Acme Studio/);
  assert.match(message, /Split: 80% USDG, 20% tokenized stock/);
  assert.match(message, /Stock: NVDA 100%/);
  assert.match(message, /Recipient: 0xabcdef0000000000000000000000000000000001/);
  assert.match(message, /Robinhood Chain \(4663\)/);
});
