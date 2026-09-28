import { mountLeverAccWidget, widgetThemes } from "../../dist/embed.js";
import "../shared.css";
const events = document.querySelector("#events");
const getConfig = () => ({
  projectId: document.querySelector("#project").value,
  network: "testnet",
  locale: document.querySelector("#locale").value,
  ...widgetThemes[document.querySelector("#theme").value],
});
let config = getConfig();
const widget = mountLeverAccWidget(document.querySelector("#widget"), {
  config,
  onEvent(event) {
    events.textContent = JSON.stringify(event, null, 2);
    if (event.type === "accountActionRequired") {
      /* Complete authorization in your application, then call widget.refresh(). */
    }
  },
});
document.querySelector("#locale").onchange = (event) => {
  config = { ...config, locale: event.target.value };
  widget.update({ config });
};
document.querySelector("#theme").onchange = () => {
  const next = getConfig();
  config = { ...config, theme: next.theme, colors: next.colors };
  widget.update({ config });
};
document.querySelector("#apply").onclick = () => {
  try {
    config = getConfig();
    widget.update({ config, wallet: window.ethereum });
    if (!window.ethereum)
      events.textContent =
        "No injected wallet found. Supply your host provider.";
  } catch (e) {
    events.textContent = e.message;
  }
};
document.querySelector("#refresh").onclick = () => widget.refresh();
window.addEventListener("pagehide", () => widget.destroy());
