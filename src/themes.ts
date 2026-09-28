import type { WidgetColors } from "./types";

const light: WidgetColors = {
  primary: "#0099ff",
  surface: "#ffffff",
  background: "#f5f7fa",
  subtle: "#edf1f5",
  border: "#dfe7ef",
  text: "#192c43",
  textMuted: "#63758a",
  success: "#22c55e",
  danger: "#c93636",
  warning: "#ffd700",
  info: "#0099ff",
  debt: "#ff4d6d",
  onPrimary: "#ffffff",
  onSuccess: "#ffffff",
  onWarning: "#000000",
  badgeText: "#080b0d",
  sliderTrack: "#334155",
  overlay: "#000000",
  shadow: "#000000",
};
const dark: WidgetColors = {
  ...light,
  surface: "#171a20",
  background: "#080b0d",
  subtle: "#22272f",
  border: "#232a34",
  text: "#f7f7f8",
  textMuted: "#788697",
  danger: "#f65959",
};

/** A complete, reusable theme. Spread into WidgetConfig before custom overrides. */
export interface WidgetTheme {
  readonly theme: "light" | "dark";
  readonly colors: Readonly<WidgetColors>;
}
function preset(
  theme: WidgetTheme["theme"],
  colors: WidgetColors,
): WidgetTheme {
  return Object.freeze({ theme, colors: Object.freeze(colors) });
}

/** Built-in palettes. Immutable so sharing them cannot affect other instances. */
export const widgetThemes = Object.freeze({
  light: preset("light", light),
  dark: preset("dark", dark),
  midnight: preset("dark", {
    ...dark,
    primary: "#60a5fa",
    surface: "#0f172a",
    background: "#020617",
    subtle: "#1e293b",
    border: "#334155",
    text: "#f1f5f9",
    textMuted: "#94a3b8",
    success: "#34d399",
    danger: "#fb7185",
    warning: "#fbbf24",
    info: "#60a5fa",
    debt: "#fb7185",
    onPrimary: "#0f172a",
    onSuccess: "#0f172a",
    onWarning: "#0f172a",
    badgeText: "#0f172a",
    sliderTrack: "#334155",
  }),
  lavender: preset("light", {
    ...light,
    primary: "#7438cc",
    surface: "#faf7ff",
    background: "#f3eefb",
    subtle: "#ebe2f7",
    border: "#d8c9ec",
    text: "#2e2044",
    textMuted: "#756385",
    danger: "#be123c",
    warning: "#fbbf24",
    info: "#7438cc",
    debt: "#be123c",
    sliderTrack: "#d8c9ec",
  }),
});
export type WidgetThemeName = keyof typeof widgetThemes;
