import { creationFlow, creationAmount } from "./creation-policy";
import {
  paymentRequest,
  paymentList,
  prepareOrder,
  combinedActivationReady,
  listConversions,
} from "./creation-payments";
import {
  creationKey,
  loadCreation,
  saveCreation,
  clearCreation,
} from "./creation-tracking";
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
  account_activation_enabled: z.boolean().optional(),
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
export async function gasFundingRoute(config: ResolvedConfig, owner?: Address) {
  const flow = creationFlow(config);
  if (flow === "activation_only") {
    invariant(owner, "WALLET_NOT_CONNECTED", "Connect a wallet first.");
    const data = z
      .object({
        enabled: z.boolean(),
        status: z.string(),
        payment_usdc_amount_raw: amount,
        activation_receiver_address: address.optional(),
        arbitrum: z
          .object({
            enabled: z.boolean(),
            chain_id: z.number(),
            usdc_address: z.string(),
          })
          .optional(),
      })
      .parse(await paymentRequest(config, flow, `/config?user_eoa=${owner}`));
    invariant(
      data.enabled && data.payment_usdc_amount_raw === "1100000",
      "GAS_ROUTE_UNAVAILABLE",
      "Account activation is unavailable.",
    );
    let receiver = data.activation_receiver_address;
    if (data.status === "activation_pending") {
      const orders = await paymentList(config, flow, owner, "/orders");
      const active = orders
        .map((o) =>
          z
            .object({
              status: z.string(),
              expires_at: z.string(),
              source: z.string(),
              receiver_address: address,
            })
            .parse(o),
        )
        .filter(
          (o) =>
            o.status === "awaiting_payment" &&
            Date.parse(o.expires_at) > Date.now() &&
            o.source === (config.network === "mainnet" ? "arbitrum" : "core"),
        );
      invariant(
        active.length === 1,
        "FUNDING_PENDING",
        "Activation payment is already pending.",
      );
      receiver = active[0].receiver_address;
    } else
      invariant(
        data.status === "ready_to_pay",
        "GAS_ROUTE_UNAVAILABLE",
        "Account is not ready for activation payment.",
      );
    if (config.network === "mainnet")
      invariant(
        data.arbitrum?.enabled &&
          data.arbitrum.chain_id === arbitrum.id &&
          data.arbitrum.usdc_address.toLowerCase() ===
            ARBITRUM_USDC.toLowerCase(),
        "GAS_ROUTE_UNAVAILABLE",
        "Arbitrum activation is unavailable.",
      );
    return {
      source:
        config.network === "mainnet"
          ? ("arbitrum" as const)
          : ("core" as const),
      receiver: address.parse(receiver) as Address,
    };
  }
  const data = configSchema.parse(
    flow === "gas_only"
      ? await paymentRequest(config, flow, "/config")
      : await gasTopUpRequest(config.protocolServiceUrl, "/config"),
  );
  invariant(
    config.creationLegacyMode ||
      flow !== "combined" ||
      data.account_activation_enabled === true,
    "GAS_ROUTE_UNAVAILABLE",
    "Combined account activation funding is unavailable.",
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
  const flow = creationFlow(config);
  if (flow === "none") return;
  const amountRaw = creationAmount(flow);
  const fundingAmount = BigInt(amountRaw);
  const displayAmount = flow === "activation_only" ? "1.1" : "3";
  const key = creationKey(config, owner);
  invariant(
    !loadCreation(key),
    "FUNDING_PENDING",
    "Gas funding is already pending. Do not send again.",
  );
  const [history, hypeBefore] = await Promise.all([
    flow === "activation_only" ||
    (config.skipCreationTopUpCheck &&
      (config.creationLegacyMode || flow === "gas_only"))
      ? []
      : flow === "gas_only"
        ? listConversions(config, owner)
        : listGasTopUps(config.protocolServiceUrl, owner),
    config.creationGasConversionEnabled
      ? port.nativeBalance(owner)
      : Promise.resolve(0n),
  ]);
  if (
    flow !== "activation_only" &&
    (config.skipCreationTopUpCheck || history.some(isCreationTopUp)) &&
    (config.creationLegacyMode ||
      flow !== "combined" ||
      (await combinedActivationReady(config, owner, history))) &&
    hypeBefore >= CREATION_GAS_MINIMUM
  )
    return;
  const route = await gasFundingRoute(config, owner);
  let orderId: string | undefined;
  let orderExpires = Infinity;
  const ensureOrder = async () => {
    if (flow !== "combined") {
      const order = await prepareOrder(
        config,
        provider,
        owner,
        flow,
        route.source,
        route.receiver,
        current,
      );
      orderId = order.id;
      orderExpires = Date.parse(order.expires_at);
    }
    invariant(current(), "CONTEXT_CHANGED", "Wallet context changed.");
  };
  let submitting = false;
  const markSubmitting = () => {
    invariant(
      orderExpires > Date.now() + 30000,
      "ORDER_EXPIRED",
      "Payment order has expired. Retry before sending funds.",
    );
    invariant(current(), "CONTEXT_CHANGED", "Wallet context changed.");
    saveCreation(key, {
      flow,
      amountRaw,
      orderId,
      source: route.source,
      receiver: route.receiver,
      hypeBefore: hypeBefore.toString(),
      createdAt: Date.now(),
    });
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
        balance.available >= fundingAmount,
        "INSUFFICIENT_BALANCE",
        `At least ${displayAmount} USDC is required in HyperCore Spot.`,
      );
      // sendCore checks owner and network before signing and again before broadcast.
      await ensureOrder();
      await corePort(markSubmitting).sendCore(route.receiver, displayAmount);
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
        args: [route.receiver, fundingAmount] as const,
        account: owner,
      };
      const balance = await client.readContract({
        ...request,
        functionName: "balanceOf",
        args: [owner],
      });
      invariant(
        balance >= fundingAmount,
        "INSUFFICIENT_BALANCE",
        `At least ${displayAmount} USDC is required on Arbitrum.`,
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
      await ensureOrder();
      const wallet = await signer(provider, owner, arbitrum, current);
      markSubmitting();
      const hash = await wallet.writeContract({
        ...simulation.request,
        account: owner,
        chain: arbitrum,
        gas: (gas * 120n) / 100n,
      });
      saveCreation(
        key,
        {
          flow,
          amountRaw,
          orderId,
          source: route.source,
          hash,
          receiver: route.receiver,
          hypeBefore: hypeBefore.toString(),
          createdAt: Date.now(),
        },
        true,
      );
      return { source: route.source, hash };
    }
  } catch (error) {
    const normalized = normalizeError(error);
    if (submitting && normalized.code === "USER_REJECTED") clearCreation(key);
    if (submitting && normalized.code !== "USER_REJECTED") {
      normalized.message +=
        " Submission result is unknown. Check your wallet before retrying.";
      throw normalized;
    }
    throw error;
  }
}
