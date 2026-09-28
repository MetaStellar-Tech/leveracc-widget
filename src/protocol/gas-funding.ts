import { isAddress, zeroAddress, type Address, type Hex } from "viem";
import { arbitrum } from "viem/chains";
import { z } from "zod";
import type { ResolvedConfig } from "../core/config";
import type { WalletProvider } from "../types";
import { invariant, normalizeError } from "../core/errors";
import { signer } from "../core/wallet";
import { IERC20ABI } from "../abi/IERC20";
import { ILeverAccAccountFactoryABI } from "../abi/ILeverAccAccountFactory";
import { publicRpc, type ProtocolPort } from "./port";
import { readOwnerCore } from "./account-transfer";
import { CREATION_GAS_MINIMUM } from "./account";
import { gasTopUpRequest, listGasTopUps, isCreationTopUp } from "./gas-top-ups";

export const GAS_FUNDING_AMOUNT = 3_000_000n;
export const ARBITRUM_USDC: Address =
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const amount = z.string().regex(/^\d+$/);
const address = z
  .string()
  .refine((value) => isAddress(value) && value.toLowerCase() !== zeroAddress);
const limits = z.object({
  min_usdc_amount_raw: amount,
  max_usdc_amount_raw: amount,
});
const configSchema = limits.extend({
  enabled: z.boolean().optional(),
  system_core_account_address: z.string().optional(),
  arbitrum: limits
    .extend({
      enabled: z.boolean(),
      chain_id: z.number(),
      usdc_address: z.string(),
      receiver_address: address,
      confirmations: z.number().int().positive(),
      daily_eoa_limit_raw: amount,
    })
    .optional(),
});
export async function gasFundingRoute(config: ResolvedConfig) {
  const data = configSchema.parse(
    await gasTopUpRequest(config.protocolServiceUrl, "/config"),
  );
  const route = config.network === "mainnet" ? data.arbitrum : data;
  invariant(
    route &&
      (config.network === "mainnet"
        ? data.enabled === true
        : data.enabled !== false),
    "GAS_ROUTE_UNAVAILABLE",
    "The 3 USDC gas funding route is unavailable.",
  );
  invariant(
    BigInt(route.min_usdc_amount_raw) <= GAS_FUNDING_AMOUNT &&
      BigInt(route.max_usdc_amount_raw) >= GAS_FUNDING_AMOUNT,
    "GAS_ROUTE_UNAVAILABLE",
    "This gas funding route does not support 3 USDC.",
  );
  if (config.network === "mainnet") {
    const arb = data.arbitrum!;
    invariant(
      arb.enabled &&
        arb.chain_id === arbitrum.id &&
        arb.usdc_address.toLowerCase() === ARBITRUM_USDC.toLowerCase() &&
        BigInt(arb.daily_eoa_limit_raw) >= GAS_FUNDING_AMOUNT,
      "GAS_ROUTE_UNAVAILABLE",
      "The Arbitrum USDC gas funding route is unavailable.",
    );
    return {
      source: "arbitrum" as const,
      receiver: arb.receiver_address as Address,
    };
  }
  return {
    source: "core" as const,
    receiver: address.parse(data.system_core_account_address) as Address,
  };
}

export async function startGasFunding(
  config: ResolvedConfig,
  provider: WalletProvider,
  owner: Address,
  port: ProtocolPort,
  current: () => boolean,
  corePort: (submitting: () => void) => ProtocolPort,
) {
  const [route, history, hypeBefore] = await Promise.all([
    gasFundingRoute(config),
    listGasTopUps(config.protocolServiceUrl, owner),
    port.nativeBalance(owner),
  ]);
  if (history.some(isCreationTopUp) && hypeBefore >= CREATION_GAS_MINIMUM)
    return;
  let submitting = false;
  const markSubmitting = () => {
    invariant(current(), "CONTEXT_CHANGED", "Wallet context changed.");
    submitting = true;
  };
  try {
    if (route.source === "core") {
      const registry = await port.read<Address>({
        address: config.factory,
        abi: ILeverAccAccountFactoryABI,
        functionName: "registry",
      });
      const balance = await readOwnerCore(port, registry, owner);
      invariant(
        balance.available >= GAS_FUNDING_AMOUNT,
        "INSUFFICIENT_BALANCE",
        "At least 3 USDC is required in HyperCore Spot.",
      );
      // sendCore checks owner and network before signing and again before broadcast.
      await corePort(markSubmitting).sendCore(route.receiver, "3");
      return { source: route.source };
    } else {
      const client = publicRpc(arbitrum, config.arbitrumRpcUrl);
      invariant(
        (await client.getChainId()) === arbitrum.id,
        "RPC_NETWORK_MISMATCH",
        "Arbitrum RPC network mismatch.",
      );
      const request = {
        address: ARBITRUM_USDC,
        abi: IERC20ABI,
        functionName: "transfer" as const,
        args: [route.receiver, GAS_FUNDING_AMOUNT] as const,
        account: owner,
      };
      const balance = await client.readContract({
        ...request,
        functionName: "balanceOf",
        args: [owner],
      });
      invariant(
        balance >= GAS_FUNDING_AMOUNT,
        "INSUFFICIENT_BALANCE",
        "At least 3 USDC is required on Arbitrum.",
      );
      await signer(provider, owner, arbitrum, current);
      const [simulation, gas, price, eth] = await Promise.all([
        client.simulateContract(request),
        client.estimateContractGas(request),
        client.getGasPrice(),
        client.getBalance({ address: owner }),
      ]);
      invariant(
        simulation.result === true,
        "TRANSFER_FAILED",
        "USDC transfer simulation failed.",
      );
      invariant(
        eth >= gas * price * 2n,
        "INSUFFICIENT_GAS",
        "Insufficient ETH for Arbitrum gas.",
      );
      const wallet = await signer(provider, owner, arbitrum, current);
      markSubmitting();
      const hash = await wallet.writeContract({
        ...simulation.request,
        account: owner,
        chain: arbitrum,
        gas: (gas * 120n) / 100n,
      });
      return { source: route.source, hash };
    }
  } catch (error) {
    const normalized = normalizeError(error);
    if (submitting && normalized.code !== "USER_REJECTED") {
      normalized.message +=
        " Submission result is unknown. Check your wallet before retrying.";
      throw normalized;
    }
    throw error;
  }
}
