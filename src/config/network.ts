/**
 * The single place for network and token configuration.
 * This file has no imports so scripts and tests can load it directly.
 *
 * Nothing here is guessed:
 * - Chain ID, RPC and explorer come from the official Robinhood Chain docs
 *   (https://docs.robinhood.com/chain/connecting).
 * - Token addresses come from Robinhood's official asset list
 *   (GET https://api.robinhood.com/rhj/assets). `npm run check:tokens`
 *   re-reads that list and calls name() / symbol() / decimals() on chain for
 *   every entry; research/token-check.json records the last run.
 */

export interface ChainConfig {
  id: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export const CHAIN: ChainConfig = {
  id: 4663,
  name: "Robinhood Chain",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

export interface TokenConfig {
  symbol: string;
  /** name() as returned by the contract. */
  onchainName: string;
  address: `0x${string}`;
  decimals: number;
}

/** The only asset a payer can pay with. */
export const USDG: TokenConfig = {
  symbol: "USDG",
  onchainName: "Global Dollar",
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
};

export type DestinationKind = "company" | "index";

export interface Destination {
  /** How PAID labels the destination. */
  label: string;
  /** Short name used in sentences ("Paid in Nvidia."). */
  name: string;
  kind: DestinationKind;
  /** What the token is, in one factual line. */
  description: string;
  token: TokenConfig;
}

/**
 * Stock destinations a recipient can choose. Keyed by the on-chain token symbol.
 * The S&P 500 destination is a tokenized ETF that tracks the index — not a
 * company stock and not the index itself.
 */
export const DESTINATIONS: Record<string, Destination> = {
  NVDA: {
    label: "NVDA",
    name: "Nvidia",
    kind: "company",
    description: "Tokenized NVIDIA stock.",
    token: {
      symbol: "NVDA",
      onchainName: "NVIDIA • Robinhood Token",
      address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
      decimals: 18,
    },
  },
  AAPL: {
    label: "AAPL",
    name: "Apple",
    kind: "company",
    description: "Tokenized Apple stock.",
    token: {
      symbol: "AAPL",
      onchainName: "Apple • Robinhood Token",
      address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
      decimals: 18,
    },
  },
  TSLA: {
    label: "TSLA",
    name: "Tesla",
    kind: "company",
    description: "Tokenized Tesla stock.",
    token: {
      symbol: "TSLA",
      onchainName: "Tesla • Robinhood Token",
      address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
      decimals: 18,
    },
  },
  SPY: {
    label: "S&P 500",
    name: "the S&P 500",
    kind: "index",
    description: "A tokenized index fund (SPY) that tracks the S&P 500. One instrument covering many companies, not a single company’s stock.",
    token: {
      symbol: "SPY",
      onchainName: "SPDR S&P 500 ETF Trust • Robinhood Token",
      address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
      decimals: 18,
    },
  },
};

export const DESTINATION_KEYS = Object.keys(DESTINATIONS);

export function explorerToken(address: string): string {
  return `${CHAIN.explorerUrl}/token/${address}`;
}

export function explorerAddress(address: string): string {
  return `${CHAIN.explorerUrl}/address/${address}`;
}

/**
 * The swap route for the stock part: LI.FI, one of the aggregator venues named in
 * https://docs.robinhood.com/chain/building-with-stock-tokens. `diamond` is the
 * `diamondAddress` LI.FI publishes for chain 4663 (GET https://li.quest/v1/chains),
 * and the address every quote returns as both `transactionRequest.to` and
 * `estimate.approvalAddress`. Only venues that settle in the same transaction are
 * allowed: an intent-based venue would take the USDG and deliver later.
 */
export const LIFI = {
  apiUrl: "https://li.quest/v1",
  diamond: "0xB477751B76CF82d00a686A1232f5fCD772414Af3" as `0x${string}`,
  integrator: "paid",
  exchanges: ["kyberswap"],
};

/** The most a swap may deliver under its quoted estimate before the payment reverts. */
export const MAX_SLIPPAGE_BPS = 100;

/**
 * Deterministic deployment proxy (Arachnid), present on Robinhood Chain.
 * The settlement contract is deployed through it, so its address is known
 * before anyone deploys it and nobody needs a key or an address to configure.
 */
export const CREATE2_PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as `0x${string}`;

export function explorerTx(hash: string): string {
  return `${CHAIN.explorerUrl}/tx/${hash}`;
}
