import type { Address, PublicClient } from "viem";
import type { ResolvedConfig } from "../core/config";
import { publicRpc } from "../protocol/port";
import { cctpDeployment, cctpRoute } from "./cctp";
import { CctpUsdcABI } from "../abi/generated/CctpUsdc";
export interface BridgeClients {
  evm: PublicClient;
  arb: PublicClient;
  balances(
    owner: Address,
  ): Promise<{ balance: bigint; allowance: bigint; gas: bigint }>;
}
export function bridgeClients(config: ResolvedConfig): BridgeClients {
  const deployment = cctpDeployment(config.network);
  const evm = publicRpc(config.chain, config.rpcUrl),
    arb = publicRpc(config.arbitrumChain, config.arbitrumRpcUrl);
  return {
    evm,
    arb,
    balances: async (owner: Address) => {
      const [balance, allowance, gas] = await Promise.all([
        arb.readContract({
          address: deployment.usdc,
          abi: CctpUsdcABI,
          functionName: "balanceOf",
          args: [owner],
        }),
        arb.readContract({
          address: deployment.usdc,
          abi: CctpUsdcABI,
          functionName: "allowance",
          args: [owner, deployment.messenger],
        }),
        arb.getBalance({ address: owner }),
      ]);
      return { balance, allowance, gas };
    },
  };
}
export { cctpRoute };
