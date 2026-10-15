import { gasFundingKey } from "./gas-funding-store";
import type { Address } from "viem";
import type { ResolvedConfig } from "../core/config";
import {
  GaslessError,
  readGaslessOperation,
  type GaslessOperation,
} from "./gasless-validation";
export const gaslessKey = (config: ResolvedConfig, owner: Address) =>
  `leveracc:widget:gasless:${config.network}:42161:${encodeURIComponent(config.protocolServiceUrl)}:${owner.toLowerCase()}`;
// A successful submit can rotate both hash and capability. Retain that exact
// pair if durable storage fails, and restore it before allowing more work.
const acknowledged = new Map<string, GaslessOperation>();
export function loadGasless(config: ResolvedConfig, owner: Address) {
  const key = gaslessKey(config, owner);
  const recovery = acknowledged.get(key);
  if (recovery) {
    try {
      localStorage.setItem(key, JSON.stringify(recovery));
      acknowledged.delete(key);
    } catch {
      throw new GaslessError("recoveryStorageError");
    }
  }
  try {
    return readGaslessOperation(
      localStorage.getItem(gaslessKey(config, owner)),
      owner,
      config.chain.id,
    );
  } catch {
    throw new GaslessError("storageError");
  }
}
export function saveGasless(
  config: ResolvedConfig,
  owner: Address,
  value: GaslessOperation | null,
  submitAcknowledged = false,
) {
  try {
    const key = gaslessKey(config, owner);
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    if (submitAcknowledged && value) {
      acknowledged.set(gaslessKey(config, owner), value);
      throw new GaslessError("recoveryStorageError");
    }
    throw new GaslessError("storageError");
  }
}
export function probeGaslessStorage(config: ResolvedConfig, owner: Address) {
  try {
    const key = `${gaslessKey(config, owner)}:probe`;
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
  } catch {
    throw new GaslessError("storageError");
  }
}
export async function withGaslessLock<T>(
  config: ResolvedConfig,
  owner: Address,
  work: () => Promise<T>,
) {
  if (!navigator.locks) throw new GaslessError("lockUnavailable");
  // The wallet-wide lock also excludes concurrent creation funding in this widget.
  return navigator.locks.request(
    gasFundingKey(config, owner),
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw new GaslessError("inProgress");
      return work();
    },
  );
}

// A late status response must not overwrite a retry started in another tab.
export async function reconcileGasless(
  config: ResolvedConfig,
  owner: Address,
  previous: GaslessOperation,
  stage: "success" | "failed",
) {
  return withGaslessLock(config, owner, async () => {
    const latest = loadGasless(config, owner);
    if (
      !latest ||
      latest.stage !== "submitted" ||
      latest.trade_hash !== previous.trade_hash ||
      latest.quote_token !== previous.quote_token ||
      latest.createdAt !== previous.createdAt
    )
      return false;
    saveGasless(config, owner, { ...latest, stage });
    return true;
  });
}
