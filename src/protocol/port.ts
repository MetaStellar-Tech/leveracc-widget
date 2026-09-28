import {
  createPublicClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type TypedDataDefinition,
  type TypedData,
  type TypedDataDomain,
  type Chain,
  type PublicClient,
} from "viem";
import type { ResolvedConfig } from "../core/config";
import type { WalletProvider, Stage } from "../types";
import { ExchangeClient, InfoClient, HttpTransport } from "@nktkas/hyperliquid";
import { signer } from "../core/wallet";
import { coreAmount } from "../core/amount";
import { invariant } from "../core/errors";
export type ContractCall = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
};
export interface ProtocolPort {
  coreSpotBalance(address: Address): Promise<bigint>;
  read<T>(call: ContractCall): Promise<T>;
  sign(data: {
    domain: TypedDataDomain;
    types: TypedData;
    primaryType: string;
    message: object;
  }): Promise<Hex>;
  write(call: ContractCall): Promise<Hex>;
  nativeBalance(address: Address): Promise<bigint>;
  sendCore(destination: Address, amount: string): Promise<void>;
}
export function createPort(
  config: ResolvedConfig,
  provider: WalletProvider,
  owner: Address,
  current: () => boolean,
  progress: (stage: Stage, hash?: Hex) => void,
  guard: () => Promise<void>,
): ProtocolPort {
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
  let verified: Promise<void> | undefined;
  const verifyRpc = () =>
    (verified ??= publicClient.getChainId().then((chainId) => {
      invariant(
        chainId === config.chain.id,
        "RPC_NETWORK_MISMATCH",
        "RPC endpoint does not match the configured network.",
      );
    }));
  return {
    coreSpotBalance: async (address) => {
      const client = new InfoClient({
        transport: new HttpTransport({
          isTestnet: config.network === "testnet",
        }),
      });
      const state = await client.spotClearinghouseState({ user: address });
      invariant(
        Array.isArray(state?.balances),
        "INVALID_BALANCE",
        "Core balances are unavailable.",
      );
      const usdc = state.balances.find((balance) => balance.coin === "USDC");
      const available =
        coreAmount(usdc?.total ?? "0") - coreAmount(usdc?.hold ?? "0");
      return available > 0n ? available : 0n;
    },
    sendCore: async (destination, amount) => {
      await guard();
      const wallet = await signer(provider, owner, config.chain, current);
      const client = new ExchangeClient({
        transport: new HttpTransport({
          isTestnet: config.network === "testnet",
        }),
        wallet: {
          ...wallet,
          signTypedData: async (
            args: Parameters<typeof wallet.signTypedData>[0],
          ) => {
            await guard();
            const signature = await wallet.signTypedData(args);
            // SDK sends to Core after signing; recheck context before it can broadcast.
            await guard();
            await signer(provider, owner, config.chain, current);
            progress("submitting");
            return signature;
          },
        },
      });
      // Signing is safe to retry; mark ambiguous submission only after signing.
      progress("signing");
      await client.sendAsset({
        token:
          config.network === "testnet"
            ? "USDC:0xeb62eee3685fc4c43992febcd9e75443"
            : "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
        amount,
        destination: destination.toLowerCase(),
        sourceDex: "spot",
        destinationDex: "spot",
      });
      progress("submitted");
    },
    read: async <T>(call: ContractCall) =>
      (await verifyRpc(), await publicClient.readContract(call)) as T,
    nativeBalance: async (address) => {
      await verifyRpc();
      return publicClient.getBalance({ address });
    },
    sign: async (data) => {
      await guard();
      const wallet = await signer(provider, owner, config.chain, current);
      progress("signing");
      return wallet.signTypedData(data as TypedDataDefinition);
    },
    write: async (call) => {
      await verifyRpc();
      await guard();
      let wallet = await signer(provider, owner, config.chain, current);
      const simulation = await publicClient.simulateContract({
        ...call,
        account: owner,
      });
      await guard();
      wallet = await signer(provider, owner, config.chain, current);
      progress("submitting");
      const hash = await wallet.writeContract({
        ...simulation.request,
        account: owner,
        chain: config.chain,
      });
      progress("submitted", hash);
      return hash;
    },
  };
}
export function publicRpc(chain: Chain, rpc: string): PublicClient {
  return createPublicClient({ chain, transport: http(rpc) });
}
