import type { Address, PublicClient } from "viem";
import type { ResolvedConfig } from "../core/config";
import { publicRpc } from "../protocol/port";
import { cctpDeployment, cctpRoute } from "./cctp";
import { CctpUsdcABI } from "../abi/generated/CctpUsdc";
import { invariant } from "../core/errors";
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
      invariant(
        (await arb.getChainId()) === config.arbitrumChain.id,
        "RPC_NETWORK_MISMATCH",
        "Arbitrum RPC endpoint does not match the configured network.",
      );
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
