import type { Abi } from "viem";

export const CctpMessageTransmitterV2ABI = [
  {
    "type": "event",
    "name": "MessageSent",
    "anonymous": false,
    "inputs": [
      {
        "name": "message",
        "type": "bytes",
        "indexed": false
      }
    ]
  },
  {
    "type": "event",
    "name": "MessageReceived",
    "anonymous": false,
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true
      },
      {
        "name": "sourceDomain",
        "type": "uint32",
        "indexed": false
      },
      {
        "name": "nonce",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "sender",
        "type": "bytes32",
        "indexed": false
      },
      {
        "name": "finalityThresholdExecuted",
        "type": "uint32",
        "indexed": true
      },
      {
        "name": "messageBody",
        "type": "bytes",
        "indexed": false
      }
    ]
  }
] as const satisfies Abi;
