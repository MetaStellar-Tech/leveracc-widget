import { Icon } from "./Icons";
import type { en } from "./strings";

export function CreationGasStep({
  source,
  activationOnly = false,
  t,
  disabled,
  submitting,
  pending = false,
  failure,
  onFund,
}: {
  source: "Arbitrum" | "HyperCore";
  activationOnly?: boolean;
  t: typeof en;
  disabled: boolean;
  submitting: boolean;
  pending?: boolean;
  failure?: string;
  onFund: () => void;
}) {
  const text = (value: string) =>
    value
      .replaceAll("{amount}", activationOnly ? "1.1" : "3")
      .replaceAll("{source}", source);
  if (failure)
    return (
      <p role="alert" className="error-text">
        {failure}
      </p>
    );
  if (submitting || pending)
    return (
      <div className="creation-gas-progress" role="status">
        <span className="loader" />
        <p>{text(submitting ? t.gasFundingSigning : t.gasFundingPending)}</p>
      </div>
    );
  return (
    <div className="creation-gas">
      <p>{text(t.gasFundingDescription)}</p>
      <div className="creation-gas-route">
        <strong>{activationOnly ? "1.1" : "3"} USDC</strong>
        <span>{source}</span>
        <Icon name="right" size={14} />
        <strong>{activationOnly ? t.tradingAccount : "HYPE"}</strong>
        <span>{activationOnly ? "HyperCore" : "HyperEVM"}</span>
      </div>
      <div className="creation-gas-info">
        <Icon name="info" size={14} />
        <p>{text(t.gasFundingInfo)}</p>
      </div>
      <button
        className="primary creation-gas-submit"
        disabled={disabled}
        onClick={onFund}
      >
        <Icon name="pen" />
        {text(t.gasFundingSign)}
      </button>
    </div>
  );
}
