import type { Network } from "../types";
import type { Address } from "viem";
import { cctpDeployment } from "../bridge/cctp";
import { invariant } from "../core/errors";
import { same } from "./account";
import { readTradeWithdrawalBalance } from "./trade-withdrawal-balance";
import type { ProtocolPort } from "./port";

export async function readArbitrumTradeBalance(
  port: ProtocolPort,
  account: Address,
  asset: Address,
  network: Network = "mainnet",
) {
  invariant(
    same(asset, cctpDeployment(network).evmUsdc),
    "UNSUPPORTED_ASSET",
    "Unsupported withdrawal asset.",
  );
  return readTradeWithdrawalBalance(port, account);
}

export function arbitrumWithdrawalTopup(
  balance: Awaited<ReturnType<typeof readArbitrumTradeBalance>>,
  amount: bigint,
) {
  invariant(
    amount > 0n && amount <= balance.maximum,
    "WITHDRAW_RESTRICTED",
    "Amount exceeds the current withdrawable balance.",
  );
  const required = amount + balance.interest;
  return required > balance.evm ? required - balance.evm : 0n;
}
