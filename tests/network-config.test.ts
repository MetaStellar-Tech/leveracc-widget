import { describe, expect, it, vi } from "vitest";
import { zeroAddress, zeroHash, type Hex } from "viem";
import { resolveConfig } from "../src/core/config";
import { createAccount } from "../src/protocol/account";
import type { ProtocolPort } from "../src/protocol/port";

const projectId = `0x${"cd".repeat(32)}` as Hex;
const owner = "0x1111111111111111111111111111111111111111";
const deployments = [
  {
    network: "mainnet",
    chain: 999,
    arb: 42161,
    factory: "0x7211c8159449b99f0b7cdb6b7a9ea01b2e5c1ce7",
    manager: "0x03524982bba6763d045d1a44f3c090ffcf39774b",
    core: "0x6b9e773128f453f5c2c60935ee2de2cbc5390a24",
    service: "https://protocol-service.leveracc.xyz",
  },
  {
    network: "testnet",
    chain: 998,
    arb: 421614,
    factory: "0xe672fc21d0e429076b4386d20b5951eba214aedb",
    manager: "0x99d8f178af00b229cbc00676f42f0a492bdef52c",
    core: "0x0b80659a4076e9e93c7dbe0f10675a16a3e5c206",
    service: "https://protocol-service-testnet.leveracc.xyz",
  },
] as const;

describe.each(deployments)(
  "$network integration configuration",
  (deployment) => {
    it("selects the protocol deployment and preserves the host project in creation signatures and calls", async () => {
      const config = resolveConfig({ network: deployment.network, projectId });
      expect(config).toMatchObject({
        factory: deployment.factory,
        manager: deployment.manager,
        coreDepositWallet: deployment.core,
        protocolServiceUrl: deployment.service,
        chain: { id: deployment.chain },
        arbitrumChain: { id: deployment.arb },
      });
      const read = vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "primaryAccountOf" ? zeroAddress : zeroHash,
      );
      const sign = vi.fn(async () => "0x1234" as Hex);
      const write = vi.fn(async () => zeroHash);
      const port = {
        read,
        sign,
        write,
        nativeBalance: async () => 10n ** 18n,
      } as unknown as ProtocolPort;
      await createAccount(port, config, owner);
      expect(
        read.mock.calls.every(
          ([call]) =>
            (call as { address?: string }).address === deployment.factory,
        ),
      ).toBe(true);
      expect(sign).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: expect.objectContaining({
            chainId: deployment.chain,
            verifyingContract: deployment.factory,
          }),
          message: expect.objectContaining({ projectId, user: owner }),
        }),
      );
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({
          address: deployment.factory,
          functionName: "createAccount",
          args: [expect.objectContaining({ projectId, user: owner }), "0x1234"],
        }),
      );
    });
  },
);
