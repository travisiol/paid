// Test wallet for scripts/browser-flow.mjs, which injects it into the page — the site never loads it.
// It announces itself with EIP-6963 and asks the flow script's local signer (a throwaway key
// generated for the run) to sign. It holds no key and cannot reach any chain.
(() => {
  const SIGNER = "__SIGNER_URL__";
  const ACCOUNT = "__ACCOUNT__";
  window.__WALLET_LOG = [];
  const provider = {
    async request({ method, params }) {
      window.__WALLET_LOG.push({ method, params });
      if (window.__WALLET_REJECT === method) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
      if (method === "personal_sign") {
        const response = await fetch(SIGNER, { method: "POST", body: JSON.stringify({ hex: params[0] }) });
        return (await response.json()).signature;
      }
      throw Object.assign(new Error(`Unsupported method ${method}`), { code: 4200 });
    },
    on() {},
  };
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info: { uuid: "b7c4f1de-paid-test-wallet", name: "Test wallet", rdns: "local.paid.test" }, provider }),
      }),
    );
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
