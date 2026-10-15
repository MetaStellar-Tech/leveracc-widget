import { hashTypedData } from "viem";
import type { GaslessQuote, GaslessPayload } from "../src/protocol/gasless-api";
import { ARBITRUM_USDC as ARBITRUM_NATIVE_USDC } from "../src/protocol/gas-funding";
import { NATIVE_ETH } from "../src/protocol/gasless-validation";
export const owner = "0x1111111111111111111111111111111111111111";
export const receiver = "0x2222222222222222222222222222222222222222";
export const gasConfig = {
  enabled: true,
  system_core_account_address: receiver,
  min_usdc_amount_raw: "100000",
  max_usdc_amount_raw: "10000000",
  quote_hype_haircut_bps: 9000,
  hype_price_usdc_e6: "0",
  arbitrum: {
    enabled: true,
    chain_id: 42161,
    usdc_address: ARBITRUM_NATIVE_USDC,
    receiver_address: receiver,
    confirmations: 1,
    min_usdc_amount_raw: "100000",
    max_usdc_amount_raw: "10000000",
    daily_eoa_limit_raw: "10000000",
  },
  gasless: {
    enabled: true,
    source_chain_id: 42161,
    min_sell_amount_raw: "200000",
    max_sell_amount_raw: "2000000",
  },
};
export function quoteFixture(amount = "200000", output = "1000"): GaslessQuote {
  const trade: GaslessPayload = {
    type: "settler_metatransaction",
    eip712: {
      domain: { name: "Settler", chainId: 42161, verifyingContract: receiver },
      types: {
        Trade: [
          { name: "permitted", type: "Permissions" },
          { name: "slippageAndActions", type: "Slippage" },
          { name: "nonce", type: "uint256" },
        ],
        Permissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        Slippage: [
          { name: "recipient", type: "address" },
          { name: "buyToken", type: "address" },
          { name: "minAmountOut", type: "uint256" },
        ],
      },
      primaryType: "Trade",
      message: {
        permitted: { token: ARBITRUM_NATIVE_USDC, amount },
        slippageAndActions: {
          recipient: owner,
          buyToken: NATIVE_ETH,
          minAmountOut: output,
        },
        nonce: "9007199254740993000",
      },
    },
  };
  return {
    provider: "0x",
    source_chain_id: 42161,
    user_eoa: owner,
    sell_token: ARBITRUM_NATIVE_USDC,
    sell_amount_raw: amount,
    buy_token: NATIVE_ETH,
    buy_amount_raw: (BigInt(output) + 100n).toString(),
    min_buy_amount_raw: output,
    liquidity_available: true,
    expires_at: new Date(Date.now() + 30000).toISOString(),
    next_poll_after_seconds: 3,
    trade_hash: hashTypedData(trade.eip712),
    quote_token: "private-capability",
    zeroex_quote: { trade },
  };
}
