import {
  TransactionReceiptNotFoundError,
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";
import { arbitrum } from "viem/chains";
import type { ResolvedConfig } from "../core/config";
import { invariant } from "../core/errors";
import { IERC20ABI } from "../abi/IERC20";
import { publicRpc } from "./port";
import {
  gasTopUpRequest,
  isCreationTopUp,
  type GasTopUpRecord,
} from "./gas-top-ups";

export interface PendingCreation {
  source: "arbitrum" | "core" | "create";
  hash?: Hex;
  receiver: Address;
  hypeBefore: string;
  createdAt: number;
}
export function creationKey(
  config: ResolvedConfig,
  owner: Address,
  kind = "funding",
) {
  return `leveracc:creation:v2:${kind}:${config.network}:${encodeURIComponent(config.protocolServiceUrl)}:${owner.toLowerCase()}:${kind === "create" ? config.projectId : ""}`;
}
const submittedMemory = new Map<string, PendingCreation>();

// Persist intent before broadcast: unknown outcomes must not enable another payment.
export function saveCreation(
  key: string,
  value: PendingCreation,
  submitted = false,
) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    submittedMemory.delete(key);
  } catch (error) {
    // A returned hash is still a submission if storage becomes unavailable.
    if (!submitted) throw error;
    submittedMemory.set(key, value);
  }
}
export function loadCreation(key: string): PendingCreation | undefined {
  if (submittedMemory.has(key)) return submittedMemory.get(key);
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return;
  }
  if (!raw) return;
  const value = JSON.parse(raw) as PendingCreation;
  invariant(
    ["arbitrum", "core", "create"].includes(value.source) &&
      /^0x[\da-f]{40}$/i.test(value.receiver) &&
      /^\d+$/.test(value.hypeBefore) &&
      Number.isFinite(value.createdAt) &&
      (!value.hash || /^0x[\da-f]{64}$/i.test(value.hash)),
    "INVALID_PENDING_CREATION",
    "Unable to read the pending creation transaction.",
  );
  return value;
}
export function clearCreation(key: string) {
  localStorage.removeItem(key);
  submittedMemory.delete(key);
}
export async function fundingStatus(
  config: ResolvedConfig,
  owner: Address,
  gas: bigint,
  records: GasTopUpRecord[],
): Promise<{ state: string; error: string | undefined; pollAfter: number }> {
  const key = creationKey(config, owner);
  const pending = loadCreation(key);
  const idle = {
    state: "idle",
    error: undefined as string | undefined,
    pollAfter: 5000,
  };
  if (!pending) return idle;
  const waiting = { ...idle, state: "pending" };
  let record: GasTopUpRecord | undefined;
  if (pending.source === "arbitrum") {
    if (!pending.hash) {
      const candidates = records.filter(
        (r) =>
          r.source_chain_id === 42161 &&
          r.requested_usdc_amount_raw === "3000000" &&
          r.created_at &&
          Date.parse(r.created_at) >= pending.createdAt &&
          r.source_tx_hash,
      );
      if (candidates.length !== 1)
        return {
          ...waiting,
          error:
            "Transfer submission is unconfirmed. Checking payment history; do not send again.",
        };
      saveCreation(key, {
        ...pending,
        hash: candidates[0].source_tx_hash as Hex,
      });
      return fundingStatus(config, owner, gas, records);
    }
    let receipt;
    try {
      receipt = await publicRpc(
        arbitrum,
        config.arbitrumRpcUrl,
      ).getTransactionReceipt({ hash: pending.hash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return waiting;
      throw error;
    }
    if (receipt.status !== "success") {
      clearCreation(key);
      return {
        ...idle,
        error: "USDC transfer reverted. You can retry funding.",
      };
    }
    invariant(
      receipt.logs.some((log) => {
        if (
          log.address.toLowerCase() !==
          "0xaf88d065e77c8cc2239327c5edb3a432268e5831"
        )
          return false;
        try {
          const event = decodeEventLog({
            abi: IERC20ABI,
            eventName: "Transfer",
            data: log.data,
            topics: log.topics,
          });
          return (
            event.args.from.toLowerCase() === owner.toLowerCase() &&
            event.args.to.toLowerCase() === pending.receiver.toLowerCase() &&
            event.args.value === 3000000n
          );
        } catch {
          return false;
        }
      }),
      "FUNDING_MISMATCH",
      "Gas funding transfer does not match this wallet, receiver and amount.",
    );
    record = records.find(
      (r) =>
        r.source_chain_id === 42161 &&
        r.source_tx_hash?.toLowerCase() === pending.hash!.toLowerCase(),
    );
  } else {
    record = records.find(
      (r) =>
        r.requested_usdc_amount_raw === "3000000" &&
        r.created_at &&
        Date.parse(r.created_at) >= pending.createdAt &&
        r.system_core_account_address?.toLowerCase() ===
          pending.receiver.toLowerCase(),
    );
  }
  if (!record) return waiting;
  if (record.id) {
    const latest = (await gasTopUpRequest(
      config.protocolServiceUrl,
      `/${encodeURIComponent(record.id)}`,
    )) as GasTopUpRecord;
    invariant(
      latest.id === record.id &&
        (pending.source !== "arbitrum" ||
          (latest.source_chain_id === 42161 &&
            latest.source_tx_hash?.toLowerCase() ===
              pending.hash?.toLowerCase())),
      "FUNDING_MISMATCH",
      "Gas funding status does not match the submitted transfer.",
    );
    record = latest;
  }
  const pollAfter = Math.max(1, record.next_poll_after_seconds || 5) * 1000;
  if (record.terminal && record.phase !== "success")
    return {
      state: "failed",
      error:
        record.status_message ||
        "Gas funding failed. Contact support before sending again.",
      pollAfter,
    };
  if (isCreationTopUp(record) && record.evm_tx_hash) {
    let receipt;
    try {
      receipt = await publicRpc(
        config.chain,
        config.rpcUrl,
      ).getTransactionReceipt({ hash: record.evm_tx_hash as Hex });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError)
        return { ...waiting, pollAfter };
      throw error;
    }
    if (
      receipt.status === "success" &&
      receipt.to?.toLowerCase() === owner.toLowerCase() &&
      gas > BigInt(pending.hypeBefore)
    ) {
      clearCreation(key);
      return idle;
    }
  }
  return { ...waiting, pollAfter };
}

export async function confirmCreation(
  config: ResolvedConfig,
  owner: Address,
  port: import("./port").ProtocolPort,
) {
  const key = creationKey(config, owner, "create"),
    pending = loadCreation(key);
  if (!pending) return true;
  const { primary, accountCall, same } = await import("./account");
  if (pending.hash) {
    let receipt;
    try {
      receipt = await publicRpc(
        config.chain,
        config.rpcUrl,
      ).getTransactionReceipt({ hash: pending.hash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return false;
      throw error;
    }
    if (receipt.status !== "success") {
      clearCreation(key);
      throw new Error("Account creation transaction reverted. Please retry.");
    }
  }
  const account = await primary(port, config, owner);
  if (account === "0x0000000000000000000000000000000000000000") return false;
  const [user, factory, projectId, epoch] = await Promise.all([
    port.read<Address>(accountCall(account, "user")),
    port.read<Address>(accountCall(account, "factory")),
    port.read<Hex>(accountCall(account, "projectId")),
    port.read<bigint>(accountCall(account, "projectBindingEpoch")),
  ]);
  invariant(
    same(user, owner) &&
      same(factory, config.factory) &&
      same(projectId, config.projectId) &&
      epoch >= 1n,
    "ACCOUNT_MISMATCH",
    "Created account owner, factory, project or binding epoch does not match.",
  );
  clearCreation(key);
  return true;
}
