import { ErrorToast } from "./ErrorToast";
import { useEffect, useState } from "react";
import { colorStyles } from "./colors";
import { useWidgetForm } from "./useWidgetForm";
import { Icon, type IconName } from "./Icons";
import type { WidgetController } from "../core/controller";
import type { Feature, FundsFeature } from "../types";
import { formatAmount } from "../core/amount";
import { AccountSkeleton } from "./Skeleton";
import { AccountSummary } from "./AccountSummary";
import { Modal } from "./Modal";
import { CreateAccountForm } from "./CreateAccountForm";
import { RepayForm } from "./RepayForm";
import { LendingForm } from "./LendingForm";
import { WithdrawForm } from "./WithdrawForm";
import { FundsForm } from "./FundsForm";
const icons: Record<Feature, IconName> = {
  tradingAccount: "wallet",
  deposit: "down",
  borrow: "plus",
  repay: "repay",
  transfer: "transfer",
  withdraw: "up",
};
export function WidgetView({
  controller: c,
}: {
  controller: WidgetController;
}) {
  const [open, setOpen] = useState<FundsFeature | "create" | "bind" | null>(
    null,
  );
  const m = useWidgetForm(
      c,
      open !== null && open !== "create" && open !== "bind",
    ),
    { s, config, t } = m;
  const openModal = (action: FundsFeature | "create" | "bind") => {
    setOpen(action);
  };
  const context = `${config.network}:${config.projectId}:${s.owner}`;
  useEffect(() => {
    setOpen(null);
  }, [context]);
  const enabled = (
    [
      "tradingAccount",
      "deposit",
      "borrow",
      "repay",
      "transfer",
      "withdraw",
    ] as Feature[]
  ).filter((key) => config.features[key]);
  useEffect(() => {
    if (open && open !== "create" && open !== "bind" && !config.features[open])
      setOpen(null);
  }, [open, config.features]);
  const visible =
    open && (open === "create" || open === "bind" || config.features[open]);
  const openAction = (key: FundsFeature) => {
    m.setTab(key);
    m.setAmount("");
    m.setFull(false);
    openModal(key);
    if (key === "withdraw") m.setRoute("tradeToArbitrum");
    const operation = s.continuation ?? s.operation;
    if (
      m.pending &&
      (key === "deposit" || key === "withdraw") &&
      operation?.bridge
    ) {
      m.setAmount(formatAmount(BigInt(operation.bridge.amount)));
      if (key === "withdraw")
        m.setRoute(
          operation.bridge.sourceAccount ? "tradeToArbitrum" : "fundToArbitrum",
        );
      else m.setDepositRoute("arbitrum");
    }
    if (
      key === "withdraw" &&
      operation?.stage === "awaitingAction" &&
      operation.arbitrumWithdrawal
    )
      m.setAmount(formatAmount(BigInt(operation.arbitrumWithdrawal.amount)));

    if (key === "withdraw" && operation?.transferFlow) {
      m.setAmount(formatAmount(BigInt(operation.transferFlow.amount)));
    }
    if (key === "transfer") {
      const direction =
        operation?.stage === "awaitingAction" && operation.action === "transfer"
          ? operation.transferFlow?.direction
          : undefined;
      m.setRoute(
        direction ??
          (m.route === "accountToFund" ? "accountToFund" : "fundToTrade"),
      );
    }
  };
  const flowOperation = s.continuation;
  const flow = flowOperation?.transferFlow;
  const flowActive = !!(flow || flowOperation?.arbitrumWithdrawal);
  const flowFeature =
    flowOperation?.action === "withdraw" ? "withdraw" : "transfer";
  const error =
    m.localError ||
    (s.status === "readError" ? t.notReady : s.error) ||
    s.operation?.error;
  const errorRevision = m.localError ? m.localErrorRevision : s.operation?.id;
  const [feedback, setFeedback] = useState<{ key: string; message: string }>();
  useEffect(() => {
    setFeedback(
      error
        ? { key: `${errorRevision ?? "global"}:${error}`, message: error }
        : undefined,
    );
  }, [error, errorRevision]);
  const closeModal = () => {
    setFeedback(undefined);
    setOpen(null);
  };
  const errorToast = feedback ? (
    <ErrorToast key={feedback.key} closeLabel={t.close}>
      <p role="alert" className="error-text">
        {feedback.message}
      </p>
    </ErrorToast>
  ) : null;
  return (
    <section
      lang={config.locale}
      className={`widget ${config.theme}`}
      style={colorStyles(config.colors)}
      aria-label={t.title}
    >
      <header className="header">
        <div>
          <div className="brand">{t.subtitle}</div>
          <h1>{t.title}</h1>
        </div>
        {config.network === "testnet" && (
          <span className="network">{t.testnet}</span>
        )}
      </header>
      <div className="body">
        {s.status === "disconnected" && (
          <div className="empty">
            <div className="state-icon">
              <Icon name="wallet" size={24} />
            </div>
            <p className="note">{t.disconnected}</p>
            <button
              className="primary"
              disabled={!c.hasWallet || m.busy}
              onClick={() => void c.connect()}
            >
              {t.connect}
            </button>
          </div>
        )}
        {s.status === "loading" && (
          <AccountSkeleton
            t={t}
            actions={
              enabled.filter(
                (key): key is FundsFeature => key !== "tradingAccount",
              ).length
            }
          />
        )}
        {!visible && errorToast}
        {s.status === "noAccount" && (
          <div className="onboarding">
            <div className="state-icon">
              <Icon name="plus" size={24} />
            </div>
            <h2>{t.create}</h2>
            <p className="note">{t.noAccount}</p>
            <button
              className="primary"
              disabled={m.busy || m.pending}
              onClick={() => openModal("create")}
            >
              {t.create}
            </button>
          </div>
        )}
        {(s.status === "ready" || s.status === "readError") && (
          <>
            <AccountSummary
              s={
                s.status === "readError"
                  ? { ...s, overview: undefined, balances: undefined }
                  : s
              }
              t={t}
              onCopyError={(error) =>
                void m.invoke(() => Promise.reject(error))
              }
              enabled={config.features.tradingAccount}
            />
            <div className="entry-actions">
              {enabled
                .filter((key): key is FundsFeature => key !== "tradingAccount")
                .map((key) => (
                  <button
                    key={key}
                    data-modal-trigger={key}
                    disabled={m.busy || s.status !== "ready"}
                    onClick={() => openAction(key)}
                  >
                    <span aria-hidden="true">
                      <Icon name={icons[key]} size={20} />
                    </span>
                    {t[key]}
                  </button>
                ))}
            </div>
            {enabled.length === 0 && <p className="note">{t.noFeatures}</p>}
            {s.reasons.includes("PROJECT_BINDING_REQUIRED") &&
              enabled.length > 0 && (
                <div className="notice">
                  <p>{t.projectMismatch}</p>
                  <button
                    className="text-button"
                    disabled={m.busy || m.pending}
                    onClick={() => openModal("bind")}
                  >
                    {t.switchProject}
                  </button>
                </div>
              )}
          </>
        )}
        {!visible && (
          <>
            {flowActive &&
              config.features[flowFeature] &&
              s.status === "ready" && (
                <button
                  className="secondary"
                  onClick={() => openAction(flowFeature)}
                >
                  {flowFeature === "withdraw"
                    ? t.viewWithdrawal
                    : t.viewProgress}
                </button>
              )}
          </>
        )}
      </div>
      <footer className="footer">
        <span>{t.footer}</span>
      </footer>
      {visible && (
        <Modal
          colors={config.colors}
          theme={config.theme}
          locale={config.locale}
          variant={
            open === "create" ||
            open === "borrow" ||
            open === "repay" ||
            open === "deposit" ||
            open === "transfer" ||
            open === "withdraw"
              ? open
              : "default"
          }
          title={
            open === "create"
              ? t.modalCreateTitle
              : open === "bind"
                ? t.switchProject
                : open === "deposit"
                  ? t.modalDepositTitle
                  : open === "borrow"
                    ? t.modalBorrowTitle
                    : open === "repay"
                      ? t.modalRepayTitle
                      : open === "transfer"
                        ? t.modalTransferTitle
                        : t.modalWithdrawTitle
          }
          description={
            open === "create"
              ? t.modalCreateDescription
              : open === "deposit"
                ? t.modalDepositDescription
                : open === "withdraw"
                  ? s.continuation?.action === "withdraw" &&
                    s.continuation.transferFlow
                    ? undefined
                    : t.withdrawSubtitle
                  : open === "transfer"
                    ? t.transferDescription
                    : undefined
          }
          busy={s.busy}
          walletPrompt={s.busy}
          closeLabel={t.close}
          closeBusyLabel={t.closeBusy}
          onClose={closeModal}
        >
          {open === "create" ? (
            <CreateAccountForm
              key={context}
              controller={c}
              s={
                s.status === "readError"
                  ? { ...s, overview: undefined, balances: undefined }
                  : s
              }
              t={t}
              onDone={closeModal}
            />
          ) : open === "bind" ? (
            <>
              <p className="note">{t.switchInfo}</p>
              <div className="account-detail">
                <small>{t.currentProject}</small>
                <code>{s.boundProjectId}</code>
                <small>{t.targetProject}</small>
                <code>{config.projectId}</code>
              </div>
              <button
                className="primary"
                disabled={m.busy || m.pending || s.status !== "ready"}
                onClick={() => void m.invoke(() => c.bindProject())}
              >
                {t.confirm}
              </button>
            </>
          ) : open === "borrow" ? (
            <LendingForm model={m} />
          ) : open === "repay" ? (
            <RepayForm model={m} />
          ) : open === "withdraw" ? (
            <WithdrawForm model={m} />
          ) : (
            <FundsForm model={m} />
          )}
          {errorToast}
        </Modal>
      )}
    </section>
  );
}
