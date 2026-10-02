import { CHAIN } from "@/config/network";
import { SETTLEMENT_ADDRESS } from "@/core/settlement";
import { settlementDeployed } from "@/server/chain";

export const dynamic = "force-dynamic";

/** Whether payments can be made: the settlement contract exists at its predicted address. */
export async function GET(request: Request): Promise<Response> {
  const fresh = new URL(request.url).searchParams.has("fresh");
  return Response.json({ deployed: await settlementDeployed(fresh), settlement: SETTLEMENT_ADDRESS, chainId: CHAIN.id });
}
