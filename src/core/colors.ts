import type { WidgetColors, WidgetConfig } from "../types";
import { widgetThemes } from "../themes";
import { invariant } from "./errors";

export function resolveColors(input: WidgetConfig): WidgetColors {
  const colors = {
    ...widgetThemes[input.theme === "light" ? "light" : "dark"].colors,
    primary: input.primaryColor ?? widgetThemes.light.colors.primary,
  };
  invariant(
    input.colors === undefined ||
      (input.colors !== null &&
        typeof input.colors === "object" &&
        !Array.isArray(input.colors)),
    "INVALID_CONFIG",
    "colors must be an object.",
  );
  for (const key of Object.keys(
    widgetThemes.light.colors,
  ) as (keyof WidgetColors)[]) {
    const value = input.colors?.[key];
    if (value === undefined) continue;
    invariant(
      typeof value === "string" && /^#[\da-f]{6}$/i.test(value),
      "INVALID_CONFIG",
      `colors.${key} must be a six-digit hex color.`,
    );
    colors[key] = value;
  }
  return colors;
}
