// Copies the compiled ABI and creation bytecode to the one file the site and the scripts share.
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const artifact = JSON.parse(readFileSync("artifacts/contracts/PaidSettlement.sol/PaidSettlement.json", "utf8"));
mkdirSync("../src/lib/abi", { recursive: true });
writeFileSync("../src/lib/abi/PaidSettlement.json", JSON.stringify({ abi: artifact.abi, bytecode: artifact.bytecode }, null, 2) + "\n");
console.log(`exported PaidSettlement: ${(artifact.bytecode.length - 2) / 2} bytes of creation code`);
