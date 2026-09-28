import type { Address, Hex } from "viem";
import type { ResolvedConfig } from "../core/config";
import type { WalletProvider, Stage } from "../types";
import { signer } from "../core/wallet";
import { invariant } from "../core/errors";
import {
  cctpDeployment,
  depositArgs,
  quoteFee,
  type CctpOperation,
} from "./cctp";
import { circleJson } from "./cctp-api";
import { bridgeClients } from "./client";
import { CctpTokenMessengerV2ABI } from "../abi/generated/CctpTokenMessengerV2";
import { CctpUsdcABI } from "../abi/generated/CctpUsdc";
import { WithdrawToArbitrumIntentTypes } from "../abi/generated/WithdrawalTypes";
import { createIntentExpiry } from "../protocol/account-factory-intent";
import type { ProtocolPort } from "../protocol/port";
import {
  readArbitrumTradeBalance,
  arbitrumWithdrawalTopup,
} from "../protocol/arbitrum-balance";
import { accountCall, type AccountState } from "../protocol/account";
export async function submitDeposit(
  config: ResolvedConfig,
  provider: WalletProvider,
  owner: Address,
  units: bigint,
  fee: bigint,
  approveOnly: boolean,
  current: () => boolean,
  progress: (stage: Stage, hash?: Hex, bridge?: CctpOperation) => void,
  freshFee?: () => Promise<bigint>,
) {
  const deployment = cctpDeployment(config.network);
  const clients = bridgeClients(config);
  const fresh = await clients.balances(owner);
  const estimate = freshFee
    ? await freshFee()
    : quoteFee(
        await circleJson(undefined, "fund", config.network),
        units,
        "fund",
      );
  invariant(
    estimate <= fee,
    "FEE_CHANGED",
    "Bridge fee increased. Get a new quote and confirm again.",
  );
  invariant(
    units > fee && fresh.balance >= units,
    "INSUFFICIENT_BALANCE",
    "Insufficient Arbitrum USDC balance.",
  );
  const wallet = await signer(provider, owner, config.arbitrumChain, current);
  const transferAbi = [...CctpUsdcABI, ...CctpTokenMessengerV2ABI] as const;
  const request = approveOnly
    ? {
        address: deployment.usdc,
        abi: transferAbi,
        functionName: "approve" as const,
        args: [deployment.messenger, units] as const,
        account: owner,
      }
    : {
        address: deployment.messenger,
        abi: transferAbi,
        functionName: "depositForBurnWithHook" as const,
        args: depositArgs(units, fee, owner, "fund", config.network),
        account: owner,
      };
  invariant(
    approveOnly || fresh.allowance >= units,
    "APPROVAL_REQUIRED",
    "Approve USDC, then confirm the bridge transfer.",
  );
  const gas =
    request.functionName === "approve"
      ? await clients.arb.estimateContractGas(request)
      : await clients.arb.estimateContractGas(request);
  const price = await clients.arb.getGasPrice();
  invariant(
    fresh.gas >= gas * price * 2n,
    "INSUFFICIENT_GAS",
    "Insufficient ETH for Arbitrum gas.",
  );
  if (request.functionName === "approve")
    await clients.arb.simulateContract(request);
  else await clients.arb.simulateContract(request);
  await signer(provider, owner, config.arbitrumChain, current);
  progress("submitting");
  const hash =
    request.functionName === "approve"
      ? await wallet.writeContract({
          ...request,
          chain: config.arbitrumChain,
          gas: (gas * 120n) / 100n,
        })
      : await wallet.writeContract({
          ...request,
          chain: config.arbitrumChain,
          gas: (gas * 120n) / 100n,
        });
  const bridge: CctpOperation | undefined = approveOnly
    ? undefined
    : {
        route: "fund",
        network: config.network,
        owner,
        recipient: owner,
        hash,
        amount: units.toString(),
        maxFee: fee.toString(),
        baseline: "0",
        createdAt: Date.now(),
      };
  progress("submitted", hash, bridge);
  return bridge;
}
export async function withdrawArbitrum(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  s: AccountState,
  units: bigint,
  fee: bigint,
  onPrepared: (bridge: Omit<CctpOperation, "hash">) => void,
  freshFee?: () => Promise<bigint>,
) {
  invariant(
    config.arbitrumWithdrawalEnabled,
    "UNSUPPORTED_ROUTE",
    "Direct Arbitrum withdrawal is not enabled for this deployment.",
  );
  const balance = await readArbitrumTradeBalance(
    port,
    s.account,
    s.asset,
    config.network,
  );
  invariant(
    arbitrumWithdrawalTopup(balance, units) === 0n,
    "EVM_BALANCE_REQUIRED",
    "Move funds to Trade EVM before withdrawing.",
  );
  const plan = await port.read<{ netPayoutAmount: bigint }>(
    accountCall(s.account, "previewWithdrawPlanPrimaryDirect", [0, units]),
  );
  invariant(
    plan.netPayoutAmount === units,
    "WITHDRAW_RESTRICTED",
    "Withdrawal plan changed. Review the amount.",
  );
  invariant(
    (freshFee
      ? await freshFee()
      : quoteFee(
          await circleJson(undefined, "arbitrum", config.network),
          units,
          "arbitrum",
        )) <= fee,
    "FEE_CHANGED",
    "Bridge fee increased. Get a new quote.",
  );
  invariant(
    fee >= 0n && units > fee,
    "INVALID_AMOUNT",
    "Amount must exceed bridge fees.",
  );
  const intent = {
    projectId: s.projectId,
    account: s.account,
    user: owner,
    requestedAmount: units,
    minReceivedAmount: units - fee,
    maxBridgeFee: fee,
    arbitrumRecipient: owner,
    destinationChainId: BigInt(config.arbitrumChain.id),
    nonce: s.nonce + 1n,
    expiry: createIntentExpiry(),
  };
  const signature = await port.sign({
    domain: {
      name: "LeverAccProtocol",
      version: "1",
      chainId: config.chain.id,
      verifyingContract: s.account,
    },
    types: WithdrawToArbitrumIntentTypes,
    primaryType: "WithdrawToArbitrumIntent",
    message: intent,
  });
  onPrepared({
    route: "arbitrum",
    network: config.network,
    owner,
    recipient: owner,
    sourceAccount: s.account,
    amount: units.toString(),
    maxFee: fee.toString(),
    baseline: "0",
    createdAt: Date.now(),
  });
  await port.write(
    accountCall(s.account, "withdrawToArbitrum", [intent, signature]),
  );
}

