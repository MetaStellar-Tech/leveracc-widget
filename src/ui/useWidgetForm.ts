import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { WidgetController } from "../core/controller";
import type { FundsFeature, TransferRoute } from "../types";
import { formatAmount, parseAmount } from "../core/amount";
import { terminal } from "../core/operations";
import { en, zh } from "./strings";
export function useWidgetForm(c: WidgetController, active = true) {
  const s = useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot),
    config = c.config,
    t = config.locale === "zh" ? zh : en;
  const enabled = (
    ["borrow", "repay", "deposit", "transfer", "withdraw"] as FundsFeature[]
  ).filter((key) => config.features[key]);
  const [tab, setTab] = useState<FundsFeature>("borrow");
  const [amount, setAmount] = useState(""),
    [route, setRoute] = useState<TransferRoute>("fundToTrade"),
    [depositRoute, setDepositRoute] = useState<"core" | "arbitrum">("arbitrum");
  const [full, setFull] = useState(false),
    [fee, setFee] = useState<bigint>(),
    [localError, setLocalErrorMessage] = useState<string>(),
    [quoting, setQuoting] = useState(false);
  const [localErrorRevision, setLocalErrorRevision] = useState(0);
  function setLocalError(error?: string) {
    setLocalErrorMessage(error);
    if (error) setLocalErrorRevision((revision) => revision + 1);
  }
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [arbitrumLoading, setArbitrumLoading] = useState(false);
  const [coreLoading, setCoreLoading] = useState(false);
  const [borrowQuote, setBorrowQuote] = useState<{
    version: bigint;
    dailyRatePpm: number;
  }>();
  const [withdrawMaximum, setWithdrawMaximum] = useState<bigint>();
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [arbitrumBalance, setArbitrumBalance] = useState<bigint>();
  const [arbitrumAllowance, setArbitrumAllowance] = useState<bigint>();
  const id = useId();
  const quoteSequence = useRef(0);
  const [ownerCore, setOwnerCore] = useState<bigint>();
  const [fundAllowance, setFundAllowance] = useState<bigint>();
  const [fundBalance, setFundBalance] = useState<bigint>();
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  const context = `${config.network}:${config.projectId}:${s.owner}:${s.account}:${config.rpcUrl}:${config.arbitrumRpcUrl}:${config.protocolServiceUrl}`;
  useEffect(() => {
    setBorrowQuote(undefined);
    setLocalError(undefined);
    setAmount("");
    setFee(undefined);
    setDepositRoute(config.network === "mainnet" ? "arbitrum" : "core");
    setRoute("fundToTrade");
    setFull(false);
  }, [context]);
  useEffect(() => {
    if (!enabled.includes(tab))
      setTab((enabled[0] as FundsFeature) ?? "borrow");
  }, [tab, enabled.join(",")]);
  useEffect(() => {
    quoteSequence.current++;
    setFee(undefined);
    setLocalError(undefined);
  }, [amount, tab, route, depositRoute, full]);
  const busy = s.busy,
    pending = !terminal(s.operation),
    ready = s.status === "ready",
    queryReady = ready && active,
    isBridge =
      (tab === "deposit" && depositRoute === "arbitrum") ||
      (tab === "withdraw" &&
        ["tradeToArbitrum", "fundToArbitrum"].includes(route));
  const units = (() => {
    try {
      return full && tab === "repay" ? s.balances?.debt : parseAmount(amount);
    } catch {
      return undefined;
    }
  })();
  const submissionRevision =
    s.operation &&
    !s.operation.error &&
    (s.operation.stage === "submitted" ||
      (s.operation.stage === "awaitingAction" && s.operation.hash))
      ? `${s.operation.id}:${s.operation.hash ?? "core"}`
      : undefined;
  const handledSubmission = useRef<string | undefined>(
    !s.busy && s.operation?.stage === "submitted" ? s.operation.id : undefined,
  );
  useEffect(() => {
    const operation = s.operation;
    if (
      s.busy ||
      !operation ||
      operation.stage !== "submitted" ||
      operation.error ||
      s.continuation?.id === operation.id ||
      handledSubmission.current === operation.id
    )
      return;
    handledSubmission.current = operation.id;
    if (!active || operation.action !== tab) return;
    // Approval and intermediate submissions retain the amount for the next step.
    setAmount("");
    setFull(false);
    setFee(undefined);
    setLocalError(undefined);
    setQuoting(false);
    quoteSequence.current++;
  }, [s.operation, s.busy, s.continuation, active, tab]);
  useEffect(() => {
    setArbitrumBalance(undefined);
    setArbitrumAllowance(undefined);
  }, [context, queryReady, tab, depositRoute]);
  useEffect(() => {
    let current = true;
    setArbitrumLoading(false);
    if (
      queryReady &&
      ((tab === "deposit" && depositRoute === "arbitrum") || tab === "withdraw")
    ) {
      setArbitrumLoading(true);
      void c
        .bridgeBalances(tab === "withdraw")
        .then((value) => {
          if (current) {
            setArbitrumBalance(value.balance);
            setArbitrumAllowance(value.allowance);
          }
        })
        .catch((error) => {
          if (current) {
            setArbitrumBalance(undefined);
            setArbitrumAllowance(undefined);
            setLocalError(
              error instanceof Error ? error.message : String(error),
            );
          }
        })
        .finally(() => {
          if (current) setArbitrumLoading(false);
        });
    }
    return () => {
      current = false;
    };
  }, [
    context,
    queryReady,
    tab,
    depositRoute,
    submissionRevision,
    s.balanceRevision,
    balanceRefresh,
  ]);
  useEffect(() => {
    let active = true;
    setWithdrawMaximum(undefined);
    setWithdrawLoading(false);
    if (queryReady && tab === "withdraw" && route !== "fundToArbitrum") {
      setWithdrawLoading(true);
      c.quoteArbitrumWithdrawal()
        .then((value) => {
          if (active) setWithdrawMaximum(value.maximum);
        })
        .catch((error) => {
          if (active)
            setLocalError(
              error instanceof Error ? error.message : String(error),
            );
        })
        .finally(() => {
          if (active) setWithdrawLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [
    context,
    queryReady,
    tab,
    route,
    s.balances?.evm,
    s.balances?.spot,
    s.balances?.debt,
    submissionRevision,
    s.balanceRevision,
    balanceRefresh,
  ]);
  const approved =
    units !== undefined &&
    (tab === "deposit"
      ? arbitrumAllowance !== undefined && arbitrumAllowance >= units
      : route === "fundToArbitrum" &&
        fundAllowance !== undefined &&
        fundAllowance >= units);
  const available =
    tab === "withdraw"
      ? route === "fundToArbitrum"
        ? fundBalance
        : withdrawMaximum
      : tab === "borrow"
        ? s.balances?.borrowable
        : tab === "repay"
          ? s.balances?.evm
          : tab === "deposit"
            ? depositRoute === "arbitrum"
              ? arbitrumBalance
              : ownerCore
            : route === "fundToTrade"
              ? s.balances?.fund
              : route === "accountToFund"
                ? s.balances
                  ? s.balances.evm +
                    (s.balances.spot > 5000n ? s.balances.spot - 5000n : 0n)
                  : undefined
                : route === "coreToEvm" || route === "spotToPerps"
                  ? s.balances
                    ? s.balances.spot > 5000n
                      ? s.balances.spot - 5000n
                      : 0n
                    : undefined
                  : route === "perpsToSpot"
                    ? s.balances?.perps
                    : s.balances?.evm;
  const routeLabel =
    tab === "withdraw"
      ? route === "fundToArbitrum"
        ? t.fundToArbitrum
        : route === "tradeToArbitrum"
          ? t.tradeToArbitrum
          : t.accountToFund
      : tab === "deposit"
        ? depositRoute === "arbitrum"
          ? t.arbitrumRoute
          : t.coreDepositRoute
        : tab === "transfer"
          ? t[route]
          : tab === "borrow"
            ? `LeverAcc → ${t.evm}`
            : `${t.evm} → LeverAcc`;
  const [from, to] = routeLabel.split(" → ");
  const canForm = ready;
  const invalid =
    (tab === "withdraw" &&
      route !== "fundToArbitrum" &&
      (withdrawMaximum === undefined ||
        withdrawLoading ||
        (units !== undefined && units > withdrawMaximum))) ||
    !config.features[tab] ||
    !units ||
    !canForm ||
    busy ||
    quoting ||
    pending ||
    (units !== undefined &&
      available !== undefined &&
      units > available &&
      !(tab === "repay" && full)) ||
    (tab === "borrow" &&
      (s.reasons.length > 0 ||
        (units !== undefined && units < (s.minimumBorrow ?? 0n)))) ||
    (tab === "withdraw" &&
      route === "tradeToArbitrum" &&
      !config.arbitrumWithdrawalEnabled) ||
    (isBridge && (fee === undefined || !units || units <= fee)) ||
    available === undefined;
  async function invoke(fn: () => Promise<unknown>) {
    setLocalError(undefined);
    try {
      await fn();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  }
  const withdrawalFlow =
    tab === "withdraw" && s.continuation?.action === "withdraw"
      ? s.continuation
      : undefined;
  async function quote() {
    const sequence = ++quoteSequence.current;
    setQuoting(true);
    try {
      const quoteAmount =
        withdrawalFlow?.arbitrumWithdrawal?.amount ??
        withdrawalFlow?.transferFlow?.amount;
      const value = quoteAmount
        ? formatAmount(BigInt(quoteAmount))
        : units
          ? amount
          : "0";
      const result = withdrawalFlow?.transferFlow
        ? parseAmount(value) -
          (await c.quoteWithdrawal(value)).plan!.netPayoutAmount
        : await c.quoteBridge(value, tab === "deposit" ? "fund" : "arbitrum");
      if (sequence !== quoteSequence.current) return;
      setFee(result);
    } catch (error) {
      if (sequence === quoteSequence.current) {
        setFee(undefined);
        setLocalError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (sequence === quoteSequence.current) setQuoting(false);
    }
  }
  useEffect(() => {
    setOwnerCore(undefined);
    setFundAllowance(undefined);
    setFundBalance(undefined);
  }, [context, queryReady, tab, route, depositRoute]);
  useEffect(() => {
    let active = true;
    setCoreLoading(false);
    if (
      queryReady &&
      ((tab === "deposit" && depositRoute === "core") ||
        (tab === "withdraw" && route === "fundToArbitrum"))
    ) {
      setCoreLoading(true);
      void c
        .fundSourceBalances(tab === "deposit" ? "core" : "fund")
        .then((value) => {
          if (active) {
            setOwnerCore(value.core);
            setFundAllowance(value.allowance);
            setFundBalance(value.fund);
          }
        })
        .catch((error) => {
          if (active) {
            setFundBalance(undefined);
            setFundAllowance(undefined);
            setOwnerCore(undefined);
            setLocalError(
              error instanceof Error ? error.message : String(error),
            );
          }
        })
        .finally(() => {
          if (active) setCoreLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [
    context,
    queryReady,
    tab,
    route,
    depositRoute,
    s.balances?.fund,
    submissionRevision,
    s.balanceRevision,
    balanceRefresh,
  ]);
  useEffect(() => {
    setQuoting(false);
    if (!queryReady || !isBridge || pending) return;
    void quote();
    return () => {
      quoteSequence.current++;
    };
  }, [
    context,
    queryReady,
    isBridge,
    amount,
    tab,
    route,
    depositRoute,
    pending,
    withdrawalFlow?.id,
  ]);
  async function loadBorrowQuote() {
    setBorrowQuote(undefined);
    setBorrowLoading(true);
    try {
      await invoke(async () => setBorrowQuote(await c.quoteBorrow()));
    } finally {
      setBorrowLoading(false);
    }
  }
  async function execute() {
    await invoke(() =>
      tab === "withdraw"
        ? route === "fundToArbitrum"
          ? c.transfer("fundToArbitrum", amount, fee)
          : c.withdrawToArbitrum(amount, fee!)
        : tab === "borrow"
          ? c.borrow(amount, borrowQuote?.version)
          : tab === "repay"
            ? c.repay(amount, full)
            : tab === "deposit"
              ? isBridge
                ? c.bridgeDeposit(amount, fee!, !approved)
                : c.depositFromCore(amount)
              : route === "fundToTrade" || route === "accountToFund"
                ? c.accountTransfer(route, amount)
                : c.transfer(route, amount, fee),
    );
    if (isBridge) {
      const result = c.getSnapshot();
      if (result.operation?.stage === "failed") {
        setFee(undefined);
        await quote();
      }
      if (
        tab === "deposit" &&
        result.operation?.stage === "submitted" &&
        result.operation.action === "bridgeApproval"
      )
        await quote();
    }
    if (tab === "borrow" && c.getSnapshot().operation?.stage === "failed")
      await loadBorrowQuote();
  }
  const operation = s.operation;

  return {
    arbitrumBalance,
    refreshBalances: () => {
      setLocalError(undefined);
      setBalanceRefresh((value) => value + 1);
    },
    continueTransfer: c.continueTransfer,
    continueWithdrawal: () =>
      invoke(async () => {
        if (fee === undefined || !withdrawalFlow) return;
        if (withdrawalFlow.arbitrumWithdrawal)
          await c.continueArbitrumWithdrawal(fee);
        else
          await c.continueTransfer(
            withdrawalFlow.transferFlow?.step === "withdraw"
              ? BigInt(withdrawalFlow.transferFlow.amount) - fee
              : undefined,
          );
      }),
    withdrawMaximum,
    withdrawLoading,
    hasAccountSetup: c.hasAccountSetup,
    setupAccount: () => invoke(c.setupAccount),
    s,
    config,
    t,
    enabled,
    tab,
    setTab,
    amount,
    setAmount,
    route,
    setRoute,
    depositRoute,
    setDepositRoute,
    full,
    setFull,
    fee,
    approved,
    localError,
    localErrorRevision,
    busy,
    pending,
    ready,
    isBridge,
    units,
    available,
    balanceLoading:
      s.status === "loading" ||
      (tab === "deposit"
        ? depositRoute === "arbitrum"
          ? arbitrumLoading && arbitrumBalance === undefined
          : coreLoading && ownerCore === undefined
        : tab === "withdraw"
          ? route === "fundToArbitrum"
            ? coreLoading && fundBalance === undefined
            : withdrawLoading
          : false),
    arbitrumLoading: arbitrumLoading && arbitrumBalance === undefined,
    quoting,
    borrowLoading,
    from,
    to,
    canForm,
    invalid,
    invoke,
    quote,
    execute,
    operation,
    borrowQuote,
    loadBorrowQuote,
    id,
  };
}
