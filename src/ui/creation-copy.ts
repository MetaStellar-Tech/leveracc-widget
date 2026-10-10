import type { ResolvedConfig } from "../core/config";
import { creationFlow } from "../protocol/creation-policy";
import type { en } from "./strings";

export function creationCopy(config: ResolvedConfig, t: typeof en): typeof en {
  const flow = creationFlow(config);
  const zh = config.locale === "zh";
  if (flow === "activation_only")
    return {
      ...t,
      gasStep: zh ? "准备账户激活" : "Prepare account activation",
      gasReady: zh
        ? "激活付款已确认，可以创建账户。"
        : "Activation funding confirmed. You can create your account.",
      gasRequired: zh
        ? "完成激活付款后即可创建账户。"
        : "Complete activation funding before creating your account.",
      topUpGas: zh ? "支付激活费用" : "Fund account activation",
      gasFundingDescription: zh
        ? "在 {source} 支付 {amount} USDC，准备账户激活。"
        : "Pay {amount} USDC on {source} to prepare account activation.",
      gasFundingSign: zh
        ? "签名并支付 {amount} USDC 激活费用"
        : "Sign & Pay {amount} USDC for Activation",
      gasFundingInfo: zh
        ? "先签署付款订单，再确认转账。付款确认后可创建账户，服务随后完成激活；此付款不兑换 HYPE。"
        : "Sign the payment order, then confirm the transfer. Once payment is confirmed, create your account and the service will activate it. This payment does not convert HYPE.",
      gasFundingSigning: zh
        ? "请在钱包确认激活订单及 {source} USDC 转账…"
        : "Confirm the activation order and {source} USDC transfer in your wallet…",
      gasFundingPending: zh
        ? "正在等待激活付款确认，请勿重复转账。"
        : "Waiting for activation payment confirmation. Do not send again.",
    };
  if (flow === "gas_only")
    return {
      ...t,
      gasFundingInfo: zh
        ? "先签署付款订单，再确认转账。{amount} USDC 用于兑换 HYPE，不支付账户激活费用。"
        : "Sign the payment order, then confirm the transfer. {amount} USDC converts to HYPE without funding account activation.",
      gasFundingSigning: zh
        ? "请在钱包确认兑换订单及 {source} USDC 转账…"
        : "Confirm the conversion order and {source} USDC transfer in your wallet…",
    };
  if (!config.creationLegacyMode)
    return {
      ...t,
      gasStep: zh
        ? "准备 Gas 与账户激活"
        : "Prepare Gas and account activation",
      gasFundingInfo: zh
        ? "一次转账用于兑换 HYPE，并在需要时预留账户激活费用。"
        : "One transfer converts HYPE and reserves account activation funding when needed.",
    };
  return t;
}
