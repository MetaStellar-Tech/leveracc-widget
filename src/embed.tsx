import { createRoot } from "react-dom/client";
import { WidgetController } from "./core/controller";
import { ShadowHost } from "./ui/ShadowHost";
import type { WidgetOptions, WidgetHandle } from "./types";
const mounted = new WeakSet<HTMLElement>();
export function mountLeverAccWidget(
  element: HTMLElement,
  options: WidgetOptions,
): WidgetHandle {
  if (mounted.has(element))
    throw new Error("A LeverAcc widget is already mounted in this element.");
  const controller = new WidgetController(options),
    root = createRoot(element);
  mounted.add(element);
  root.render(<ShadowHost controller={controller} />);
  void controller.refresh();
  let destroyed = false;
  return {
    update(next) {
      if (destroyed) throw new Error("Widget has been destroyed.");
      controller.update(next);
    },
    refresh() {
      if (destroyed)
        return Promise.reject(new Error("Widget has been destroyed."));
      return controller.refresh();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controller.destroy();
      root.unmount();
      mounted.delete(element);
    },
  };
}
export type {
  WidgetConfig,
  WidgetColors,
  WidgetOptions,
  WalletProvider,
  WidgetEvent,
  WidgetHandle,
} from "./types";

export { widgetThemes } from "./themes";
export type { WidgetTheme, WidgetThemeName } from "./themes";
