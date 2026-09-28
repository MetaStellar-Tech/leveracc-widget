import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { WidgetController } from "./core/controller";
import { ShadowHost } from "./ui/ShadowHost";
import type { WidgetOptions } from "./types";
export interface LeverAccWidgetRef {
  refresh(): Promise<void>;
}
export const LeverAccWidget = forwardRef<LeverAccWidgetRef, WidgetOptions>(
  function LeverAccWidget(options, ref) {
    const [controller, setController] = useState<WidgetController>();
    useEffect(() => {
      const next = new WidgetController(options);
      setController(next);
      void next.refresh();
      return () => next.destroy();
    }, []);
    useEffect(() => {
      controller?.update(options);
    }, [
      controller,
      options.config,
      options.wallet,
      options.onConnect,
      options.onAccountSetup,
      options.onGasTopUp,
      options.onEvent,
    ]);
    useImperativeHandle(
      ref,
      () => ({
        refresh: async () => {
          await controller?.refresh();
        },
      }),
      [controller],
    );
    return controller ? (
      <ShadowHost controller={controller} />
    ) : (
      <div data-leveracc-widget="" aria-busy="true" />
    );
  },
);
