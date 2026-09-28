import type { CSSProperties } from "react";
import type { WidgetColors } from "../types";

const variables: Record<keyof WidgetColors, string> = {
  primary: "--accent",
  surface: "--surface",
  background: "--background",
  subtle: "--subtle",
  border: "--line",
  text: "--ink",
  textMuted: "--muted",
  success: "--success",
  danger: "--danger",
  warning: "--warning",
  info: "--info",
  debt: "--debt",
  onPrimary: "--on-primary",
  onSuccess: "--on-success",
  onWarning: "--on-warning",
  badgeText: "--badge-text",
  sliderTrack: "--slider-track",
  overlay: "--overlay",
  shadow: "--shadow",
};
export function colorStyles(colors: WidgetColors): CSSProperties {
  return Object.fromEntries(
    (Object.keys(variables) as (keyof WidgetColors)[]).map((key) => [
      variables[key],
      colors[key],
    ]),
  ) as CSSProperties;
}
