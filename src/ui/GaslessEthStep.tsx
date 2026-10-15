import { useEffect, useRef, useState } from "react";
import type { WidgetController } from "../core/controller";
import { creationAmount, creationFlow } from "../protocol/creation-policy";
import { Icon } from "./Icons";
import { formatUnits, parseUnits } from "viem";
import { gaslessError, type GaslessReadiness } from "../protocol/gasless";

const errors: Record<string, [string, string]> = {
  unavailable: [
    "Gasless exchange is unavailable. You can continue after funding enough Arbitrum ETH.",
    "Gasless 兑换暂不可用，补充足够的 Arbitrum ETH 后即可继续。",
  ],
  amountInvalid: [
    "The configured amount is outside the gasless service limits.",
    "配置的兑换金额超出 Gasless 服务限额。",
  ],
  reserveInsufficient: [
    "Insufficient USDC for this step. Keep the creation payment available in addition to the exchange amount.",
    "USDC 余额不足。除兑换金额外，还需保留后续创建付款所需的 USDC。",
  ],
  balanceError: [
    "Unable to check Arbitrum balances or gas. We will retry automatically.",
    "无法检查 Arbitrum 余额或 Gas，将自动重试。",
  ],
  requestFailed: [
    "Unable to complete the request. We will check its status automatically before retrying.",
    "请求未完成，将自动检查状态后再重试。",
  ],
  serviceError: [
    "The service is temporarily unavailable. We will check again shortly.",
    "服务暂不可用，将稍后自动检查。",
  ],
  statusUnavailable: [
    "The service cannot verify this exchange. Its status credential may have expired. Keep the pending record, verify the transaction with support, and do not exchange again.",
    "服务无法核实此兑换，状态查询凭证可能已过期。请保留待处理记录并联系支持核实交易，勿重复兑换。",
  ],
  recoveryStorageError: [
    "The exchange was accepted, but its recovery details could not be saved. Keep this page open, restore browser storage, and wait for the automatic status check before reloading or closing the page.",
    "兑换已受理，但新的恢复信息未能保存。请保持当前页面打开，恢复浏览器存储并等待自动状态检查后，再重新加载或关闭页面。",
  ],
  signatureRejected: [
    "Signature declined. You can try again.",
    "已取消签名，可重新尝试。",
  ],
  ownerMismatch: [
    "Wallet or configuration changed. Balances will be checked again automatically.",
    "钱包或配置已更改，将自动重新检查余额。",
  ],
  quoteInvalid: [
    "The quote could not be verified. No exchange was submitted.",
    "报价校验失败，尚未提交兑换。",
  ],
  quoteExpired: [
    "The quote expired. Try again for a fresh quote.",
    "报价已过期，请重试获取新报价。",
  ],
  outputInsufficient: [
    "The quoted ETH is insufficient for gas. Add ETH or ask the integrator to adjust the exchange amount.",
    "报价中的 ETH 不足以支付 Gas，请补充 ETH 或联系集成方调整兑换金额。",
  ],
  storageError: [
    "Recovery storage is unavailable. Enable browser storage before continuing.",
    "无法保存或读取恢复记录，请启用浏览器存储后继续。",
  ],
  lockUnavailable: [
    "This browser cannot safely coordinate the exchange. Use a browser with Web Locks support or add ETH manually.",
    "当前浏览器不支持兑换所需的 Web Locks，请更换浏览器或手动补充 ETH。",
  ],
  inProgress: [
    "Another operation is in progress for this wallet. We will check again automatically.",
    "该钱包有其他操作正在进行，将自动检查。",
  ],
  unknown: [
    "The exchange status is uncertain. Do not submit another exchange. If it remains unresolved, contact support.",
    "兑换状态尚未确定，勿重复兑换。如持续未确认，请联系支持。",
  ],
  failed: ["The exchange failed. You can retry.", "兑换失败，可以重试。"],
  stillLow: [
    "ETH arrived but is still insufficient for gas. Add ETH or exchange again.",
    "ETH 已到账，但仍不足以支付 Gas，请补充 ETH 或再次兑换。",
  ],
};
export function GaslessEthStep({
  controller: c,
  state,
  busy,
  onRefresh,
}: {
  controller: WidgetController;
  state: GaslessReadiness;
  busy: boolean;
  onRefresh: () => Promise<void>;
}) {
  const zh = c.config.locale === "zh";
  const context = `${c.getSnapshot().owner}:${c.config.network}:${c.config.protocolServiceUrl}:${c.config.arbitrumRpcUrl}:${c.config.creationGaslessEthAmountUsdc}:${creationFlow(c.config)}`;
  const active = useRef(context);
  active.current = context;
  useEffect(() => {
    active.current = context;
    return () => {
      if (active.current === context) active.current = "";
    };
  }, [context]);
  const [error, setError] = useState<string>();
  const [quoteOutput, setQuoteOutput] = useState<string>();
  const previousState = useRef(state);
  useEffect(() => {
    const previous = previousState.current;
    previousState.current = state;
    if (
      previous !== state &&
      !busy &&
      ((previous.pending && !state.pending) ||
        state.error === "failed" ||
        (error === "recoveryStorageError" &&
          state.error !== "recoveryStorageError"))
    )
      setError(undefined);
  }, [state, busy, error]);
  useEffect(() => {
    setError(undefined);
    setQuoteOutput(undefined);
  }, [context]);
  const amount = c.config.creationGaslessEthAmountUsdc;
  const reserve = formatUnits(
    BigInt(creationAmount(creationFlow(c.config))),
    6,
  );
  const total = formatUnits(parseUnits(amount, 6) + parseUnits(reserve, 6), 6);
  const activationOnly = creationFlow(c.config) === "activation_only";
  const start = async () => {
    setError(undefined);
    setQuoteOutput(undefined);
    try {
      await c.exchangeCreationEth(
        () => active.current === context,
        (minimum) => {
          if (active.current === context)
            setQuoteOutput(formatUnits(BigInt(minimum), 18));
        },
      );
    } catch (e) {
      if (active.current === context) setError(gaslessError(e));
    } finally {
      if (active.current === context) await onRefresh();
    }
  };
  const issue =
    state.autoPoll === false ? (state.error ?? error) : (error ?? state.error);
  return (
    <div className="creation-gas gasless-eth-step">
      <p>
        {zh
          ? `使用 Arbitrum 上的 ${amount} USDC 兑换 ETH 作为转账费用，无需预付 Gas。`
          : `Use ${amount} USDC on Arbitrum to get ETH for transfer fees, without paying gas upfront.`}
      </p>
      <div className="creation-gas-route">
        <strong>{amount} USDC</strong>
        <span>Arbitrum</span>
        <Icon name="right" size={14} />
        <strong>ETH</strong>
        <span>Arbitrum</span>
      </div>
      <div className="creation-gas-info">
        <Icon name="info" size={14} />
        <p>
          {zh
            ? `共需 ${total} USDC：${amount} USDC 用于兑换 ETH，${reserve} USDC 用于后续${activationOnly ? "账户激活" : "HYPE 兑换"}。剩余的 ${reserve} USDC 不会被冻结或提前扣除。`
            : `You need ${total} USDC in total: ${amount} USDC for ETH and ${reserve} USDC for the next ${activationOnly ? "account activation" : "HYPE exchange"}. The remaining ${reserve} USDC is not frozen or charged in advance.`}
        </p>
      </div>
      <button
        className="primary"
        disabled={busy || state.disabled || state.pending}
        onClick={() => void start()}
      >
        {busy ? <span className="loader" /> : <Icon name="pen" size={14} />}
        {busy
          ? zh
            ? "请在钱包签名…"
            : "Confirm in your wallet…"
          : state.pending
            ? zh
              ? "等待 ETH 兑换到账…"
              : "Waiting for ETH…"
            : zh
              ? `签名并兑换 ${amount} USDC 为 ETH`
              : `Sign to exchange ${amount} USDC for ETH`}
      </button>
      {quoteOutput && (
        <p>
          {zh
            ? `报价最低到账：${quoteOutput} ETH`
            : `Quoted minimum: ${quoteOutput} ETH`}
        </p>
      )}
      {issue && (
        <p role="alert" className="error-text">
          {(errors[issue] ?? errors.requestFailed)[zh ? 1 : 0]}
        </p>
      )}
    </div>
  );
}