/** Owner Fund -> Arbitrum uses Circle directly, without an LA withdrawal intent. */
export async function withdrawFundArbitrum(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  units: bigint,
  fee: bigint,
  onPrepared: (bridge: Omit<CctpOperation, "hash">) => void,
  onApproval: () => void = () => {},
  freshFee?: () => Promise<bigint>,
) {
  const deployment = cctpDeployment(config.network);
  const [balance, allowance] = await Promise.all([
    port.read<bigint>({
      address: deployment.evmUsdc,
      abi: CctpUsdcABI,
      functionName: "balanceOf",
      args: [owner],
    }),
    port.read<bigint>({
      address: deployment.evmUsdc,
      abi: CctpUsdcABI,
      functionName: "allowance",
      args: [owner, deployment.messenger],
    }),
  ]);
  invariant(
    units > fee && fee >= 0n && balance >= units,
    "INSUFFICIENT_BALANCE",
    "Amount must exceed fees and fit your Fund USDC balance.",
  );
  invariant(
    (freshFee
      ? await freshFee()
      : quoteFee(
          await circleJson(undefined, "arbitrum", config.network),
          units,
          "arbitrum",
        )) <= fee,
    "FEE_CHANGED",
    "Bridge fee increased. Get a new quote and confirm again.",
  );
  if (allowance < units) {
    onApproval();
    await port.write({
      address: deployment.evmUsdc,
      abi: CctpUsdcABI,
      functionName: "approve",
      args: [deployment.messenger, units],
    });
    return;
  }
  onPrepared({
    route: "arbitrum",
    network: config.network,
    owner,
    recipient: owner,
    amount: units.toString(),
    maxFee: fee.toString(),
    baseline: "0",
    createdAt: Date.now(),
  });
  await port.write({
    address: deployment.messenger,
    abi: CctpTokenMessengerV2ABI,
    functionName: "depositForBurnWithHook",
    args: depositArgs(units, fee, owner, "arbitrum", config.network),
  });
}
