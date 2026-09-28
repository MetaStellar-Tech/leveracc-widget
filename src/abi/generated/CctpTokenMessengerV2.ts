import type { Abi } from "viem";

export const CctpTokenMessengerV2ABI = [
  {
    "name": "depositForBurnWithHook",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "type": "uint256",
        "name": "amount"
      },
      {
        "type": "uint32",
        "name": "destinationDomain"
      },
      {
        "type": "bytes32",
        "name": "mintRecipient"
      },
      {
        "type": "address",
        "name": "burnToken"
      },
      {
        "type": "bytes32",
        "name": "destinationCaller"
      },
      {
        "type": "uint256",
        "name": "maxFee"
      },
      {
        "type": "uint32",
        "name": "minFinalityThreshold"
      },
      {
        "type": "bytes",
        "name": "hookData"
      }
    ],
    "outputs": []
  }
] as const satisfies Abi;
