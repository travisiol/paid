/**
 * Compiles PaidSettlement and, with FORK=1, runs an in-process fork of
 * Robinhood Chain (id 4663) at the latest block. The public RPC only keeps
 * recent state, so a fork lives a few minutes: serve, rehearse, done.
 *
 * bytecodeHash "none" keeps the creation bytecode — and so the CREATE2
 * address — identical on every machine.
 */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 500 }, evmVersion: "cancun", metadata: { bytecodeHash: "none" } },
  },
  networks: {
    hardhat: {
      chainId: 4663,
      chains: { 4663: { hardforkHistory: { cancun: 0 } } },
      ...(process.env.FORK ? { forking: { url: process.env.FORK_URL || "https://rpc.mainnet.chain.robinhood.com" } } : {}),
    },
  },
};
