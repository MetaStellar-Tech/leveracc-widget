import { geist, geistMono } from "./assets/font";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WidgetView } from "./WidgetView";
import { styles } from "./styles";
import type { WidgetController } from "../core/controller";
let fontLoading: Promise<FontFace> | undefined;
export function ShadowHost({ controller }: { controller: WidgetController }) {
  const ref = useRef<HTMLDivElement>(null),
    [root, setRoot] = useState<ShadowRoot>();
  useLayoutEffect(() => {
    if (typeof FontFace !== "undefined" && !fontLoading) {
      const font = new FontFace("LeverAcc Geist", `url(${geist})`, {
        weight: "100 900",
        display: "swap",
      });
      const mono = new FontFace("LeverAcc Geist Mono", `url(${geistMono})`, {
        weight: "100 900",
        display: "swap",
      });
      document.fonts.add(mono);
      void mono.load().catch(() => {});
      document.fonts.add(font);
      fontLoading = font.load();
      void fontLoading.catch(() => {
        fontLoading = undefined;
      });
    }
    const host = ref.current!;
    setRoot(host.shadowRoot ?? host.attachShadow({ mode: "open" }));
  }, []);
  return (
    <div ref={ref} data-leveracc-widget="">
      {root &&
        createPortal(
          <>
            <style>{styles}</style>
            <WidgetView controller={controller} />
          </>,
          root,
        )}
    </div>
  );
}
