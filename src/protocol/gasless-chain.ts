import type { Address } from "viem";
import { arbitrum } from "viem/chains";
import type { ResolvedConfig } from "../core/config";
import { IERC20ABI } from "../abi/IERC20";
import { publicRpc } from "./port";
import { ARBITRUM_USDC } from "./gas-funding";
import { GaslessError } from "./gasless-validation";

export async function readGaslessFunding(
  config: ResolvedConfig,
  owner: Address,
  receiver: Address,
  reserve: bigint,
) {
  const client = publicRpc(arbitrum, config.arbitrumRpcUrl);
  if ((await client.getChainId()) !== arbitrum.id)
    throw new GaslessError("balanceError");
  const [eth, usdc] = await Promise.all([
    client.getBalance({ address: owner }),
    client.readContract({
      address: ARBITRUM_USDC,
      abi: IERC20ABI,
      functionName: "balanceOf",
      args: [owner],
    }),
  ]);
  if (usdc < reserve) throw new GaslessError("reserveInsufficient");
  const [gas, fees] = await Promise.all([
    client.estimateContractGas({
      address: ARBITRUM_USDC,
      abi: IERC20ABI,
      functionName: "transfer",
      args: [receiver, reserve],
      account: owner,
      stateOverride: [{ address: owner, balance: 10n ** 20n }],
    }),
    client.estimateFeesPerGas(),
  ]);
  if (!fees.maxFeePerGas || gas <= 0n) throw new GaslessError("balanceError");
  const required = (gas * fees.maxFeePerGas * 120n + 99n) / 100n;
  return { eth, usdc, required, sufficient: eth >= required };
}
